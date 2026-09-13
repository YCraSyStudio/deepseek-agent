import * as assert from "node:assert";
import type { WorkspaceRunSnapshot } from "@/vscode/workspace";
import { buildTerminalRuntimeNotice } from "@/vscode/webviews/handlers/chat/prompt/TerminalRuntimeNotice";

suite("terminal runtime workspace notice", () => {
  test("anchors a single-root agent to the trusted host path", () => {
    const notice = buildTerminalRuntimeNotice({
      folders: [{
        alias: "Testing",
        name: "Testing",
        uri: "file:///C:/workspace/Testing",
        scheme: "file",
        localPath: "C:\\workspace\\Testing",
      }],
    } as unknown as WorkspaceRunSnapshot, "cmd.exe");

    assert.match(notice, /Active workspace root: C:\\workspace\\Testing/);
    assert.match(notice, /Omit cwd to run there/);
    assert.match(notice, /Do not call a tool to discover this path/);
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

    assert.match(notice, /api \(C:\\workspace\\api\)/);
    assert.match(notice, /web \(C:\\workspace\\web\)/);
    assert.match(notice, /never guess another absolute path/);
  });
});
