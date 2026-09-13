import * as assert from "assert";
import type { ImageAttachment, ReferencedFile } from "@/contracts";
import {
  getSavedChatState,
  isImageAttachment,
  isReferencedFile,
  mergeReferencedFiles,
  referenceIdentity,
} from "../../ui/views/chatView/model/PersistentChatState";

let savedState: Record<string, unknown> | undefined;

suite("persistent chat state", () => {
  suiteSetup(() => {
    (globalThis as { window?: unknown }).window = {
      acquireVsCodeApi: () => ({
        postMessage: () => undefined,
        getState: () => savedState,
        setState: (state: unknown) => state,
      }),
    };
  });

  test("drops duplicate referenced paths while keeping the first occurrence", () => {
    const merged = mergeReferencedFiles([file("src/a.ts"), file("src/b.ts")], [file("src/b.ts"), file("src/c.ts")]);

    assert.deepStrictEqual(merged.map((entry) => entry.path), ["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  test("prefers an explicit reference id over the scope and path", () => {
    assert.strictEqual(referenceIdentity({ ...file("src/a.ts"), referenceId: "ref-1" }), "ref-1");
    assert.strictEqual(referenceIdentity({ ...file("src/a.ts"), scope: "external-snapshot" }), "external-snapshot:src/a.ts");
    assert.strictEqual(referenceIdentity(file("src/a.ts")), "workspace:src/a.ts");
  });

  test("rejects malformed files and expired image previews", () => {
    assert.strictEqual(isReferencedFile(file("src/a.ts")), true);
    assert.strictEqual(isReferencedFile({ path: "src/a.ts" }), false);
    assert.strictEqual(isReferencedFile({ path: "src/a.ts", name: "a.ts", type: "binary" }), false);

    const attachment = image(Date.now() + 60_000);
    assert.strictEqual(isImageAttachment(attachment), true);
    assert.strictEqual(isImageAttachment({ ...attachment, previewUri: undefined }), false);
    assert.strictEqual(isImageAttachment(image(Date.now() - 1)), false);
  });

  test("hydrates only a matching persistent state", () => {
    savedState = {
      schemaVersion: 5,
      mode: "persistent",
      draft: "draft text",
      referencedFiles: [file("src/a.ts"), { path: "src/b.ts" }],
      imageAttachments: [image(Date.now() + 60_000), { id: "expired" }],
      conversationId: "  ",
    };

    const state = getSavedChatState();
    assert.strictEqual(state?.draft, "draft text");
    assert.deepStrictEqual(state?.referencedFiles.map((entry) => entry.path), ["src/a.ts"]);
    assert.strictEqual(state?.imageAttachments.length, 1);
    assert.strictEqual(state?.conversationId, undefined);

    savedState = { schemaVersion: 4, mode: "persistent" };
    assert.strictEqual(getSavedChatState(), undefined);

    savedState = undefined;
    assert.strictEqual(getSavedChatState(), undefined);
  });
});

function file(path: string): ReferencedFile {
  return { path, name: path.split("/").pop() ?? path, type: "file" };
}

function image(expiresAt: number): ImageAttachment {
  return {
    id: "image-1",
    fileId: "file-api-image-1",
    name: "screenshot.png",
    mediaType: "image/png",
    size: 1024,
    source: "picker",
    uploadedAt: 1,
    expiresAt,
    apiBaseUrl: "https://api.deepseek.com",
    cacheFileName: "screenshot.png",
    previewUri: "data:image/png;base64,AAAA",
  };
}
