import { viewImageTool } from "@/infrastructure/tools/builtins/vision/ViewImage";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, type ChatCompletionResponse, type ChatMessage } from "@/contracts";
import { createNativeCaptureImages } from "@/infrastructure/deepseek/provider/NativeCaptureImages";
import type { ScreenshotStore } from "@/infrastructure/images/ScreenshotStore";
import { runToolCallCycle } from "@/application/chat/toolCall/ToolCallCycle";
import { captureScreenshotTool } from "@/infrastructure/tools/builtins/vision/CaptureScreenshot";

const png = Buffer.from("89504e470d0a1a0a", "hex");
const screenshots = { lookup: async (id: string) => ({ bytes: png, metadata: { id, fileName: `${id}.png` } }) } as unknown as ScreenshotStore;
const config = { ...DEFAULT_CONFIG, model: "deepseek-flash", apiKey: "test" };
function fileIds(messages: ChatMessage[]) {
  return messages.flatMap(message => Array.isArray(message.content)
    ? message.content.flatMap(part => part.type === "file" ? [part.file_id] : []) : []);
}

suite("native captured images", () => {
  test("reopens a historical attachment through view_image and supplies actual pixels next round", async () => {
    let uploads = 0;
    const native = createNativeCaptureImages({ config, screenshots,
      upload: async options => {
        assert.deepEqual(options.bytes, png); uploads++;
        return { id: "file-api-reopened", filename: "image.png", bytes: png.length, createdAt: 1 };
      }, deleteFile: async () => {},
    })!;
    let rounds = 0;
    try {
      await runToolCallCycle({
        initialMessages: [{ role: "user", content: "Can you see image 1 again?" }],
        tools: [viewImageTool.definition], model: config.model,
        modelClient: {
          completeRound: async ({ messages }) => {
            if (++rounds === 1) {
              return { choices: [{ message: { role: "assistant", content: null, tool_calls: [
                { id: "view", type: "function", function: { name: "view_image", arguments: '{"screenshot_ids":["1"]}' } },
              ] }, finish_reason: "tool_calls" }] } as ChatCompletionResponse;
            }
            assert.deepEqual(fileIds(messages), ["file-api-reopened"]);
            return { choices: [{ message: { role: "assistant", content: "I can inspect the original image." }, finish_reason: "stop" }] } as ChatCompletionResponse;
          },
          streamRound: async () => {throw new Error("Unexpected streaming call");},
        },
        executeToolCall: async () => viewImageTool.handler({ screenshot_ids: ["1"] }, {
          analyzeImages: async request => {
            for (const id of request.screenshotIds!) {await native.add(id);}
            return "Loaded saved image";
          },
        }),
        cycleOptions: { prepareRequestContext: messages => native.prepare(messages) },
      });
      assert.equal(rounds, 2); assert.equal(uploads, 1);
      await native.add("1"); assert.equal(uploads, 1);
    } finally {await native.dispose();}
  });

  test("missing saved images fail without uploading a substitute", async () => {
    const native = createNativeCaptureImages({ config,
      screenshots: { lookup: async () => undefined } as unknown as ScreenshotStore,
      upload: async () => {assert.fail("Must not upload a substitute");}, deleteFile: async () => {},
    })!;
    try {
      await assert.rejects(native.add("screenshot-1"), /Screenshot not found/);
      assert.deepEqual(fileIds(native.prepare([])), []);
    } finally {await native.dispose();}
  });

  test("sends the captured pixels as native file parts on the next tool round, without persisting temporary IDs", async () => {
    const deleted: string[] = [];
    let uploads = 0;
    const native = createNativeCaptureImages({ config, screenshots,
      upload: async options => {
        assert.deepEqual(options.bytes, png);
        assert.equal(options.minimizeMetadata, true);
        assert.equal(options.expiresAfterSeconds, 3600);
        uploads++;
        return { id: "file-api-capture", filename: "image.png", bytes: png.length, createdAt: 1 };
      }, deleteFile: async ({ fileId }) => {deleted.push(fileId);},
    })!;
    let rounds = 0;
    try {
      const result = await runToolCallCycle({
        initialMessages: [{ role: "user", content: "Capture the page and read its heading" }],
        tools: [captureScreenshotTool.definition], model: config.model,
        modelClient: {
          completeRound: async ({ messages }) => {
            rounds++;
            if (rounds === 1) {
              assert.deepEqual(fileIds(messages), []);
              return { choices: [{ message: { role: "assistant", content: null, tool_calls: [
                { id: "capture-1", type: "function", function: { name: "capture_screenshot", arguments: '{"target":"web","url":"http://localhost"}' } },
              ] }, finish_reason: "tool_calls" }] } as ChatCompletionResponse;
            }
            assert.deepEqual(fileIds(messages), ["file-api-capture"]);
            assert.equal(messages.at(-2)?.role, "tool");
            return { choices: [{ message: { role: "assistant", content: "I can inspect the heading" }, finish_reason: "stop" }] } as ChatCompletionResponse;
          },
          streamRound: async () => {throw new Error("Unexpected streaming call");},
        },
        executeToolCall: async () => {
          await native.add("screenshot-2");
          return JSON.stringify({ id: "screenshot-2", path: ".screenshots/2.png", kind: "web" });
        },
        cycleOptions: { prepareRequestContext: messages => native.prepare(messages) },
      });
      assert.equal(result.rounds, 2);
      assert.deepEqual(fileIds(result.transcript), []);
      assert.equal(uploads, 1);
    } finally {await native.dispose();}
    assert.deepEqual(deleted, ["file-api-capture"]);
  });

  test("reuses identical uploads and replaces injected context across rounds and compaction", async () => {
    let uploads = 0;
    const deleted: string[] = [];
    const native = createNativeCaptureImages({ config, screenshots,
      upload: async () => ({ id: `file-api-${++uploads}`, filename: "image.png", bytes: png.length, createdAt: 1 }),
      deleteFile: async ({ fileId }) => {deleted.push(fileId);},
    })!;
    await native.add("screenshot-2");
    const first = native.prepare([{ role: "user", content: "Inspect" }]);
    await native.add("screenshot-3");
    const second = native.prepare(first);
    assert.equal(second.length, 2);
    assert.equal(fileIds(second).length, 2);
    assert.equal(uploads, 1);
    assert.equal(fileIds(native.prepare([{ role: "user", content: "Compacted task" }])).length, 2);
    await native.dispose();
    assert.deepEqual(deleted, ["file-api-1"]);
  });

  test("bounds the native capture context and cleans uploads evicted from it", async () => {
    let uploads = 0;
    const deleted: string[] = [];
    const store = { lookup: async (id: string) => ({ bytes: Buffer.concat([png, Buffer.from(id)]), metadata: { id, fileName: `${id}.png` } }) } as unknown as ScreenshotStore;
    const native = createNativeCaptureImages({ config, screenshots: store,
      upload: async () => ({ id: `file-api-${++uploads}`, filename: "image.png", bytes: 16, createdAt: 1 }),
      deleteFile: async ({ fileId }) => {deleted.push(fileId);},
    })!;
    for (let index = 1; index <= 9; index++) {await native.add(`screenshot-${index}`);}
    const ids = fileIds(native.prepare([]));
    assert.equal(ids.length, 8);
    assert.ok(!ids.includes("file-api-1"));
    assert.deepEqual(deleted, ["file-api-1"]);
    await native.dispose();
    assert.equal(deleted.length, 9);
  });

  test("settles cancelled late uploads before deleting their files", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const ready = new Promise<void>(resolve => {started = resolve;});
    const deleted: string[] = [];
    const native = createNativeCaptureImages({ config, screenshots,
      upload: async () => {started(); await gate; return { id: "file-api-late", filename: "image.png", bytes: png.length, createdAt: 1 };},
      deleteFile: async ({ fileId }) => {deleted.push(fileId);},
    })!;
    const pending = native.add("screenshot-1");
    const rejected = assert.rejects(pending, /closed/);
    await ready;
    const disposal = native.dispose();
    assert.equal(native.dispose(), disposal);
    release();
    await rejected; await disposal;
    assert.deepEqual(deleted, ["file-api-late"]);
    await assert.rejects(native.add("screenshot-2"), /closed/);
  });

  test("does not claim visual access when upload fails, and leaves Pro on delegated vision", async () => {
    assert.equal(createNativeCaptureImages({ config: { ...config, model: "deepseek-v4-pro" }, screenshots }), undefined);
    const native = createNativeCaptureImages({ config, screenshots,
      upload: async () => {throw new Error("Upload failed");}, deleteFile: async () => {},
    })!;
    await assert.rejects(native.add("screenshot-1"), /Upload failed/);
    assert.deepEqual(native.prepare([]), []);
    await native.dispose();
  });
});
