import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

type Inventory = {
  hasExecutableCode: (file: string, source: string) => boolean;
  collectCoverageSources: (root: string) => Array<{ path: string; executable: boolean }>;
};

suite("coverage source inventory", () => {
  let inventory: Inventory;
  suiteSetup(async () => { inventory = await import(pathToFileURL(path.resolve("scripts/coverage-source-inventory.mjs")).href) as Inventory; });
  const declarations = ["", "// Documentation only", "export interface Port { run(): void }", "export type Status = 'done' | 'error';",
    "import type { Port } from './Port'; export type { Port };", "import { Port } from './Port'; export interface Host { port: Port }"];
  for (const source of declarations) {
    test(`does not count non-executable declarations: ${source || "empty file"}`, () => {
      assert.equal(inventory.hasExecutableCode("declarations.ts", source), false);
    });
  }
  const runtime = ["export const value = 1;", "export function action() { return 'done'; }", "export class Service {}", "export enum Status { Ready }",
    "import './register';", "export * from './Port';", "console.log('initialized');", "export default function View() { return <div>View</div>; }"];
  for (const source of runtime) {
    test(`keeps runtime code in the denominator: ${source}`, () => { assert.equal(inventory.hasExecutableCode("module.tsx", source), true); });
  }
  test("inventories all production TS/TSX files while retaining an explicit record of type-only modules", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coverage-inventory-"));
    try {
      await mkdir(path.join(root, "apps/vscode/src", "test"), { recursive: true });
      await writeFile(path.join(root, "apps/vscode/src", "Types.ts"), "export interface Options { enabled: boolean }");
      await writeFile(path.join(root, "apps/vscode/src", "Runtime.ts"), "export function run() { return true; }");
      await mkdir(path.join(root, "apps/webview"), { recursive: true });
      await writeFile(path.join(root, "apps/webview", "View.tsx"), "export const View = () => <div/>;");
      await writeFile(path.join(root, "apps/vscode/src", "ambient.d.ts"), "declare const flag: boolean;");
      await writeFile(path.join(root, "apps/vscode/src", "test", "Ignored.test.ts"), "throw Error('test');");
      await writeFile(path.join(root, "apps/vscode/src", "style.css"), "div {}");
      assert.deepEqual(inventory.collectCoverageSources(root), [
        { path: "apps/vscode/src/Runtime.ts", executable: true }, { path: "apps/vscode/src/Types.ts", executable: false }, { path: "apps/webview/View.tsx", executable: true },
      ]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
