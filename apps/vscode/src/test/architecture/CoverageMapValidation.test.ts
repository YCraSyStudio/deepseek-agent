import assert from "node:assert/strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

type Validator = { findLiteralMappedFunctions: (report: Record<string, unknown>, readSource: (file: string) => string) => Array<{ file: string; name: string; line: number; column: number }> };
suite("coverage source-map attribution", () => {
  let validator: Validator;
  suiteSetup(async () => { validator = await import(pathToFileURL(path.resolve("scripts/coverage-map-validation.mjs")).href) as Validator; });
  const fn = (name: string, line: number, column: number) => ({ name, decl: { start: { line, column } } });
  test("detects a foreign function incorrectly mapped into prompt text", () => {
    const source = 'const prompt = `Instructions\nNever execute this text.\n`;\nexport function run() {}';
    const issues = validator.findLiteralMappedFunctions({ "Prompt.ts": { fnMap: { 0: fn("has", 2, 5), 1: fn("run", 4, 7), 2: fn("atOpeningDelimiter", 1, source.indexOf("`")) } } }, () => source);
    assert.deepEqual(issues, [{ file: "Prompt.ts", name: "has", line: 2, column: 5 }, { file: "Prompt.ts", name: "atOpeningDelimiter", line: 1, column: source.indexOf("`") }]);
  });
  test("allows functions within template interpolation expressions", () => {
    const source = 'const prompt = `Hello ${(() => "value")()} world`;';
    assert.deepEqual(validator.findLiteralMappedFunctions({ "Prompt.ts": { fnMap: { 0: fn("anonymous", 1, source.indexOf('() =>')) } } }, () => source), []);
  });
  test("checks both text segments around interpolation while allowing ordinary declarations", () => {
    const source = 'function value() {}\nconst text = `left text ${value()} right text`;';
    const issues = validator.findLiteralMappedFunctions({ "View.tsx": { fnMap: { 0: fn("value", 1, 0), 1: fn("left", 2, 18), 2: fn("right", 2, 45) } } }, () => source);
    assert.deepEqual(issues.map((issue) => issue.name), ["left", "right"]);
  });
});
