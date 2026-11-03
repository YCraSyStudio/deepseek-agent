import * as assert from "assert";
import * as path from "path";
import { listWorkspaceHandler } from "@/infrastructure/tools/builtins/fileSystem/ListWorkspace";
import {
  setToolWorkspaceHost,
  type ToolWorkspaceEntryType,
  type ToolWorkspaceHost,
} from "@/infrastructure/tools/ToolWorkspace";

type DirectoryTree = Record<string, Array<[string, ToolWorkspaceEntryType]>>;

suite("list workspace", () => {
  test("normalizes empty scopes and rejects null bytes, URI and Windows absolute paths", async () => {
    createDirectoryHost({ ".": [] });
    for (const scope of [null, "", " ./ "]) { assert.match(await listWorkspaceHandler({ path: scope }), /no entries found/); }
    for (const scope of ["bad\0name", "file:secret", "C:/secrets"]) {
      await assert.rejects(listWorkspaceHandler({ path: scope }), /invalid null byte|relative to the selected workspace/);
    }
  });

  test("reports missing workspace roots and supports remote path resolution", async () => {
    const host = createDirectoryHost({ ".": [] });
    host.getRootPath = () => undefined; setToolWorkspaceHost(host);
    await assert.rejects(listWorkspaceHandler({}), /^Error: No workspace folder open$/);
    host.getWorkspaceId = () => "remote-workspace"; host.resolvePath = async value => value;
    setToolWorkspaceHost(host);
    assert.match(await listWorkspaceHandler({}), /no entries found/);
  });

  test("preserves non-Error root failures and collapses unreadable child folders", async () => {
    const host = createDirectoryHost({ ".": [["blocked", "directory"]] });
    assert.match(await listWorkspaceHandler({}), /blocked\/\n  \.\.\./);
    host.readDirectory = async () => { throw "permission denied"; };
    await assert.rejects(listWorkspaceHandler({}), /permission denied/);
  });

  test("cancels after a directory read and after a failed root read", async () => {
    for (const fails of [false, true]) {
      const controller = new AbortController(); const host = createDirectoryHost({ ".": [] });
      host.readDirectory = async () => { controller.abort(); if (fails) { throw new Error("read interrupted"); } return []; };
      await assert.rejects(listWorkspaceHandler({}, { signal: controller.signal }), { name: "AbortError" });
    }
  });

  test("truncates roots wider than sixty entries", async () => {
    createDirectoryHost({ ".": Array.from({ length: 65 }, (_, i) => [`file-${String(i).padStart(2, "0")}`, "file"]) });
    const output = await listWorkspaceHandler({});
    assert.match(output, /file-59/); assert.doesNotMatch(output, /file-60/); assert.match(output, /tree truncated/);
  });

  test("bounds deep traversal to three hundred reads and reports summarized folders", async () => {
    const host = createDirectoryHost({}); let reads = 0;
    host.readDirectory = async directory => {
      reads++;
      return directory === "."
        ? Array.from({ length: 60 }, (_, i) => [`root-${String(i).padStart(2, "0")}`, "directory"])
        : [["next", "directory"]];
    };
    const output = await listWorkspaceHandler({});
    assert.strictEqual(reads, 300); assert.match(output, /stopped after reading 300 folders/);
    assert.match(output, /folders are summarized/);
    assert.ok(output.split("\n").length < 410);
  });

  test("rolls back oversized subtrees and bounds rendered bytes for long file names", async () => {
    const tree: DirectoryTree = { ".": [] };
    for (let root = 0; root < 9; root++) {
      const directory = `root-${root}`; tree["."].push([directory, "directory"]);
      tree[directory] = [["a", "directory"], ["b", "directory"], ["c", "directory"]];
      for (const child of ["a", "b", "c"]) {
        tree[`${directory}/${child}`] = Array.from({ length: 25 }, (_, i) => [`${i}-${"é".repeat(120)}`, "file"]);
      }
    }
    const roots = [...tree["."]]; tree["."] = roots.slice(0, 1);
    createDirectoryHost(tree); const output = await listWorkspaceHandler({});
    assert.match(output, /50 files, 4 folders/); assert.match(output, /c\/\n    \.\.\./);
    tree["."] = roots;
    // Keep each subtree small enough to render, but the overall UTF-8 output bounded.
    for (const directory of tree["."].map(([name]) => name)) { tree[directory] = [["a", "directory"], ["b", "directory"]]; }
    const bounded = await listWorkspaceHandler({});
    assert.match(bounded, /output truncated after 48 KiB/); assert.ok(Buffer.byteLength(bounded) < 49 * 1024);
  });

  test("lists hidden entries and summarizes a folder with too much content", async () => {
    createDirectoryHost({
      ".": [["README.md", "file"], [".gitignore", "file"], ["node_modules", "directory"], ["src", "directory"]],
      node_modules: Array.from({ length: 30 }, (_, index) => [`pkg-${index}`, "directory"] as [string, ToolWorkspaceEntryType]),
      src: [["index.ts", "file"], ["utils", "directory"]],
      "src/utils": [["format.ts", "file"]],
    });

    const output = await listWorkspaceHandler({});

    assert.strictEqual(output.split("\n")[0], "Workspace tree for \".\" (4 files, 3 folders). Hidden entries are included; a folder shown as \"...\" holds more entries than this summary lists:");
    assert.ok(output.includes("node_modules/\n  ...\n"), output);
    assert.ok(output.includes(".gitignore\n"), output);
    assert.ok(output.includes("src/\n  utils/\n    format.ts\n  index.ts\n"), output);
    assert.ok(!output.includes("pkg-0"), "node_modules children must not be listed");
    assert.ok(output.includes("1 folder is summarized as \"...\""), output);
  });

  test("scopes the tree to one subfolder", async () => {
    createDirectoryHost({
      ".": [["src", "directory"]],
      src: [["app.ts", "file"]],
    });

    const output = await listWorkspaceHandler({ path: "./src/" });

    assert.strictEqual(output.split("\n")[0], "Workspace tree for \"src\" (1 files, 0 folders). Hidden entries are included; a folder shown as \"...\" holds more entries than this summary lists:");
    assert.ok(output.includes("\napp.ts"), output);
  });

  test("rejects paths that can escape the workspace", async () => {
    createDirectoryHost({ ".": [] });

    await assert.rejects(() => listWorkspaceHandler({ path: "../secrets" }), /stay inside the workspace/);
    await assert.rejects(() => listWorkspaceHandler({ path: "/etc" }), /relative to the selected workspace/);
    await assert.rejects(() => listWorkspaceHandler({ path: 42 }), /path must be a string/);
  });

  test("propagates cancellation as AbortError", async () => {
    createDirectoryHost({ ".": [["app.ts", "file"]] });
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => listWorkspaceHandler({}, { signal: controller.signal }),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
  });

  test("reports an unreadable scope instead of an empty tree", async () => {
    createDirectoryHost({ ".": [["src", "directory"]] });

    await assert.rejects(() => listWorkspaceHandler({ path: "missing" }), /Cannot list workspace path "missing"/);
  });
});

function createDirectoryHost(directories: DirectoryTree): ToolWorkspaceHost {
  const host: ToolWorkspaceHost = {
    getRootPath: () => path.resolve("C:/workspace"),
    readFile: async () => Buffer.from(""),
    writeFile: async () => undefined,
    stat: async () => ({ type: "unknown", size: 0 }),
    createParentDirectory: async () => undefined,
    readDirectory: async (dirPath: string) => {
      const entries = directories[dirPath];
      if (!entries) {
        throw new Error(`Missing test directory: ${dirPath}`);
      }
      return entries;
    },
  };
  setToolWorkspaceHost(host);
  return host;
}
