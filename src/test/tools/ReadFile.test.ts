import * as assert from "assert";
import * as path from "path";
import { readFileHandler } from "@/infrastructure/tools/builtins/fileSystem/ReadFile";
import {
  setToolWorkspaceHost,
  type ToolWorkspaceEntryType,
  type ToolWorkspaceHost,
} from "@/infrastructure/tools/ToolWorkspace";

const SOURCE = ["one", "two", "three", "four", "five"].join("\n");

interface FilePayload {
  path: string;
  binary: boolean;
  size: number;
  sha256?: string;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  hasMore?: boolean;
  truncated?: boolean;
  content: string;
}

suite("read file", () => {
  test("reads the whole file when no range is requested", async () => {
    createMemoryWorkspace({ "src/app.ts": SOURCE });

    const payload = parsePayload(await readFileHandler({ path: "src/app.ts" }));

    assert.strictEqual(payload.content, SOURCE);
    assert.strictEqual(payload.startLine, undefined);
    assert.strictEqual(payload.totalLines, undefined);
    assert.match(payload.sha256 ?? "", /^[a-f0-9]{64}$/);
  });

  test("returns only the requested line range with its bounds and the file hash", async () => {
    createMemoryWorkspace({ "src/app.ts": SOURCE });

    const payload = parsePayload(await readFileHandler({ path: "src/app.ts", offset: 2, limit: 2 }));

    assert.strictEqual(payload.content, "two\nthree");
    assert.strictEqual(payload.startLine, 2);
    assert.strictEqual(payload.endLine, 3);
    assert.strictEqual(payload.totalLines, 5);
    assert.strictEqual(payload.hasMore, true);
    assert.strictEqual(payload.truncated, undefined);
    assert.match(payload.sha256 ?? "", /^[a-f0-9]{64}$/);
  });

  test("counts from the first line when only limit is given", async () => {
    createMemoryWorkspace({ "src/app.ts": SOURCE });

    const payload = parsePayload(await readFileHandler({ path: "src/app.ts", limit: 2 }));

    assert.strictEqual(payload.content, "one\ntwo");
    assert.strictEqual(payload.startLine, 1);
    assert.strictEqual(payload.endLine, 2);
  });

  test("reports the end of the file on the last range", async () => {
    createMemoryWorkspace({ "src/app.ts": SOURCE });

    const payload = parsePayload(await readFileHandler({ path: "src/app.ts", offset: 4, limit: 10 }));

    assert.strictEqual(payload.content, "four\nfive");
    assert.strictEqual(payload.endLine, 5);
    assert.strictEqual(payload.hasMore, false);
    assert.strictEqual(payload.truncated, undefined);
  });

  test("applies the default line budget when offset omits limit", async () => {
    createMemoryWorkspace({ "src/big.ts": createNumberedSource(700) });

    const payload = parsePayload(await readFileHandler({ path: "src/big.ts", offset: 2 }));

    assert.strictEqual(payload.content.split("\n").length, 600);
    assert.strictEqual(payload.startLine, 2);
    assert.strictEqual(payload.endLine, 601);
    assert.strictEqual(payload.hasMore, true);
    assert.strictEqual(payload.truncated, undefined);
  });

  test("stops at the character budget and flags the shortened range", async () => {
    createMemoryWorkspace({ "src/wide.txt": Array.from({ length: 6 }, () => "x".repeat(10_000)).join("\n") });

    const payload = parsePayload(await readFileHandler({ path: "src/wide.txt", offset: 1, limit: 6 }));

    assert.strictEqual(payload.truncated, true);
    assert.strictEqual(payload.content.split("\n").length, 4);
    assert.strictEqual(payload.endLine, 4);
    assert.ok(payload.content.length <= 48 * 1024);
  });

  test("normalizes CRLF and a byte order mark before counting lines", async () => {
    createMemoryWorkspace({ "src/crlf.ts": "\uFEFFone\r\ntwo\r\nthree" });

    const payload = parsePayload(await readFileHandler({ path: "src/crlf.ts", offset: 2, limit: 1 }));

    assert.strictEqual(payload.content, "two");
    assert.strictEqual(payload.totalLines, 3);
  });

  test("rejects a range that leaves the file or an invalid range", async () => {
    createMemoryWorkspace({ "src/app.ts": SOURCE });

    assert.match(
      await readFileHandler({ path: "src/app.ts", offset: 9 }),
      /offset 9 is past the end of 'src\/app\.ts', which has 5 lines/,
    );
    assert.match(await readFileHandler({ path: "src/app.ts", offset: 0 }), /offset must be a positive integer/);
    assert.match(await readFileHandler({ path: "src/app.ts", offset: 1.5 }), /offset must be a positive integer/);
    assert.match(await readFileHandler({ path: "src/app.ts", limit: 0 }), /limit must be a positive integer/);
    assert.match(await readFileHandler({ path: "src/app.ts", limit: 601 }), /limit must not exceed 600 lines/);
  });

  test("refuses to range read a binary file or an oversized one", async () => {
    createMemoryWorkspace({
      "src/blob.bin": Buffer.from([0x61, 0x00, 0x62]),
      "src/huge.txt": Buffer.from("a\n".repeat(4_600_000)),
    });

    const binary = parsePayload(await readFileHandler({ path: "src/blob.bin", offset: 1 }));
    assert.strictEqual(binary.binary, true);
    assert.strictEqual(binary.content, "");

    assert.match(
      await readFileHandler({ path: "src/huge.txt", offset: 1 }),
      /too large to read as a line range/,
    );
  });

  test("reports unreadable files", async () => {
    createMemoryWorkspace({ "src/app.ts": SOURCE });

    assert.match(await readFileHandler({ path: "src/absent.ts", offset: 1 }), /^Error reading file 'src\/absent\.ts'/);
  });
});

function createNumberedSource(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
}

function createMemoryWorkspace(contents: Record<string, string | Buffer>): void {
  const rootPath = path.resolve("C:/workspace");
  const files = new Map(
    Object.entries(contents).map(([filePath, content]) => [normalizePath(filePath), Buffer.isBuffer(content) ? content : Buffer.from(content)]),
  );

  setToolWorkspaceHost({
    ...createBaseHost(rootPath),
    readFile: async (filePath) => {
      const content = files.get(normalizePath(filePath));
      if (!content) {
        throw new Error(`Missing test file: ${normalizePath(filePath)}`);
      }
      return content;
    },
  });
}

function createBaseHost(rootPath: string): ToolWorkspaceHost {
  return {
    getRootPath: () => rootPath,
    readFile: async () => Buffer.from(""),
    writeFile: async () => undefined,
    stat: async () => ({ type: "unknown", size: 0 }),
    createParentDirectory: async () => undefined,
    readDirectory: async (): Promise<Array<[string, ToolWorkspaceEntryType]>> => [],
  };
}

function parsePayload(result: string): FilePayload {
  const payload = JSON.parse(result) as FilePayload & { type?: string };
  assert.strictEqual(payload.type, "file");
  return payload;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
