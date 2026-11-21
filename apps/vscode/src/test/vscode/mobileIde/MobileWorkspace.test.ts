import assert from "node:assert/strict";
import { buildWorkspaceTree } from "@webview/workspace/WorkspaceTree";

function paths(branch: ReturnType<typeof buildWorkspaceTree>, prefix = ""): string[] {
  const folders = [...branch.folders].flatMap(([name, child]) => paths(child, `${prefix}${name}/`));
  return [...folders, ...branch.files.map(file => file.path)].sort();
}

suite("mobile workspace explorer tree", () => {
  test("rebuilds the tree from a refreshed listing without stale entries", () => {
    const before = buildWorkspaceTree(["src/notes.txt", "docs/readme.md"]);
    assert.deepEqual(paths(before), ["docs/readme.md", "src/notes.txt"]);
    const after = buildWorkspaceTree(["src/added.txt"]);
    assert.deepEqual(paths(after), ["src/added.txt"]);
    assert.deepEqual([...after.folders.keys()], ["src"]);
  });
});
