import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { selectUnitTests } from "./unit-test-selection.mjs";

const root = resolve("src/test");
const files = ["chat/Chat.test.ts", "chat/context/Context.test.ts", "chatty/Other.test.ts"].map(
  (file) => resolve(root, file),
);

test("selects a unit test directory or a single file without matching sibling names", () => {
  assert.deepEqual(selectUnitTests(files, root, []), files);
  assert.deepEqual(selectUnitTests(files, root, ["--path", "chat"]), files.slice(0, 2));
  assert.deepEqual(
    selectUnitTests(files, root, ["--path", "chat/Chat.test.ts"]),
    files.slice(0, 1),
  );
});

test("rejects invalid, repeated and unmatched paths", () => {
  for (const args of [
    ["--path"],
    ["--path", "--grep"],
    ["--path", "../chat"],
    ["--path", "/tmp"],
    ["--path", "missing"],
    ["--path", "chat", "--path", "chat"],
  ]) {
    assert.throws(() => selectUnitTests(files, root, args));
  }
});
