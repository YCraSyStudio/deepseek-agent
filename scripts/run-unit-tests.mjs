import { readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as esbuild from "esbuild";
import Mocha from "mocha";

const outDir = resolve(".tmp/unit-tests");
const testDir = resolve("src/test");
const integrationDir = resolve(testDir, "integration");
const entryPoints = collectTests(testDir)
  .filter((fileName) => !fileName.startsWith(`${integrationDir}\\`) && !fileName.startsWith(`${integrationDir}/`));

rmSync(outDir, { recursive: true, force: true });

await esbuild.build({
  entryPoints,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  outdir: outDir,
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  packages: "external",
});

const mocha = new Mocha({
  color: true,
  ui: "tdd",
});

for (const entryPoint of entryPoints) {
  const outputPath = relative(testDir, entryPoint).replace(/\.ts$/, ".mjs");
  mocha.addFile(resolve(outDir, outputPath));
}

await mocha.loadFilesAsync();

const runner = mocha.run();
const failures = await new Promise((resolveRun) => {
  runner.once("end", () => resolveRun(runner.failures));
});

if (failures) {
  process.exitCode = 1;
}

function collectTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTests(path);
    }
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [resolve(path)] : [];
  });
}
