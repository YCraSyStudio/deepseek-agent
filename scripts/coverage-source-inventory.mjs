import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { transformSync } from "esbuild";

/** Type declarations and pure re-export barrels have no JavaScript of their own; every other runtime module stays in scope. */
export function hasExecutableCode(fileName, source) {
  const output = transformSync(source, {
    sourcefile: fileName,
    loader: fileName.endsWith(".tsx") ? "tsx" : "ts",
    target: "es2022",
    jsx: "automatic",
    legalComments: "none",
  }).code.replace(/^["']use strict["'];?\s*/, "").trim();
  if (!output || /^export\s*\{\s*\}\s*;?$/.test(output)) {
    return false;
  }
  // A named re-export list only re-points existing bindings, so bundlers emit no statement that V8 can count.
  const remaining = output
    .replace(/export\s*\{[^}]*\}\s*from\s*["'][^"']*["'];?/g, "")
    .trim();
  return remaining !== "";
}

export function collectCoverageSources(root = process.cwd()) {
  const directory = resolve(root, "src");
  const inventory = [];
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = join(current, entry.name);
      if (entry.isDirectory()) { if (file !== join(directory, "test")) { visit(file); } continue; }
      if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) { continue; }
      const source = readFileSync(file, "utf8");
      inventory.push({ path: relative(root, file).replaceAll("\\", "/"), executable: hasExecutableCode(file, source) });
    }
  }
  visit(directory);
  return inventory.sort((left, right) => left.path.localeCompare(right.path));
}
