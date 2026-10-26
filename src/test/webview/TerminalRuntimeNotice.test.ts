import * as assert from "node:assert";
import type { WorkspaceRunSnapshot } from "@/vscode/workspace";
import { buildTerminalRuntimeNotice } from "@/vscode/webviews/handlers/chat/prompt/TerminalRuntimeNotice";

suite("terminal runtime workspace notice", () => {
  test("anchors a single-root agent without disclosing the absolute host path", () => {
    const notice = buildTerminalRuntimeNotice({
      folders: [{
        alias: "Testing",
        name: "Testing",
        uri: "file:///C:/workspace/Testing",
        scheme: "file",
        localPath: "C:\\workspace\\Testing",
      }],
    } as unknown as WorkspaceRunSnapshot, "cmd.exe");

    assert.match(notice, /Active workspace root: \. \(workspace-relative\)/);
    assert.ok(!notice.includes("C:\\workspace"));
  });

  test("provides explicit aliases for multi-root workspaces", () => {
    const notice = buildTerminalRuntimeNotice({
      folders: [
        {
          alias: "api",
          name: "api",
          uri: "file:///C:/workspace/api",
          scheme: "file",
          localPath: "C:\\workspace\\api",
        },
        {
          alias: "web",
          name: "web",
          uri: "file:///C:/workspace/web",
          scheme: "file",
          localPath: "C:\\workspace\\web",
        },
      ],
    } as unknown as WorkspaceRunSnapshot, "cmd.exe");

    assert.match(notice, /Valid cwd roots: api, web/);
    assert.ok(!notice.includes("C:\\workspace"));
  });

  test("retains host paths when metadata minimization is disabled", () => {
    const snapshot = { folders: [{ alias: "api", localPath: "/home/alice/project" }] } as unknown as WorkspaceRunSnapshot;
    assert.match(buildTerminalRuntimeNotice(snapshot, "bash", false), /\/home\/alice\/project/);
    assert.ok(!buildTerminalRuntimeNotice(snapshot, "bash", true).includes("alice"));
  });
});
