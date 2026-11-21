import assert from "node:assert/strict";
import { listDirHandler } from "@/infrastructure/tools/builtins/fileSystem/ListDir";
import { listWorkspaceHandler } from "@/infrastructure/tools/builtins/fileSystem/ListWorkspace";
import { analyzeImagesTool } from "@/infrastructure/tools/builtins/vision/AnalyzeImages";
import { setToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import type { ToolHandlerContext } from "@/application/tools/Types";

function host(entries: Record<string, Array<[string, "file" | "directory"]>>, root = "/workspace"): ToolWorkspaceHost {
  return {
    getRootPath: () => root,
    getWorkspaceId: () => "workspace",
    readDirectory: async (dirPath: string) => {
      const value = entries[dirPath];
      if (value === undefined) { throw new Error(`ENOENT ${dirPath}`); }
      return value;
    },
  } as unknown as ToolWorkspaceHost;
}

suite("directory and image built-in tools", () => {
  test("list_directory filters hidden and excluded entries and honours showHidden", async () => {
    setToolWorkspaceHost(host({ ".": [["src", "directory"], ["readme.md", "file"], [".env", "file"], ["node_modules", "directory"], [".git", "directory"]], src: [] }));
    const visible = await listDirHandler({}, undefined);
    assert.match(visible, /\[dir\] src/);
    assert.match(visible, /\[file\] readme\.md/);
    assert.doesNotMatch(visible, /\.env|node_modules|\.git/);
    const hidden = await listDirHandler({ path: "src", showHidden: true }, undefined);
    assert.match(hidden, /empty directory: src/);
  });

  test("list_directory reports empty and unreadable directories", async () => {
    setToolWorkspaceHost(host({ ".": [], "missing": undefined as never }));
    assert.equal(await listDirHandler({}, undefined), "(empty directory: .)");
    assert.match(await listDirHandler({ path: "missing" }, undefined), /Error listing directory 'missing': ENOENT missing/);
  });

  test("list_directory bounds entry count and bytes", async () => {
    setToolWorkspaceHost(host({ ".": Array.from({ length: 600 }, (_, index) => [`file-${index}.ts`, "file"] as [string, "file"]) }));
    const countBounded = await listDirHandler({}, undefined);
    assert.match(countBounded, /directory truncated; 100 entries omitted/);
    setToolWorkspaceHost(host({ ".": Array.from({ length: 100 }, (_, index) => [`${"x".repeat(900)}-${index}`, "file"] as [string, "file"]) }));
    const bytesBounded = await listDirHandler({}, undefined);
    assert.match(bytesBounded, /directory truncated; \d+ entries omitted/);
  });

  test("list_workspace renders a sorted tree, hidden entries and collapsed folders", async () => {
    setToolWorkspaceHost(host({
      ".": [["zeta.ts", "file"], ["alpha", "directory"], ["node_modules", "directory"], ["many", "directory"]],
      alpha: [["nested", "directory"], ["a.ts", "file"]],
      "alpha/nested": [["deep.ts", "file"]],
      many: Array.from({ length: 30 }, (_, index) => [`file-${index}.ts`, "file"] as [string, "file"]),
      node_modules: [["pkg", "directory"]],
      "node_modules/pkg": [["index.js", "file"]],
    }));
    const tree = await listWorkspaceHandler({}, undefined);
    assert.match(tree, /Workspace tree for "." \(4 files, 5 folders\)/);
    assert.match(tree, /alpha\/\n  nested\/\n    deep\.ts/);
    assert.match(tree, /many\/\n  \.\.\./);
    assert.match(tree, /node_modules\//);
    assert.match(tree, /1 folder is summarized/);
    assert.ok(tree.indexOf("alpha/") < tree.indexOf("zeta.ts"));
  });

  test("list_workspace notes empty trees and truncated root children", async () => {
    setToolWorkspaceHost(host({ ".": [] }));
    const empty = await listWorkspaceHandler({}, undefined);
    assert.match(empty, /no entries found/);
    setToolWorkspaceHost(host({ ".": Array.from({ length: 61 }, (_, index) => [`file-${index}.ts`, "file"] as [string, "file"]) }));
    const bounded = await listWorkspaceHandler({}, undefined);
    assert.match(bounded, /tree truncated after 400 entries/);
  });

  test("list_workspace supports a scoped subtree and rejects traversal, absolute and malformed paths", async () => {
    setToolWorkspaceHost(host({ ".": [["src", "directory"]], src: [["index.ts", "file"]] }));
    const scoped = await listWorkspaceHandler({ path: "./src/" }, undefined);
    assert.match(scoped, /Workspace tree for "src"/);
    for (const [path, message] of [
      ["../secret", /must stay inside/],
      ["/etc", /must be relative/],
      ["C:\\secret", /must be relative/],
      ["file:///workspace", /must be relative/],
      ["a\0b", /null byte/],
      [42, /must be a string/],
    ] as const) {
      await assert.rejects(listWorkspaceHandler({ path }, undefined), message);
    }
  });

  test("list_workspace reports unreadable roots and cancellation", async () => {
    setToolWorkspaceHost(host({}));
    await assert.rejects(listWorkspaceHandler({}, undefined), /Cannot list workspace path "\.": ENOENT \./);
    const controller = new AbortController();
    controller.abort();
    setToolWorkspaceHost(host({ ".": [] }));
    await assert.rejects(listWorkspaceHandler({}, { signal: controller.signal } as ToolHandlerContext), { name: "AbortError" });
    setToolWorkspaceHost({
      getRootPath: () => undefined,
      getWorkspaceId: () => undefined,
      readDirectory: async () => [],
    } as unknown as ToolWorkspaceHost);
    await assert.rejects(listWorkspaceHandler({}, undefined), /No workspace folder open/);
  });

  test("analyze_images validates its context, question and bounded string arrays", async () => {
    assert.equal(await analyzeImagesTool.handler({}, undefined), "Error: no images are available to analyze in this generation.");
    const calls: unknown[] = [];
    const context = { analyzeImages: async (request: unknown) => { calls.push(request); return "described"; }, signal: new AbortController().signal } as unknown as ToolHandlerContext;
    assert.equal(await analyzeImagesTool.handler({}, context), "Error: question is required.");
    assert.equal(await analyzeImagesTool.handler({ question: "Describe", screenshot_ids: "one" }, context), "Error: invalid screenshot_ids.");
    assert.equal(await analyzeImagesTool.handler({ question: "Describe", image_ids: "one" }, context), "Error: invalid image_ids.");
    assert.equal(await analyzeImagesTool.handler({ question: "Describe", image_ids: Array.from({ length: 9 }, () => "id") }, context), "Error: invalid image_ids.");
    assert.equal(await analyzeImagesTool.handler({ question: "Describe", paths: [""] }, context), "Error: invalid paths.");
    assert.equal(await analyzeImagesTool.handler({ question: "Describe", paths: ["x".repeat(2049)] }, context), "Error: invalid paths.");
    assert.equal(await analyzeImagesTool.handler({ question: " Describe ", image_ids: ["one", "two"], screenshot_ids: ["1"], paths: ["a.png"] }, context), "described");
    assert.deepEqual(calls, [{ question: "Describe", attachmentIds: ["one", "two"], screenshotIds: ["1"], paths: ["a.png"] }]);
  });
});
