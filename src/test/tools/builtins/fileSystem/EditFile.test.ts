import * as assert from "assert";
import * as path from "path";
import { editFileHandler, editFileHandlerForced } from "@/infrastructure/tools/builtins/fileSystem/EditFile";
import { setToolWorkspaceHost, type ToolWorkspaceEntryType, type ToolWorkspaceHost, type ToolWorkspaceStat } from "@/infrastructure/tools/ToolWorkspace";

suite("edit_file tool", () => {
  const workspaceRoot = path.resolve("/tmp/deepseek-agent-edit-file");

  test("requires replaceAll when search text is ambiguous", async () => {
    const files = new Map<string, string>([["README.md", "alpha beta alpha"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    const result = await editFileHandler({
      path: "README.md",
      search: "alpha",
      replace: "gamma",
    });

    assert.match(result, /matched 2 times/);
    assert.strictEqual(files.get("README.md"), "alpha beta alpha");
  });

  test("previews before confirmation and applies only in forced handler", async () => {
    const files = new Map<string, string>([["README.md", "alpha beta"]]);
    const previews: string[] = [];
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files, previews));

    const confirmation = await editFileHandler({
      path: "README.md",
      search: "alpha",
      replace: "gamma",
    });
    const parsed = JSON.parse(confirmation) as { requiresConfirmation: boolean; filePath: string };

    assert.strictEqual(parsed.requiresConfirmation, true);
    assert.strictEqual(parsed.filePath, "README.md");
    assert.deepStrictEqual(previews, ["README.md:gamma beta"]);
    assert.strictEqual(files.get("README.md"), "alpha beta");

    const applied = await editFileHandlerForced({
      path: "README.md",
      search: "alpha",
      replace: "gamma",
    });
    const appliedParsed = JSON.parse(applied) as { type: string; replacementCount: number };

    assert.strictEqual(appliedParsed.type, "fileEdit");
    assert.strictEqual(appliedParsed.replacementCount, 1);
    assert.strictEqual(files.get("README.md"), "gamma beta");
    assert.deepStrictEqual(previews, ["README.md:gamma beta"]);
  });

  test("uses workspace path validation", async () => {
    const files = new Map<string, string>([["README.md", "alpha beta"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    const result = await editFileHandlerForced({
      path: "../outside.txt",
      search: "alpha",
      replace: "gamma",
    });

    assert.match(result, /traversal/);
  });

  test("matches LF search text in a CRLF file and preserves CRLF", async () => {
    const files = new Map<string, string>([["README.md", "alpha\r\nbeta\r\ngamma\r\n"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    const result = await editFileHandlerForced({
      path: "README.md",
      search: "alpha\nbeta",
      replace: "first\nsecond",
    });

    assert.strictEqual(JSON.parse(result).type, "fileEdit");
    assert.strictEqual(files.get("README.md"), "first\r\nsecond\r\ngamma\r\n");
  });

  test("matches CRLF search text in an LF file and preserves LF", async () => {
    const files = new Map<string, string>([["README.md", "alpha\nbeta\ngamma\n"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    await editFileHandlerForced({
      path: "README.md",
      search: "alpha\r\nbeta",
      replace: "first\r\nsecond",
    });

    assert.strictEqual(files.get("README.md"), "first\nsecond\ngamma\n");
  });

  test("keeps line endings outside a normalized match byte-for-byte", async () => {
    const files = new Map<string, string>([["README.md", "keep-crlf\r\nalpha\nbeta\r\nkeep-lf\n"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    await editFileHandlerForced({
      path: "README.md",
      search: "alpha\r\nbeta",
      replace: "changed",
    });

    assert.strictEqual(files.get("README.md"), "keep-crlf\r\nchanged\r\nkeep-lf\n");
  });

  test("rejects missing and mistyped parameters before reading the file", async () => {
    const files = new Map<string, string>([["README.md", "alpha"]]);
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, files));

    assert.strictEqual(await editFileHandler({}), "Error: path parameter is required");
    assert.strictEqual(await editFileHandlerForced({ path: " ", search: "alpha", replace: "beta" }), "Error: path parameter is required");
    assert.strictEqual(await editFileHandler({ path: "README.md", replace: "beta" }), "Error: search parameter is required and cannot be empty");
    assert.strictEqual(await editFileHandler({ path: "README.md", search: "", replace: "beta" }), "Error: search parameter is required and cannot be empty");
    assert.strictEqual(await editFileHandler({ path: "README.md", search: "alpha" }), "Error: replace parameter is required");
    assert.strictEqual(
      await editFileHandlerForced({ path: "README.md", search: "alpha", replace: "beta", replaceAll: "yes" }),
      "Error: replaceAll parameter must be a boolean when provided",
    );
  });

  test("rejects binary, oversized, stale and unmatched files", async () => {
    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, new Map<string, string>([["README.md", "\u0000alpha"]])));
    assert.match(await editFileHandler({ path: "README.md", search: "alpha", replace: "beta" }), /binary files are not supported/);

    const large = createMemoryWorkspaceHost(workspaceRoot, new Map<string, string>([["README.md", "alpha"]]));
    large.stat = async () => ({ type: "file", size: 17 * 1024 * 1024 });
    setToolWorkspaceHost(large);
    assert.match(await editFileHandler({ path: "README.md", search: "alpha", replace: "beta" }), /larger than 16 MiB are not supported/);

    const stale = createMemoryWorkspaceHost(workspaceRoot, new Map<string, string>([["README.md", "alpha"]]));
    setToolWorkspaceHost(stale);
    assert.match(
      await editFileHandlerForced({ path: "README.md", search: "alpha", replace: "beta", expectedBeforeHash: "0".repeat(64) }),
      /file changed after confirmation/,
    );

    setToolWorkspaceHost(createMemoryWorkspaceHost(workspaceRoot, new Map<string, string>([["README.md", "alpha"]])));
    assert.match(await editFileHandler({ path: "README.md", search: "gamma", replace: "beta" }), /search text not found/);
  });

  test("replaces every match when replaceAll is set and tolerates preview failures", async () => {
    const files = new Map<string, string>([["README.md", "alpha beta alpha"]]);
    const host = createMemoryWorkspaceHost(workspaceRoot, files);
    host.prepareFileDiff = async () => { throw new Error("preview unavailable"); };
    setToolWorkspaceHost(host);

    const confirmation = JSON.parse(await editFileHandler({ path: "README.md", search: "alpha", replace: "gamma", replaceAll: true })) as { requiresConfirmation: boolean };
    assert.strictEqual(confirmation.requiresConfirmation, true);

    const applied = JSON.parse(await editFileHandlerForced({ path: "README.md", search: "alpha", replace: "gamma", replaceAll: true })) as { replacementCount: number };
    assert.strictEqual(applied.replacementCount, 2);
    assert.strictEqual(files.get("README.md"), "gamma beta gamma");
  });
});

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
