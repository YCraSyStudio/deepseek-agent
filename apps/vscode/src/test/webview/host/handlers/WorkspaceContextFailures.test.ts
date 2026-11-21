import assert from "node:assert/strict";
import { captureCurrentWorkspaceBinding, captureWorkspaceRunSnapshot, resolveWorkspaceContext } from "@/vscode/workspace";
import { resetVsCodeMock, Uri, workspace } from "../../../support/VsCodeMock";

suite("workspace connection state failures", () => {
  setup(() => { resetVsCodeMock(); });
  teardown(() => { resetVsCodeMock(); });
  test("permits an empty workspace snapshot and requires confirmation after opening a folder", () => {
    const empty = captureCurrentWorkspaceBinding(); assert.equal(resolveWorkspaceContext(empty).state, "empty");
    assert.deepEqual(captureWorkspaceRunSnapshot(empty).folders, []);
    workspace.workspaceFolders = [{ name: "Project", uri: Uri.file("/tmp/context-project") }];
    assert.equal(resolveWorkspaceContext(empty).state, "changed");
    assert.throws(() => captureWorkspaceRunSnapshot(empty), /changed.*Confirm the updated workspace/);
  });
  test("rejects a disconnected workspace using its saved name", () => {
    workspace.workspaceFolders = [{ name: "Original", uri: Uri.file("/tmp/original-project") }];
    const binding = captureCurrentWorkspaceBinding();
    workspace.workspaceFolders = [{ name: "Other", uri: Uri.file("/tmp/other-project") }];
    assert.equal(resolveWorkspaceContext(binding).state, "disconnected");
    assert.throws(() => captureWorkspaceRunSnapshot(binding), /Workspace "Original" is not open/);
  });
  test("rejects changed workspace revisions and accepts a freshly captured binding", () => {
    const uri = Uri.file("/tmp/context-project"); workspace.workspaceFolders = [{ name: "Original", uri }];
    const binding = captureCurrentWorkspaceBinding(); workspace.workspaceFolders = [{ name: "Renamed", uri }];
    assert.equal(resolveWorkspaceContext(binding).state, "changed");
    assert.throws(() => captureWorkspaceRunSnapshot(binding), /changed.*Confirm the updated workspace/);
    const updated = captureCurrentWorkspaceBinding(); assert.equal(resolveWorkspaceContext(updated).state, "connected");
    assert.equal(captureWorkspaceRunSnapshot(updated).folders[0].name, "Renamed");
  });
});
