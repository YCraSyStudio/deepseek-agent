import assert from "node:assert/strict";
import type { Uri as VsCodeUri } from "vscode";
import { createInlineDiffPreview } from "@/vscode/tools/InlineDiffPreview";
import { hostState, Range, resetVsCodeMock, Uri, window as vscodeWindow } from "../../../support/VsCodeMock";

interface DecorationCall { type: { disposed?: boolean; options?: unknown }; ranges: Range[] }

const fileUri = (value: string): VsCodeUri => Uri.file(value) as unknown as VsCodeUri;

function documentFor(text: string, uriValue = "/workspace/a.ts") {
  const lines = text.split("\n");
  return {
    uri: Uri.file(uriValue),
    lineCount: lines.length,
    lineAt(line: number) {
      assert.ok(line >= 0 && line < lines.length, `line ${line} outside the fixture`);
      return { range: { end: { character: lines[line]!.length } } };
    },
  };
}

function mountEditor(document: unknown, calls: DecorationCall[]) {
  const editor = {
    document,
    setDecorations(type: DecorationCall["type"], ranges: Range[]) { calls.push({ type, ranges }); },
  };
  vscodeWindow.visibleTextEditors = [editor as never];
  return editor;
}

suite("inline diff preview", () => {
  setup(() => { resetVsCodeMock(); });

  test("ignores hidden documents and unchanged content", async () => {
    const preview = createInlineDiffPreview();
    await preview.show(fileUri("/workspace/a.ts"), "one", "two");
    assert.deepEqual(hostState.decorations, []);

    const calls: DecorationCall[] = [];
    mountEditor(documentFor("one", "/workspace/other.ts"), calls);
    await preview.show(fileUri("/workspace/a.ts"), "one", "two");
    assert.equal(calls.length, 0);
    assert.deepEqual(hostState.decorations, []);

    mountEditor(documentFor("one"), calls);
    await preview.show(fileUri("/workspace/a.ts"), "same", "same");
    assert.equal(calls.length, 0);
    assert.deepEqual(hostState.decorations, []);
  });

  test("decorates the changed line and a single-line addition", async () => {
    const calls: DecorationCall[] = [];
    mountEditor(documentFor("one\ntwo\nthree"), calls);
    const preview = createInlineDiffPreview();
    await preview.show(fileUri("/workspace/a.ts"), "one\ntwo\nthree", "one\nTWO\nthree");

    assert.equal(hostState.decorations.length, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]!.ranges.map((range) => [range.start.line, range.start.character, range.end.line, range.end.character]), [[1, 0, 1, 3]]);
    assert.deepEqual(calls[1]!.ranges.map((range) => [range.start.line, range.start.character]), [[0, 3]]);
    assert.equal((calls[1]!.type.options as { after: { contentText: string } }).after.contentText, "  + TWO");
    assert.equal(hostState.decorations.every((decoration) => decoration.disposed === false), true);

    preview.clear();
    assert.equal(calls.length, 4);
    assert.deepEqual(calls.slice(2).map((call) => call.ranges), [[], []]);
    assert.equal(hostState.decorations.every((decoration) => decoration.disposed === true), true);
    preview.clear();
    assert.equal(calls.length, 4);
  });

  test("labels multi-line additions without a removal range", async () => {
    const calls: DecorationCall[] = [];
    mountEditor(documentFor("a"), calls);
    const preview = createInlineDiffPreview();
    await preview.show(fileUri("/workspace/a.ts"), "a", "a\nb\nc");

    assert.equal(calls.length, 1);
    assert.equal((calls[0]!.type.options as { after: { contentText: string } }).after.contentText, "  + b … (+1 lines)");
    assert.equal(hostState.decorations.length, 2);
  });

  test("keeps only the removal decoration when the addition is blank", async () => {
    const calls: DecorationCall[] = [];
    mountEditor(documentFor("a\nb"), calls);
    const preview = createInlineDiffPreview();
    await preview.show(fileUri("/workspace/a.ts"), "a\nb", "a");

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.ranges.map((range) => [range.start.line, range.end.line, range.end.character]), [[1, 1, 1]]);
    assert.equal((hostState.decorations[1]!.options as { after: { contentText: string } }).after.contentText, "");
  });

  test("tolerates documents without lines", async () => {
    const calls: DecorationCall[] = [];
    mountEditor({ uri: Uri.file("/workspace/a.ts"), lineCount: 0, lineAt() { throw new Error("lineAt must not run"); } }, calls);
    const preview = createInlineDiffPreview();
    await preview.show(fileUri("/workspace/a.ts"), "a", "b");
    assert.equal(hostState.decorations.length, 2);
    assert.equal(calls.length, 0);

    preview.clear();
    assert.deepEqual(calls.map((call) => call.ranges), [[], []]);
  });

  test("truncates long addition labels", async () => {
    const calls: DecorationCall[] = [];
    mountEditor(documentFor("head"), calls);
    const preview = createInlineDiffPreview();
    await preview.show(fileUri("/workspace/a.ts"), "head", `head\n${"y".repeat(200)}`);

    const label = (calls[0]!.type.options as { after: { contentText: string } }).after.contentText;
    assert.equal(label.startsWith("  + yyy"), true);
    assert.equal(label.endsWith("…"), true);
    assert.equal(label.length, 100);
  });
});
