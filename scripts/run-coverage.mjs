import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectCoverageSources } from "./coverage-source-inventory.mjs";
import { findLiteralMappedFunctions } from "./coverage-map-validation.mjs";

const rawDirectory = resolve(".tmp/coverage");
rmSync(rawDirectory, { recursive: true, force: true });
mkdirSync(rawDirectory, { recursive: true });
let tests = await run(["scripts/run-unit-tests.mjs"], {
  ...process.env,
  NODE_V8_COVERAGE: rawDirectory,
});

if (process.argv.includes("--integration")) {
  const env = {
    ...process.env,
    DEEPSEEK_AGENT_TEST_COVERAGE: "1",
    DEEPSEEK_AGENT_COVERAGE_DIRECTORY: rawDirectory,
  };
  const builds = [
    ["esbuild.js", "--production"],
    [fileURLToPath(new URL("../../bin/vite.js", import.meta.resolve("vite"))), "build", "--config", "src/ui/vite.config.mts"],
    ["scripts/build-integration-tests.mjs"],
  ];
  let buildFailure = 0;
  for (const args of builds) {
    buildFailure = await run(args, env);
    if (buildFailure) { break; }
  }
  if (buildFailure) {
    tests ||= buildFailure;
  } else {
    const integrationArgs = process.argv.slice(2).filter((argument) => !["--integration", "--check"].includes(argument));
    const cli = fileURLToPath(new URL("./bin.mjs", import.meta.resolve("@vscode/test-cli")));
    const integration = await run([cli, ...integrationArgs], env);
    tests ||= integration;
  }
}

// c8 applies its post-remap filter to source names before resolving them.
// Normalize both Node's cached file: URLs and esbuild's external relative maps
// to absolute source paths. Otherwise executed modules can lose all functions
// and branches while their empty fallback reports misleadingly show 100% lines.
const normalizedMaps = new Set();
for (const name of readdirSync(rawDirectory).filter((name) => name.endsWith(".json"))) {
  const file = resolve(rawDirectory, name);
  const report = JSON.parse(readFileSync(file, "utf8"));
  for (const [script, cached] of Object.entries(report["source-map-cache"] ?? {})) {
    if (cached.data?.sources) { normalizeSourceMap(cached.data, fileURLToPath(script)); }
  }
  for (const script of report.result ?? []) {
    if (!script.url.startsWith("file:")) { continue; }
    const scriptPath = fileURLToPath(script.url);
    if (![resolve(".tmp/unit-tests"), resolve(".tmp/integration-tests"), resolve("dist")]
      .some((directory) => scriptPath.startsWith(directory + "/") || scriptPath.startsWith(directory + "\\"))) { continue; }
    const mapPath = `${scriptPath}.map`;
    if (normalizedMaps.has(mapPath) || !existsSync(mapPath)) { continue; }
    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    normalizeSourceMap(map, scriptPath);
    writeFileSync(mapPath, JSON.stringify(map));
    normalizedMaps.add(mapPath);
  }
  writeFileSync(file, JSON.stringify(report));
}

function normalizeSourceMap(map, scriptPath) {
  map.sources = map.sources.map((source) => source.startsWith("file:")
    ? fileURLToPath(source)
    : resolve(dirname(scriptPath), map.sourceRoot || "", source));
  map.sourceRoot = "";
}

const inventory = collectCoverageSources();
const configuration = JSON.parse(readFileSync(resolve(".c8rc.json"), "utf8"));
configuration.exclude = [...configuration.exclude, ...inventory.filter((source) => !source.executable).map((source) => source.path)];
const reportConfiguration = resolve(rawDirectory, "report-config.json");
writeFileSync(reportConfiguration, JSON.stringify(configuration));

const check = process.argv.includes("--check");
const c8 = fileURLToPath(import.meta.resolve("c8/bin/c8.js"));
const coverage = await run([c8, "report", "--config", reportConfiguration, ...(check ? [
  "--check-coverage", "--per-file", "--lines", "100", "--functions", "100", "--branches", "100", "--statements", "100",
] : [])], process.env);
mkdirSync(resolve("coverage"), { recursive: true });
writeFileSync(resolve("coverage/source-inventory.json"), JSON.stringify(inventory, null, 2));
let captureFailure = 0;
const mappedReport = JSON.parse(readFileSync(resolve("coverage/coverage-final.json"), "utf8"));
const mappingIssues = findLiteralMappedFunctions(mappedReport);
writeFileSync(resolve("coverage/mapping-validation.json"), JSON.stringify(mappingIssues, null, 2));
if (mappingIssues.length) {
  console.error("Invalid source-map attribution: functions mapped into template literal text", mappingIssues);
  captureFailure = 1;
}
if (process.argv.includes("--integration") && !tests && !coverage) {
  const summary = JSON.parse(readFileSync(resolve("coverage/coverage-summary.json"), "utf8"));
  for (const file of ["src/vscode/tools/VsCodeToolWorkspace.ts", "src/vscode/webviews/handlers/chat/generation/GenerationExecutor.ts"]) {
    const measured = summary[resolve(file)];
    if (!measured || measured.functions.total === 0 || measured.functions.covered === 0) {
      console.error(`Missing real extension-host function coverage for ${file}`);
      captureFailure = 1;
    }
  }
}
process.exitCode = tests || coverage || captureFailure;

function run(args, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveRun(signal ? 1 : code ?? 1));
  });
}
