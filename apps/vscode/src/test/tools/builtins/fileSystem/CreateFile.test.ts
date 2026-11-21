import * as assert from "node:assert";
import { setToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import { createFileHandler, createFileHandlerForced } from "@/infrastructure/tools/builtins/fileSystem/CreateFile";

suite("create_file missing-file guard", () => {
  test("does not overwrite a file that appeared after web-tainted approval", async () => {
    let writes = 0;
    setToolWorkspaceHost(createHost(new Map([["new.txt", "appeared"]]), { writeFile: async () => { writes += 1; } }));
    const result = await createFileHandlerForced({ path: "new.txt", content: "replacement", expectedBeforeHash: "missing" });
    assert.match(result, /file appeared after approval/i);
    assert.strictEqual(writes, 0);
  });

  test("requires a path in both handlers", async () => {
    setToolWorkspaceHost(createHost(new Map()));
    assert.strictEqual(await createFileHandler({}), "Error: path parameter is required");
    assert.strictEqual(await createFileHandlerForced({ content: "data" }), "Error: path parameter is required");
  });

  test("reports unexpected stat failures instead of assuming the file is new", async () => {
    setToolWorkspaceHost(createHost(new Map(), {
      stat: async () => { throw new Error("permission denied"); },
    }));
    assert.match(await createFileHandler({ path: "new.txt" }), /Error checking if file "new.txt" exists: permission denied/);
  });

  test("asks for confirmation for new and existing files", async () => {
    const files = new Map([["existing.txt", "old"]]);
    setToolWorkspaceHost(createHost(files));
    const created = JSON.parse(await createFileHandler({ path: "new.txt" })) as { requiresConfirmation: boolean; beforeHash: string; warningMessage: string };
    assert.strictEqual(created.requiresConfirmation, true);
    assert.strictEqual(created.beforeHash, "missing");
    assert.match(created.warningMessage, /Create the file/);
    const overwritten = JSON.parse(await createFileHandler({ path: "existing.txt" })) as { beforeHash: string; warningMessage: string };
    assert.match(overwritten.beforeHash, /^[a-f0-9]{64}$/);
    assert.match(overwritten.warningMessage, /already exists/);
  });

  test("creates new files and overwrites confirmed files with a unified diff", async () => {
    const files = new Map<string, string>();
    setToolWorkspaceHost(createHost(files));
    const created = JSON.parse(await createFileHandlerForced({ path: "nested/new.txt", content: "hello\n" })) as { type: string; summary: string; beforeHash?: string; diffStats?: unknown };
    assert.strictEqual(created.type, "fileWrite");
    assert.match(created.summary, /File created/);
    assert.strictEqual(created.beforeHash, undefined);
    assert.strictEqual(files.get("nested/new.txt"), "hello\n");

    files.set("existing.txt", "old\n");
    const overwritten = JSON.parse(await createFileHandlerForced({ path: "existing.txt", content: "new\n" })) as { summary: string; diffStats?: unknown };
    assert.match(overwritten.summary, /File overwritten/);
    assert.ok(overwritten.diffStats);
  });

  test("omits the diff for binary files and never writes an unconfirmed overwrite", async () => {
    const files = new Map([["blob.bin", Buffer.from([0x61, 0x00, 0x62]).toString("utf-8")]]);
    setToolWorkspaceHost(createHost(files));
    const result = JSON.parse(await createFileHandlerForced({ path: "blob.bin", content: "text" })) as { binary: boolean; diff: string };
    assert.strictEqual(result.binary, true);
    assert.strictEqual(result.diff, "");
    assert.strictEqual(files.get("blob.bin"), "text");

    files.set("existing.txt", "old");
    const stale = await createFileHandlerForced({ path: "existing.txt", content: "new", expectedBeforeHash: "0".repeat(64) });
    assert.match(stale, /file changed after confirmation/);
    assert.strictEqual(files.get("existing.txt"), "old");
  });

  test("returns directory and write failures as tool errors", async () => {
    const files = new Map<string, string>();
    setToolWorkspaceHost(createHost(files, {
      createParentDirectory: async () => { throw new Error("read-only workspace"); },
    }));
    assert.match(await createFileHandlerForced({ path: "new.txt", content: "x" }), /Error creating parent directories for "new.txt": read-only workspace/);

    setToolWorkspaceHost(createHost(files, {
      writeFile: async () => { throw new Error("disk full"); },
    }));
    assert.match(await createFileHandlerForced({ path: "new.txt", content: "x" }), /Error creating file 'new.txt': disk full/);
  });
});

function createHost(files: Map<string, string>, overrides: Partial<ToolWorkspaceHost> = {}): ToolWorkspaceHost {
  const host: ToolWorkspaceHost = {
    getRootPath: () => process.cwd(),
    readFile: async (filePath) => {
      const content = files.get(filePath);
      if (content === undefined) {
        throw Object.assign(new Error("EntryNotFound"), { code: "EntryNotFound" });
      }
      return Buffer.from(content, "utf-8");
    },
    writeFile: async (filePath, content) => { files.set(filePath, Buffer.from(content).toString("utf-8")); },
    stat: async (filePath) => {
      const content = files.get(filePath);
      if (content === undefined) {
        throw Object.assign(new Error("EntryNotFound"), { code: "EntryNotFound" });
      }
      return { type: "file", size: Buffer.byteLength(content, "utf-8") };
    },
    createParentDirectory: async () => undefined,
    readDirectory: async () => [],
  };
  return { ...host, ...overrides };
}
