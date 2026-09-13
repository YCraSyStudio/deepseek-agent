import * as assert from "assert";
import * as path from "path";
import type { ToolHostDocumentSymbol } from "@/application/ports";
import { readFunctionDefinition, readFunctionHandler } from "@/infrastructure/tools/builtins/fileSystem/ReadFunction";
import {
  setToolWorkspaceHost,
  type ToolWorkspaceEntryType,
  type ToolWorkspaceHost,
} from "@/infrastructure/tools/ToolWorkspace";

const TYPESCRIPT_SOURCE = [
  'const HEADER = "not a symbol";',
  "export function first(value: string): number {",
  "  return value.length;",
  "}",
  "",
  "class Widget {",
  '  private label = "w";',
  "",
  "  render(count: number) {",
  "    return `${this.label}: ${count}`;",
  "  }",
  "",
  "  static create() {",
  "    return new Widget();",
  "  }",
  "}",
  "",
  "const outer = () => {",
  "  const inner = () => 1;",
  "  return inner();",
  "};",
  "",
].join("\n");

const TYPESCRIPT_SYMBOLS: ToolHostDocumentSymbol[] = [
  symbol("HEADER", "variable", 0, 0),
  symbol("first", "function", 1, 3),
  symbol("Widget", "class", 5, 15, [
    symbol("label", "property", 6, 6),
    symbol("render", "method", 8, 10),
    symbol("create", "method", 12, 14),
  ]),
  symbol("outer", "variable", 17, 20, [symbol("inner", "function", 18, 18)]),
];

const PYTHON_SOURCE = [
  "class Repo:",
  "    def save(self, item):",
  "        if item:",
  "            return item",
  "        return None",
  "",
  "def free_function(value):",
  "    return value",
  "",
].join("\n");

const PYTHON_SYMBOLS: ToolHostDocumentSymbol[] = [
  symbol("Repo", "class", 0, 4, [symbol("save", "method", 1, 4)]),
  symbol("free_function", "function", 6, 7),
];

interface FunctionsPayload {
  path: string;
  sha256: string;
  mode: string;
  matched: Array<{
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
    signature: string;
    code?: string;
    members?: Array<{ name: string; kind: string; startLine: number; endLine: number }>;
    note?: string;
  }>;
  ambiguous?: Array<{ name: string; candidates: string[] }>;
  missing?: string[];
  availableNames?: string[];
  truncated?: boolean;
}

suite("read function", () => {
  test("returns only the requested function with its line range and file hash", async () => {
    createMemoryWorkspace({ "src/widget.ts": TYPESCRIPT_SOURCE }, TYPESCRIPT_SYMBOLS);

    const payload = parsePayload(await readFunctionHandler({ path: "src/widget.ts", names: ["first"] }));

    assert.strictEqual(payload.matched.length, 1);
    assert.strictEqual(payload.matched[0]?.name, "first");
    assert.strictEqual(payload.matched[0]?.kind, "function");
    assert.strictEqual(payload.matched[0]?.startLine, 2);
    assert.strictEqual(payload.matched[0]?.endLine, 4);
    assert.strictEqual(payload.matched[0]?.signature, "export function first(value: string): number {");
    assert.strictEqual(payload.matched[0]?.code, ['export function first(value: string): number {', "  return value.length;", "}"].join("\n"));
    assert.match(payload.sha256, /^[a-f0-9]{64}$/);
    assert.strictEqual(payload.mode, "body");
  });

  test("resolves chained names through containers and nested functions", async () => {
    createMemoryWorkspace({ "src/widget.ts": TYPESCRIPT_SOURCE }, TYPESCRIPT_SYMBOLS);

    const payload = parsePayload(await readFunctionHandler({
      path: "src/widget.ts",
      names: ["Widget.render", "outer.inner"],
    }));

    assert.deepStrictEqual(payload.matched.map((entry) => entry.name), ["Widget.render", "outer.inner"]);
    assert.strictEqual(payload.matched[0]?.kind, "method");
    assert.match(payload.matched[0]?.code ?? "", /this\.label/);
    assert.strictEqual(payload.matched[1]?.code, "  const inner = () => 1;");
  });

  test("keeps the editor range instead of scanning braces", async () => {
    const source = [
      'const label = "} not the end";',
      "function guarded(value: string) {",
      "  // } still inside",
      "  const text = '{ unbalanced';",
      "  return `${value}${text}`;",
      "}",
      "function after() {",
      "  return 2;",
      "}",
      "",
    ].join("\n");
    createMemoryWorkspace({ "src/braces.ts": source }, [
      symbol("guarded", "function", 1, 5),
      symbol("after", "function", 6, 8),
    ]);

    const payload = parsePayload(await readFunctionHandler({ path: "src/braces.ts", names: ["guarded"] }));

    assert.strictEqual(payload.matched[0]?.endLine, 6);
    assert.doesNotMatch(payload.matched[0]?.code ?? "", /function after/);
  });

  test("signs declarations whose name line follows the declaration start", async () => {
    const source = ["  @memoize", "  render(): void {", "    return;", "  }", ""].join("\n");
    createMemoryWorkspace({ "src/decorated.ts": source }, [symbol("render", "method", 0, 3, [], 1)]);

    const payload = parsePayload(await readFunctionHandler({ path: "src/decorated.ts", names: ["render"] }));

    assert.strictEqual(payload.matched[0]?.signature, "@memoize render(): void {");
  });

  test("clamps a stale range to the file length", async () => {
    createMemoryWorkspace({ "src/short.ts": "function alpha() {\n  return 1;\n}\n" }, [symbol("alpha", "function", 0, 99)]);

    const payload = parsePayload(await readFunctionHandler({ path: "src/short.ts", names: ["alpha"] }));

    assert.strictEqual(payload.matched[0]?.endLine, 100);
    assert.strictEqual(payload.matched[0]?.code, "function alpha() {\n  return 1;\n}");
  });

  test("resolves module-level const bindings, which hold most arrow-function exports", async () => {
    createMemoryWorkspace({ "src/widget.ts": TYPESCRIPT_SOURCE }, TYPESCRIPT_SYMBOLS);

    const payload = parsePayload(await readFunctionHandler({ path: "src/widget.ts", names: ["HEADER", "outer"] }));

    assert.deepStrictEqual(payload.matched.map((entry) => entry.name), ["HEADER", "outer"]);
    assert.strictEqual(payload.matched[0]?.kind, "variable");
    assert.strictEqual(payload.matched[0]?.code, 'const HEADER = "not a symbol";');
  });

  test("asks the language service again before reporting a file without symbols", async () => {
    let calls = 0;
    createMemoryWorkspace({ "src/widget.ts": TYPESCRIPT_SOURCE }, () => {
      calls++;
      return calls === 1 ? [] : TYPESCRIPT_SYMBOLS;
    });

    const payload = parsePayload(await readFunctionHandler({ path: "src/widget.ts", names: ["first"] }));

    assert.strictEqual(calls, 2);
    assert.strictEqual(payload.matched[0]?.name, "first");
  });

  test("reports ambiguous names with their qualified candidates instead of guessing", async () => {
    const source = ["class Alpha {", "  run() {", "    return 1;", "  }", "}", "class Beta {", "  run() {", "    return 2;", "  }", "}", ""].join("\n");
    createMemoryWorkspace({ "src/two.ts": source }, [
      symbol("Alpha", "class", 0, 3, [symbol("run", "method", 1, 2)]),
      symbol("Beta", "class", 5, 8, [symbol("run", "method", 6, 7)]),
    ]);

    const payload = parsePayload(await readFunctionHandler({ path: "src/two.ts", names: ["run"] }));

    assert.deepStrictEqual(payload.matched, []);
    assert.deepStrictEqual(payload.ambiguous, [{ name: "run", candidates: ["Alpha.run", "Beta.run"] }]);
  });

  test("lists the available symbols when a name does not exist", async () => {
    createMemoryWorkspace({ "src/widget.ts": TYPESCRIPT_SOURCE }, TYPESCRIPT_SYMBOLS);

    const payload = parsePayload(await readFunctionHandler({ path: "src/widget.ts", names: ["missingSymbol"] }));

    assert.deepStrictEqual(payload.missing, ["missingSymbol"]);
    assert.ok(payload.availableNames?.includes("Widget.render"));
    assert.ok(payload.availableNames?.includes("HEADER"));
    assert.ok(!payload.availableNames?.includes("Widget.label"));
  });

  test("outlines a class without returning any body", async () => {
    createMemoryWorkspace({ "src/widget.ts": TYPESCRIPT_SOURCE }, TYPESCRIPT_SYMBOLS);

    const payload = parsePayload(await readFunctionHandler({
      path: "src/widget.ts",
      names: ["Widget"],
      mode: "outline",
    }));

    assert.strictEqual(payload.mode, "outline");
    assert.strictEqual(payload.matched[0]?.code, undefined);
    assert.deepStrictEqual(payload.matched[0]?.members?.map((member) => member.name), ["render", "create"]);
  });

  test("outlines every top-level declaration for the whole file", async () => {
    createMemoryWorkspace({ "src/widget.ts": TYPESCRIPT_SOURCE }, TYPESCRIPT_SYMBOLS);

    const payload = parsePayload(await readFunctionHandler({
      path: "src/widget.ts",
      names: ["*"],
      mode: "outline",
    }));

    assert.deepStrictEqual(payload.matched.map((entry) => entry.name), ["HEADER", "first", "Widget", "outer"]);
  });

  test("reads Python methods through their class container", async () => {
    createMemoryWorkspace({ "src/repo.py": PYTHON_SOURCE }, PYTHON_SYMBOLS);

    const payload = parsePayload(await readFunctionHandler({ path: "src/repo.py", names: ["Repo.save", "free_function"] }));

    assert.deepStrictEqual(payload.matched.map((entry) => entry.name), ["Repo.save", "free_function"]);
    assert.strictEqual(payload.matched[0]?.startLine, 2);
    assert.strictEqual(payload.matched[0]?.endLine, 5);
    assert.strictEqual(payload.matched[1]?.endLine, 8);
  });

  test("refuses when the host has no editor symbol provider", async () => {
    createMemoryWorkspace({ "src/widget.ts": TYPESCRIPT_SOURCE });

    assert.match(await readFunctionHandler({ path: "src/widget.ts", names: ["first"] }), /read_file offset and limit/);
  });

  test("refuses when the editor reports no symbols", async () => {
    let calls = 0;
    createMemoryWorkspace({ "notes/readme.txt": "plain text" }, () => {
      calls++;
      return [];
    });

    assert.match(await readFunctionHandler({ path: "notes/readme.txt", names: ["anything"] }), /reported no symbols/);
    assert.strictEqual(calls, 3);
  });

  test("rejects empty requests and reports unreadable files", async () => {
    createMemoryWorkspace({ "src/widget.ts": TYPESCRIPT_SOURCE }, TYPESCRIPT_SYMBOLS);

    assert.match(
      await readFunctionHandler({ path: "src/widget.ts", names: [] }),
      /names parameter must be a non-empty array/,
    );
    assert.match(
      await readFunctionHandler({ path: "src/absent.ts", names: ["first"] }),
      /^Error reading functions from 'src\/absent\.ts'/,
    );
  });

  test("declares itself the preferred read for a named declaration", () => {
    const description = readFunctionDefinition.function.description ?? "";

    assert.match(description, /the preferred read whenever a declaration is the target/);
  });
});

function createMemoryWorkspace(
  contents: Record<string, string | Buffer>,
  symbols?: ToolHostDocumentSymbol[] | (() => ToolHostDocumentSymbol[]),
): void {
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
    ...(symbols ? { readDocumentSymbols: async () => (typeof symbols === "function" ? symbols() : symbols) } : {}),
  });
}

function symbol(
  name: string,
  kind: string,
  startLine: number,
  endLine: number,
  children: ToolHostDocumentSymbol[] = [],
  nameLine = startLine,
): ToolHostDocumentSymbol {
  return { name, kind, startLine, endLine, nameLine, children };
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

function parsePayload(result: string): FunctionsPayload {
  const payload = JSON.parse(result) as FunctionsPayload & { type?: string };
  assert.strictEqual(payload.type, "functions");
  return payload;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
