import assert from "node:assert/strict";
import { searchContentHandler } from "@/infrastructure/tools/builtins/fileSystem/SearchContent";
import { setToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";
import type { ToolHandlerContext } from "@/application/tools/Types";

interface SearchEntry { type: "file" | "directory"; size?: number; content?: string; error?: Error }

function install(entries: Record<string, SearchEntry>, paths: string[] = Object.keys(entries), options: { findError?: Error; noFind?: boolean } = {}) {
  const host: Record<string, unknown> = {
    getRootPath: () => "/workspace",
    getWorkspaceId: () => "workspace",
    stat: async (filePath: string) => {
      const entry = entries[filePath];
      if (!entry) { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }
      return { type: entry.type, size: entry.size ?? entry.content?.length ?? 0 };
    },
    readFile: async (filePath: string) => {
      const entry = entries[filePath];
      if (entry?.error) { throw entry.error; }
      return new TextEncoder().encode(entry?.content ?? "");
    },
  };
  if (!options.noFind) {
    host.findFiles = async () => { if (options.findError) { throw options.findError; } return paths; };
  }
  setToolWorkspaceHost(host as unknown as ToolWorkspaceHost);
  return host as unknown as ToolWorkspaceHost;
}

function parse(output: string) {
  return JSON.parse(output) as { query: string; filePattern: string; results: Array<{ file: string; line: number; text: string }>; truncated: boolean; scannedFiles: number; skippedFiles: number; timedOut?: boolean };
}

suite("content search built-in", () => {
  for (const stage of ["find", "read"] as const) {
    test(`forwards parent cancellation during ${stage} and does not return late matches`, async () => {
      const host = install({ "a.ts": { type: "file", content: "needle" } });
      const controller = new AbortController(); let release!: () => void; let entered!: () => void; let internal: AbortSignal | undefined;
      const gate = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { entered = resolve; });
      if (stage === "find") { host.findFiles = async options => { internal = options.signal; entered(); await gate; return ["a.ts"]; }; }
      else { const read = host.readFile; host.readFile = async file => { entered(); await gate; return read(file); }; }
      setToolWorkspaceHost(host);
      const operation = searchContentHandler({ query: "needle" }, { signal: controller.signal });
      const rejected = assert.rejects(operation, { name: "AbortError" });
      await ready; controller.abort(); if (internal) { assert.equal(internal.aborted, true); }
      release(); await rejected;
    });
  }
  test("normalizes blank patterns and preserves provider AbortErrors", async () => {
    install({ "a.ts": { type: "file", content: "needle" } });
    assert.equal(parse(await searchContentHandler({ query: "needle", filePattern: "  " })).filePattern, "**/*");
    const failure = Object.assign(new Error("provider cancelled"), { name: "AbortError" });
    install({}, [], { findError: failure });
    await assert.rejects(searchContentHandler({ query: "needle" }), error => error === failure);
  });
  test("applies the fifty-result limit across separate files", async () => {
    const content = Array(30).fill("needle").join("\n");
    install({ "a.ts": { type: "file", content }, "b.ts": { type: "file", content } });
    const output = parse(await searchContentHandler({ query: "needle" }));
    assert.equal(output.results.length, 50); assert.equal(output.results.filter(result => result.file === "a.ts").length, 30);
    assert.equal(output.truncated, true);
  });
  test("applies the retained UTF-8 byte limit across separate files", async () => {
    const content = Array(20).fill(`needle ${"x".repeat(1990)}`).join("\n");
    install({ "a.ts": { type: "file", content }, "b.ts": { type: "file", content } });
    const output = parse(await searchContentHandler({ query: "needle" }));
    assert.ok(output.results.length > 20 && output.results.length < 40); assert.equal(output.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(output.results)) < 66 * 1024);
  });
  for (const stage of ["find", "read"] as const) {
    test(`reports a bounded timed-out result during ${stage} rather than hanging or disguising it as success`, async () => {
      const originalSetTimeout = globalThis.setTimeout;
      const host = install({ "a.ts": { type: "file", content: "needle" } });
      const wait = () => new Promise<void>(resolve => originalSetTimeout(resolve, 10));
      if (stage === "find") { host.findFiles = async () => { await wait(); return ["a.ts"]; }; }
      else { const read = host.readFile; host.readFile = async file => { await wait(); return read(file); }; }
      setToolWorkspaceHost(host);
      globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) =>
        originalSetTimeout(args[0], args[1] === 15000 ? 1 : args[1], ...args.slice(2))) as typeof setTimeout;
      try {
        const output = parse(await searchContentHandler({ query: "needle" }));
        assert.equal(output.timedOut, true); assert.equal(output.truncated, true);
      } finally { globalThis.setTimeout = originalSetTimeout; }
    });
  }

  test("validates query and file pattern bounds before touching the workspace", async () => {
    await assert.rejects(searchContentHandler({}, undefined), /query parameter is required/);
    await assert.rejects(searchContentHandler({ query: "   " }, undefined), /query parameter is required/);
    await assert.rejects(searchContentHandler({ query: "x".repeat(4097) }, undefined), /must not exceed 4096/);
    await assert.rejects(searchContentHandler({ query: "x", filePattern: 5 }, undefined), /filePattern must be a string/);
    await assert.rejects(searchContentHandler({ query: "x", filePattern: "x".repeat(1025) }, undefined), /must not exceed 1024/);
    await assert.rejects(searchContentHandler({ query: "x", filePattern: "a\0b" }, undefined), /null byte/);
    await assert.rejects(searchContentHandler({ query: "x", filePattern: "/root" }, undefined), /must stay inside the workspace/);
    await assert.rejects(searchContentHandler({ query: "x", filePattern: "C:/root" }, undefined), /must stay inside the workspace/);
    await assert.rejects(searchContentHandler({ query: "x", filePattern: "../root" }, undefined), /must stay inside the workspace/);
  });

  test("rejects unavailable workspaces and search hosts", async () => {
    setToolWorkspaceHost({ getRootPath: () => undefined, getWorkspaceId: () => undefined, findFiles: async () => [] } as unknown as ToolWorkspaceHost);
    await assert.rejects(searchContentHandler({ query: "x" }, undefined), /No workspace folder open/);
    install({}, [], { noFind: true });
    await assert.rejects(searchContentHandler({ query: "x" }, undefined), /Workspace content search is unavailable/);
  });

  test("finds case-insensitive literal matches and skips directories, large and binary files", async () => {
    install({
      "src/a.ts": { type: "file", content: "const first = 1;\nconst second = 2;\nFIRST again" },
      "src/large-stat.ts": { type: "file", size: 3 * 1024 * 1024 },
      "src/large-content.ts": { type: "file", content: "x".repeat(3 * 1024 * 1024) },
      "src/binary.bin": { type: "file", content: "\0\0first" },
      "src/folder": { type: "directory" },
      "src/broken.ts": { type: "file", error: new Error("read failed") },
    });
    const output = parse(await searchContentHandler({ query: "first" }, undefined));
    assert.equal(output.query, "first");
    assert.equal(output.filePattern, "**/*");
    assert.deepEqual(output.results.map((result) => [result.file, result.line, result.text]), [
      ["src/a.ts", 1, "const first = 1;"],
      ["src/a.ts", 3, "FIRST again"],
    ]);
    assert.equal(output.scannedFiles, 2);
    assert.equal(output.skippedFiles, 4);
    assert.equal(output.truncated, true);
  });

  test("applies the file pattern and bounds long lines", async () => {
    install({ "src/a.ts": { type: "file", content: `${"x".repeat(2500)}needle` } });
    const output = parse(await searchContentHandler({ query: "needle", filePattern: "*.ts" }, undefined));
    assert.equal(output.filePattern, "**/*.ts");
    assert.equal(output.results[0].text.length, 2000);
    assert.equal(output.results[0].text.endsWith("…"), true);
    assert.equal(output.truncated, true);
    assert.equal(parse(await searchContentHandler({ query: "needle", filePattern: "src/**/*.ts" }, undefined)).filePattern, "src/**/*.ts");
  });

  test("truncates when more than fifty matches or the output byte budget is reached", async () => {
    install({ "src/a.ts": { type: "file", content: Array.from({ length: 60 }, () => "needle").join("\n") } });
    const many = parse(await searchContentHandler({ query: "needle" }, undefined));
    assert.equal(many.results.length, 50);
    assert.equal(many.truncated, true);
    install({ "src/a.ts": { type: "file", content: Array.from({ length: 40 }, () => `${"y".repeat(2000)}needle`).join("\n") } });
    const bytes = parse(await searchContentHandler({ query: "needle" }, undefined));
    assert.ok(bytes.results.length < 40);
    assert.equal(bytes.truncated, true);
  });

  test("bounds candidate files and reports truncation", async () => {
    const entries: Record<string, SearchEntry> = {};
    const paths = Array.from({ length: 10_001 }, (_, index) => `file-${index}.ts`);
    for (const filePath of paths) { entries[filePath] = { type: "file", content: "none" }; }
    install(entries, paths);
    const output = parse(await searchContentHandler({ query: "missing" }, undefined));
    assert.equal(output.truncated, true);
    assert.equal(output.scannedFiles, 10_000);
  });

  test("wraps search failures and preserves explicit cancellation", async () => {
    install({}, [], { findError: new Error("search unavailable") });
    await assert.rejects(searchContentHandler({ query: "x" }, undefined), /Content search failed: search unavailable/);
    const controller = new AbortController();
    controller.abort();
    install({}, [], { findError: Object.assign(new Error("cancelled"), { name: "AbortError" }) });
    await assert.rejects(searchContentHandler({ query: "x" }, { signal: controller.signal } as ToolHandlerContext), { name: "AbortError" });
    install({ "src/a.ts": { type: "file", error: Object.assign(new Error("cancelled"), { name: "AbortError" }) } });
    await assert.rejects(searchContentHandler({ query: "x" }, undefined), { name: "AbortError" });
  });
});
