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

  test("rejects missing and mistyped parameters before reading the file", async () => {
    const files = new Map<string, string>([["README.md", "alpha\n"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    assert.strictEqual(await applyPatchHandler({}), "Error: path parameter is required");
    assert.strictEqual(await applyPatchHandlerForced({ path: "  ", diff: "@@ -1,1 +1,1 @@" }), "Error: path parameter is required");
    assert.strictEqual(await applyPatchHandler({ path: "README.md" }), "Error: diff parameter is required");
    assert.strictEqual(
      await applyPatchHandlerForced({ path: "README.md", diff: "@@ -1,1 +1,1 @@", expectedBeforeHash: 4 }),
      "Error: expectedBeforeHash must be a string when provided",
    );
  });

  test("reports unparseable, overlapping and empty hunk patches", async () => {
    const files = new Map<string, string>([["README.md", "alpha\nbeta\n"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    assert.match(await applyPatchHandler({ path: "README.md", diff: "not a diff" }), /invalid unified diff/);
    assert.match(
      await applyPatchHandler({ path: "README.md", diff: ["--- a/README.md", "+++ b/README.md"].join("\n") }),
      /does not contain any hunks/,
    );
    assert.match(
      await applyPatchHandlerForced({
        path: "README.md",
        diff: ["@@ -2,1 +2,1 @@", "-beta", "+changed", "@@ -1,1 +1,1 @@", "-alpha", "+first"].join("\n"),
      }),
      /overlapping hunk/,
    );
    assert.match(
      await applyPatchHandlerForced({ path: "README.md", diff: ["@@ -1,1 +1,1 @@", "-alpha", "+first", ""].join("\n") }),
      /invalid empty hunk line/,
    );
  });

  test("accepts the no-newline marker and skips unchanged context", async () => {
    const files = new Map<string, string>([["README.md", "alpha"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    const result = await applyPatchHandlerForced({
      path: "README.md",
      diff: ["@@ -1,1 +1,1 @@", "-alpha", "\\ No newline at end of file", "+beta", "\\ No newline at end of file"].join("\n"),
    });

    assert.strictEqual(JSON.parse(result).type, "filePatch");
    assert.strictEqual(files.get("README.md"), "beta");
  });

  test("rejects binary and oversized files", async () => {
    const files = new Map<string, string>([["README.md", "\u0000alpha"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));
    assert.match(await applyPatchHandler({ path: "README.md", diff: "@@ -1,1 +1,1 @@\n-alpha" }), /binary files are not supported/);

    const large = createMemoryWorkspaceHost(workspaceRoot, new Map<string, string>([["README.md", "alpha\n"]]));
    large.stat = async () => ({ type: "file", size: 17 * 1024 * 1024 });
    setToolWorkspaceHost(large);
    assert.match(await applyPatchHandler({ path: "README.md", diff: "@@ -1,1 +1,1 @@\n-alpha" }), /larger than 16 MiB are not supported/);
  });

  test("returns diff preparation and write failures without claiming success", async () => {
    const files = new Map<string, string>([["README.md", "alpha\n"]]);
    const host = createMemoryWorkspaceHost(workspaceRoot, files);
    host.prepareFileDiff = async () => { throw new Error("preview unavailable"); };
    setToolWorkspaceHost(host);

    const confirmation = JSON.parse(await applyPatchHandler({ path: "README.md", diff: "@@ -1,1 +1,1 @@\n-alpha\n+beta" })) as { requiresConfirmation: boolean };
    assert.strictEqual(confirmation.requiresConfirmation, true);

    host.writeFile = async () => { throw new Error("disk full"); };
    const failure = await applyPatchHandlerForced({ path: "README.md", diff: "@@ -1,1 +1,1 @@\n-alpha\n+beta" });
    assert.match(failure, /Error applying patch to 'README.md': disk full/);
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
