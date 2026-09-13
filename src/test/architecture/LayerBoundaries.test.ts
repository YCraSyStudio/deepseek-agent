import * as assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";

const sourceRoot = resolve(process.cwd(), "src");
const allowedDependencies: Record<string, ReadonlySet<string>> = {
  application: new Set(["application", "contracts", "domain", "shared"]),
  contracts: new Set(["contracts", "shared"]),
  domain: new Set(["domain", "shared"]),
  extension: new Set(["application", "contracts", "domain", "extension", "infrastructure", "shared", "vscode"]),
  infrastructure: new Set(["application", "contracts", "domain", "infrastructure", "shared"]),
  shared: new Set(["shared"]),
  ui: new Set(["assets", "contracts", "shared", "ui"]),
  vscode: new Set(["application", "contracts", "domain", "infrastructure", "shared", "vscode"]),
};

suite("architecture boundaries", () => {
  test("does not introduce inverse dependencies between layers", () => {
    const violations: string[] = [];
    for (const file of collectSourceFiles(sourceRoot)) {
      const owner = getLayer(file);
      const allowed = allowedDependencies[owner];
      if (!allowed) {
        continue;
      }
      for (const specifier of getImportSpecifiers(readFileSync(file, "utf8"), file)) {
        const importedFile = resolveInternalImport(file, specifier);
        if (!importedFile) {
          continue;
        }
        const dependency = getLayer(importedFile);
        if (dependency && !allowed.has(dependency)) {
          violations.push(
            `${relative(sourceRoot, file)} -> ${specifier} (${owner} -> ${dependency})`,
          );
        }
      }
    }
    assert.deepStrictEqual(violations, []);
  });

  test("does not introduce circular source dependencies", () => {
    const files = collectSourceFiles(sourceRoot);
    const graph = new Map(files.map((file) => [file, getResolvedImports(file)]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const cycles: string[] = [];

    const visit = (file: string, stack: string[]): void => {
      if (visiting.has(file)) {
        const start = stack.indexOf(file);
        cycles.push([...stack.slice(start), file].map((entry) => relative(sourceRoot, entry)).join(" -> "));
        return;
      }
      if (visited.has(file)) {return;}
      visiting.add(file);
      for (const dependency of graph.get(file) ?? []) {
        if (graph.has(dependency)) {visit(dependency, [...stack, file]);}
      }
      visiting.delete(file);
      visited.add(file);
    };

    for (const file of files) {visit(file, []);}
    assert.deepStrictEqual([...new Set(cycles)].sort(), []);
  });

  test("keeps runtime frameworks out of inward layers", () => {
    const violations: string[] = [];
    for (const file of collectSourceFiles(sourceRoot)) {
      const owner = getLayer(file);
      for (const specifier of getImportSpecifiers(readFileSync(file, "utf8"), file)) {
        if ((owner === "domain" || owner === "application") && (specifier.startsWith("node:") || specifier === "path")) {
          violations.push(`${relative(sourceRoot, file)} imports ${specifier}`);
        }
        if (specifier === "vscode" && owner !== "vscode" && owner !== "extension") {
          violations.push(`${relative(sourceRoot, file)} imports vscode`);
        }
        if ((specifier === "react" || specifier.startsWith("react/")) && owner !== "ui") {
          violations.push(`${relative(sourceRoot, file)} imports ${specifier}`);
        }
      }
    }
    assert.deepStrictEqual(violations, []);
  });
});

function getResolvedImports(file: string): string[] {
  return getImportSpecifiers(readFileSync(file, "utf8"), file)
    .map((specifier) => resolveInternalImport(file, specifier))
    .filter((candidate): candidate is string => candidate !== undefined)
    .map(resolveSourceFile)
    .filter((candidate): candidate is string => candidate !== undefined);
}

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" ? [] : collectSourceFiles(path);
    }
    return entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))
      ? [path]
      : [];
  });
}

function getImportSpecifiers(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(fileName) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

function resolveInternalImport(ownerFile: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) {
    return resolve(sourceRoot, specifier.slice(2));
  }
  if (specifier.startsWith("@webview/")) {
    return resolve(sourceRoot, "ui", specifier.slice("@webview/".length));
  }
  if (specifier.startsWith(".")) {
    return resolve(dirname(ownerFile), specifier);
  }
  return undefined;
}

function resolveSourceFile(basePath: string): string | undefined {
  for (const candidate of [basePath, `${basePath}.ts`, `${basePath}.tsx`, resolve(basePath, "index.ts"), resolve(basePath, "index.tsx")]) {
    try {
      if (readFileSync(candidate)) {return candidate;}
    } catch {
    }
  }
  return undefined;
}

function getLayer(file: string): string {
  return relative(sourceRoot, file).split(/[\\/]/)[0];
}
