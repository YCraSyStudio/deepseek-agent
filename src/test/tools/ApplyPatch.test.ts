import * as assert from "assert";
import { createHash } from "crypto";
import * as path from "path";
import { applyPatchHandler, applyPatchHandlerForced } from "@/infrastructure/tools/builtins/fileSystem/ApplyPatch";
import { setToolWorkspaceHost, type ToolWorkspaceEntryType, type ToolWorkspaceHost, type ToolWorkspaceStat } from "@/infrastructure/tools/ToolWorkspace";

suite("apply_patch tool", () => {
  const workspaceRoot = path.resolve("/tmp/deepseek-agent-apply-patch");

  test("previews before confirmation and applies only in forced handler", async () => {
    const files = new Map<string, string>([["README.md", "alpha\nbeta\n"]]);
    const previews: string[] = [];
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files, previews));

    const diff = [
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1,2 +1,2 @@",
      "-alpha",
      "+gamma",
      " beta",
    ].join("\n");

    const confirmation = await applyPatchHandler({
      path: "README.md",
      diff,
      expectedBeforeHash: hashText("alpha\nbeta\n"),
    });
    const parsed = JSON.parse(confirmation) as { requiresConfirmation: boolean; filePath: string };

    assert.strictEqual(parsed.requiresConfirmation, true);
    assert.strictEqual(parsed.filePath, "README.md");
    assert.deepStrictEqual(previews, ["README.md:gamma\nbeta\n"]);
    assert.strictEqual(files.get("README.md"), "alpha\nbeta\n");

    const applied = await applyPatchHandlerForced({
      path: "README.md",
      diff,
      expectedBeforeHash: hashText("alpha\nbeta\n"),
    });
    const appliedParsed = JSON.parse(applied) as { type: string; beforeHash: string; afterHash: string };

    assert.strictEqual(appliedParsed.type, "filePatch");
    assert.strictEqual(appliedParsed.beforeHash, hashText("alpha\nbeta\n"));
    assert.strictEqual(appliedParsed.afterHash, hashText("gamma\nbeta\n"));
    assert.strictEqual(files.get("README.md"), "gamma\nbeta\n");
  });

  test("rejects stale expectedBeforeHash", async () => {
    const files = new Map<string, string>([["README.md", "changed\n"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    const result = await applyPatchHandlerForced({
      path: "README.md",
      diff: ["--- a/README.md", "+++ b/README.md", "@@ -1,1 +1,1 @@", "-changed", "+next"].join("\n"),
      expectedBeforeHash: hashText("old\n"),
    });

    assert.match(result, /file changed since it was read/);
    assert.strictEqual(files.get("README.md"), "changed\n");
  });

  test("rejects mismatched patch context", async () => {
    const files = new Map<string, string>([["README.md", "alpha\n"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    const result = await applyPatchHandlerForced({
      path: "README.md",
      diff: ["--- a/README.md", "+++ b/README.md", "@@ -1,1 +1,1 @@", "-missing", "+next"].join("\n"),
    });

    assert.match(result, /context mismatch/);
    assert.strictEqual(files.get("README.md"), "alpha\n");
  });

  test("applies an LF patch to a CRLF file without changing unrelated endings", async () => {
    const before = "alpha\r\nbeta\r\ngamma\r\n";
    const files = new Map<string, string>([["README.md", before]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    const result = await applyPatchHandlerForced({
      path: "README.md",
      diff: [
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1,3 +1,3 @@",
        " alpha",
        "-beta",
        "+changed",
        " gamma",
      ].join("\n"),
      expectedBeforeHash: hashText(before),
    });

    assert.strictEqual(JSON.parse(result).type, "filePatch");
    assert.strictEqual(files.get("README.md"), "alpha\r\nchanged\r\ngamma\r\n");
  });

  test("preserves mixed endings on unchanged lines", async () => {
    const before = "alpha\r\nbeta\ngamma\r\n";
    const files = new Map<string, string>([["README.md", before]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    await applyPatchHandlerForced({
      path: "README.md",
      diff: ["@@ -2,1 +2,1 @@", "-beta", "+changed"].join("\n"),
    });

    assert.strictEqual(files.get("README.md"), "alpha\r\nchanged\r\ngamma\r\n");
  });
});

function hashText(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function createMemoryWorkspaceHost(workspaceRoot: string, files: Map<string, string>, previews: string[] = []): ToolWorkspaceHost {
  return {
    getRootPath: () => workspaceRoot,
    readFile: async (filePath: string) => {
      const content = files.get(filePath);
      if (content === undefined) {
        throw Object.assign(new Error("EntryNotFound"), { code: "EntryNotFound" });
      }
      return Buffer.from(content, "utf-8");
    },
    writeFile: async (filePath: string, content: Uint8Array) => {
      files.set(filePath, Buffer.from(content).toString("utf-8"));
    },
    stat: async (filePath: string): Promise<ToolWorkspaceStat> => {
      const content = files.get(filePath);
      if (content === undefined) {
        throw Object.assign(new Error("EntryNotFound"), { code: "EntryNotFound" });
      }
      return { type: "file", size: Buffer.byteLength(content, "utf-8") };
    },
    createParentDirectory: async () => {},
    readDirectory: async (): Promise<Array<[string, ToolWorkspaceEntryType]>> => [],
    prepareFileDiff: async (filePath: string, _before: string, after: string) => {
      previews.push(`${filePath}:${after}`);
    },
  };
}
