import assert from "node:assert/strict";
import { insertCodeIntoActiveEditor } from "@/vscode/editor/EditorActions";
import { captureCurrentWorkspaceBinding } from "@/vscode/workspace";
import { dialogs, Position, resetVsCodeMock, Selection, Uri, window, workspace } from "../../../support/VsCodeMock";

suite("insert chat code into the active editor", () => {
  setup(() => { resetVsCodeMock(); workspace.workspaceFolders = [{ name: "Project", uri: Uri.file("/tmp/editor-project") }]; });
  teardown(() => { resetVsCodeMock(); });
  function editor(file = "/tmp/editor-project/file.ts") {
    const selections = [new Selection(new Position(0, 0), new Position(0, 2)), new Selection(new Position(0, 4), new Position(0, 6))];
    const replacements: Array<{ selection: unknown; code: string }> = [];
    const value = { document: { uri: Uri.file(file), isUntitled: false, lineCount: 1, languageId: "typescript",
      offsetAt: (position: Position) => position.line ? 8 : position.character,
      positionAt: (offset: number) => new Position(0, offset), getText: () => "old code" },
      selection: selections[0], selections,
      edit: async (apply: (builder: { replace(selection: unknown, code: string): void }) => void) => { apply({ replace: (selection, code) => { replacements.push({ selection, code }); } }); return true; } };
    return { value, replacements, selections };
  }
  test("replaces every current selection in the bound workspace through one editor edit", async () => {
    const current = editor(); window.activeTextEditor = current.value;
    await insertCodeIntoActiveEditor("new code", captureCurrentWorkspaceBinding());
    assert.deepEqual(current.replacements, current.selections.map(selection => ({ selection, code: "new code" })));
  });
  test("requires an active editor belonging to the chat workspace", async () => {
    const binding = captureCurrentWorkspaceBinding(); await insertCodeIntoActiveEditor("new code", binding);
    const foreign = editor("/tmp/other-project/file.ts"); window.activeTextEditor = foreign.value;
    await insertCodeIntoActiveEditor("new code", binding);
    assert.deepEqual(foreign.replacements, []); assert.equal(dialogs.informationMessages.length, 2);
    assert.match(String(dialogs.informationMessages[0][0]), /belongs to this chat workspace/);
  });
  test("rejects a stale workspace binding before modifying the active editor", async () => {
    const binding = captureCurrentWorkspaceBinding(); const current = editor(); window.activeTextEditor = current.value;
    workspace.workspaceFolders = [{ name: "Renamed", uri: Uri.file("/tmp/editor-project") }];
    await assert.rejects(insertCodeIntoActiveEditor("new code", binding), /changed.*Confirm/);
    assert.deepEqual(current.replacements, []);
  });
});
