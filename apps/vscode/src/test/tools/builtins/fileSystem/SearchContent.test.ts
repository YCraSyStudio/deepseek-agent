import * as assert from "assert";
import * as path from "path";
import { searchContentHandler } from "@/infrastructure/tools/builtins/fileSystem/SearchContent";
import {
  setToolWorkspaceHost,
  type ToolWorkspaceEntryType,
  type ToolWorkspaceFindOptions,
  type ToolWorkspaceHost,
  type ToolWorkspaceStat,
} from "@/infrastructure/tools/ToolWorkspace";

interface SearchPayload {
  query: string;
  filePattern: string;
  results: Array<{ file: string; line: number; text: string }>;
  truncated: boolean;
  scannedFiles: number;
  skippedFiles: number;
  timedOut?: boolean;
}

suite("search content", () => {
  test("searches literal text without interpreting shell or regex metacharacters", async () => {
    const workspace = createMemoryWorkspace({
      "src/with space/á.ts": "const marker = \"[literal] & echo\";\n",
      "src/other.ts": "const marker = \"different\";\n",
    });

    const result = await searchContentHandler({ query: "[literal] & echo", filePattern: "*.ts" });
    const payload = parsePayload(result);

    assert.strictEqual(workspace.lastFindOptions?.includePattern, "**/*.ts");
    assert.deepStrictEqual(payload.results, [{
      file: "src/with space/á.ts",
      line: 1,
      text: "const marker = \"[literal] & echo\";",
    }]);
    assert.strictEqual(payload.truncated, false);
  });

  test("applies the shared sensitive-path policy before reading matches", async () => {
    const workspace = createMemoryWorkspace({
      "src/app.ts": "needle",
      "config/credentials.json": "needle",
      "keys/id_rsa": "needle",
      "certs/client.pem": "needle",
    });

    const payload = parsePayload(await searchContentHandler({ query: "needle" }));

    assert.deepStrictEqual(payload.results.map((result) => result.file), ["src/app.ts"]);
    assert.deepStrictEqual(workspace.readPaths, ["src/app.ts"]);
  });

  test("enforces a global result limit", async () => {
    createMemoryWorkspace({
      "src/many.txt": Array.from({ length: 60 }, (_, index) => `needle ${index + 1}`).join("\n"),
    });

    const payload = parsePayload(await searchContentHandler({ query: "needle" }));

    assert.strictEqual(payload.results.length, 50);
    assert.strictEqual(payload.results[0]?.line, 1);
    assert.strictEqual(payload.results.at(-1)?.line, 50);
    assert.strictEqual(payload.truncated, true);
  });

  test("skips binary and oversized files without reading oversized content", async () => {
    const workspace = createMemoryWorkspace(
      {
        "src/safe.txt": "needle",
        "assets/binary.bin": Buffer.from([0, 1, 2, 3]),
        "generated/large.txt": "must not be read",
        "generated/grown.txt": Buffer.alloc(2 * 1024 * 1024 + 1, 65),
      },
      {
        "generated/large.txt": 3 * 1024 * 1024,
        "generated/grown.txt": 1,
      },
    );

    const payload = parsePayload(await searchContentHandler({ query: "needle" }));

    assert.deepStrictEqual(payload.results.map((result) => result.file), ["src/safe.txt"]);
    assert.strictEqual(payload.skippedFiles, 3);
    assert.strictEqual(payload.truncated, true);
    assert.ok(!workspace.readPaths.includes("generated/large.txt"));
    assert.ok(workspace.readPaths.includes("generated/grown.txt"));
  });

  test("propagates cancellation as AbortError", async () => {
    createMemoryWorkspace({ "src/app.ts": "needle" });
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => searchContentHandler({ query: "needle" }, { signal: controller.signal }),
      (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
  });

  test("rejects patterns that can escape the workspace", async () => {
    createMemoryWorkspace({ "src/app.ts": "needle" });

    await assert.rejects(
      () => searchContentHandler({ query: "needle", filePattern: "../*.ts" }),
      /filePattern must stay inside the workspace/,
    );
  });

  test("returns an actionable error when file search is unavailable", async () => {
    setToolWorkspaceHost(createBaseHost(path.resolve("C:/workspace")));

    await assert.rejects(
      () => searchContentHandler({ query: "needle" }),
      /Workspace content search is unavailable/,
    );
  });

  test("scans concurrently while retaining deterministic file order", async () => {
    const paths = Array.from({ length: 40 }, (_, index) => `src/file-${String(index).padStart(2, "0")}.txt`);
    let activeReads = 0;
    let maximumActiveReads = 0;
    setToolWorkspaceHost({
      ...createBaseHost(path.resolve("C:/workspace")),
      findFiles: async () => paths,
      stat: async () => ({ type: "file", size: 20 }),
      readFile: async (filePath) => {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        const index = paths.indexOf(filePath);
        await new Promise((resolve) => setTimeout(resolve, (40 - index) % 5));
        activeReads -= 1;
        return Buffer.from(`needle ${filePath}`);
      },
    });

    const payload = parsePayload(await searchContentHandler({ query: "needle" }));

    assert.ok(maximumActiveReads > 1);
    assert.ok(maximumActiveReads <= 16);
    assert.deepStrictEqual(payload.results.map((result) => result.file), paths);
  });

  test("returns a structured partial result when the internal timeout fires", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) =>
      originalSetTimeout(callback, 0, ...args)) as typeof setTimeout;
    try {
      setToolWorkspaceHost({
        ...createBaseHost(path.resolve("C:/workspace")),
        findFiles: async (options) => new Promise<string[]>((_resolve, reject) => {
          if (options.signal?.aborted) {reject(createAbortError()); return;}
          options.signal?.addEventListener("abort", () => reject(createAbortError()), { once: true });
        }),
      });

      const payload = parsePayload(await searchContentHandler({ query: "needle" }));

      assert.strictEqual(payload.timedOut, true);
      assert.strictEqual(payload.truncated, true);
      assert.deepStrictEqual(payload.results, []);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});

function createMemoryWorkspace(
  contents: Record<string, string | Buffer>,
  reportedSizes: Record<string, number> = {},
): { readPaths: string[]; lastFindOptions?: ToolWorkspaceFindOptions } {
  const rootPath = path.resolve("C:/workspace");
  const files = new Map(
    Object.entries(contents).map(([filePath, content]) => [normalizePath(filePath), Buffer.isBuffer(content) ? content : Buffer.from(content)]),
  );
  const state: { readPaths: string[]; lastFindOptions?: ToolWorkspaceFindOptions } = { readPaths: [] };

  setToolWorkspaceHost({
    ...createBaseHost(rootPath),
    findFiles: async (options) => {
      state.lastFindOptions = options;
      if (options.signal?.aborted) {
        throw createAbortError();
      }
      return [...files.keys()].slice(0, options.maxResults);
    },
    readFile: async (filePath) => {
      const normalized = normalizePath(filePath);
      state.readPaths.push(normalized);
      const content = files.get(normalized);
      if (!content) {
        throw new Error(`Missing test file: ${normalized}`);
      }
      return content;
    },
    stat: async (filePath): Promise<ToolWorkspaceStat> => {
      const normalized = normalizePath(filePath);
      const content = files.get(normalized);
      if (!content) {
        throw new Error(`Missing test file: ${normalized}`);
      }
      return {
        type: "file",
        size: reportedSizes[normalized] ?? content.byteLength,
      };
    },
  });

  return state;
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

function parsePayload(result: string): SearchPayload {
  const payload = JSON.parse(result) as SearchPayload & { type?: string };
  assert.strictEqual(payload.type, "SearchResults");
  return payload;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function createAbortError(): Error {
  const error = new Error("cancelled");
  error.name = "AbortError";
  return error;
}
