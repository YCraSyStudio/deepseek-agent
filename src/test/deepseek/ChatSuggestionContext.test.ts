import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, lstat, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { captureChatSuggestionContext } from "@/vscode/completions/ChatSuggestionContext";

suite("chat suggestion project context", () => {
  let root: string;
  setup(async () => {root = await mkdtemp(path.join(tmpdir(), "deepseek-suggestion-context-"));});
  teardown(async () => {await rm(root, { recursive: true, force: true });});

  function workspace() {
    const uri = (value: string): unknown => ({ path: value, with: ({ path: next }: { path: string }) => uri(next) });
    return {
      workspaceFolders: [{ name: "deepseek-agent", uri: uri(root) }],
      fs: {
        readDirectory: async ({ path: value }: { path: string }) => (await readdir(value, { withFileTypes: true }))
          .map(entry => [entry.name, entry.isSymbolicLink() ? 64 : entry.isDirectory() ? 2 : 1]),
        stat: async ({ path: value }: { path: string }) => {
          const info = await lstat(value);
          return { size: info.size, type: info.isSymbolicLink() ? 64 : 1 };
        },
        readFile: async ({ path: value }: { path: string }) => readFile(value),
      },
    } as unknown as Parameters<typeof captureChatSuggestionContext>[0];
  }

  test("describes the real project without source contents, secrets, generated folders or host paths", async () => {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "deepseek-agent", displayName: "DeepSeek Agent",
      description: "VS Code coding assistant", scripts: { private: "DO_NOT_SEND_SCRIPT" } }));
    await writeFile(path.join(root, "index.ts"), "DO_NOT_SEND_SOURCE");
    await writeFile(path.join(root, ".env"), "DO_NOT_SEND_SECRET");
    await mkdir(path.join(root, "node_modules"));
    await symlink(path.join(root, "index.ts"), path.join(root, "linked.ts"));
    const context = await captureChatSuggestionContext(workspace(), new AbortController().signal);
    const data = JSON.parse(context);
    assert.equal(data.projects[0].description, "VS Code coding assistant");
    assert.deepEqual(data.projects[0].entries, ["index.ts", "package.json"]);
    for (const privateValue of [root, "DO_NOT_SEND_SCRIPT", "DO_NOT_SEND_SOURCE", "DO_NOT_SEND_SECRET"]) {
      assert.ok(!context.includes(privateValue));
    }
  });

  test("continues with bounded metadata for malformed or oversized manifests and honors cancellation", async () => {
    for (const content of ["{broken", "x".repeat(65 * 1024)]) {
      await writeFile(path.join(root, "package.json"), content);
      const context = JSON.parse(await captureChatSuggestionContext(workspace(), new AbortController().signal));
      assert.equal(context.projects[0].folder, "deepseek-agent");
      assert.equal(context.projects[0].description, undefined);
    }
    const controller = new AbortController(); controller.abort();
    await assert.rejects(captureChatSuggestionContext(workspace(), controller.signal), /abort/i);
  });
});
