import { readFileSync } from "node:fs";
import ts from "typescript";

/** A function cannot be declared inside the literal text of a template string. */
export function findLiteralMappedFunctions(report, readSource = (file) => readFileSync(file, "utf8")) {
  const issues = [];
  for (const [file, coverage] of Object.entries(report)) {
    const source = readSource(file);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const literals = [];
    function visit(node) {
      if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        literals.push({ start: node.getStart(ast), end: node.end });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const fn of Object.values(coverage.fnMap ?? {})) {
      const position = fn.decl?.start ?? fn.loc?.start;
      if (!position || position.line < 1 || position.line > ast.getLineStarts().length) { continue; }
      const offset = ast.getLineStarts()[position.line - 1] + position.column;
      if (literals.some((literal) => literal.start <= offset && offset < literal.end)) {
        issues.push({ file, name: fn.name, line: position.line, column: position.column });
      }
    }
  }
  return issues;
}
