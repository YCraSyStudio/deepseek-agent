import { spawn } from "node:child_process";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import Mocha from "mocha";
import { createMemoryGuard, formatSnapshot, memorySnapshot } from "./test-memory-guard.mjs";

// A failing assertion that inspects an unbounded object graph is a synchronous
// allocation, so a timer-based watchdog cannot interrupt it. The V8 heap cap turns
// that class of runaway into a fast, local abort instead of exhausting host memory.
const defaultHeapLimitMb = 3072;
const heapLimitMb = Number(process.env.DEEPSEEK_AGENT_TEST_HEAP_MB ?? defaultHeapLimitMb);
const heapCapConfigured = process.execArgv.some((argument) => argument.startsWith("--max-old-space-size"))
  || /--max-old-space-size/.test(process.env.NODE_OPTIONS ?? "");
if (!heapCapConfigured && process.env.DEEPSEEK_AGENT_TEST_HEAP_GUARD !== "1") {
  const child = spawn(process.execPath, [
    `--max-old-space-size=${heapLimitMb}`,
    ...process.execArgv,
    fileURLToPath(import.meta.url),
    ...process.argv.slice(2),
  ], { stdio: "inherit", env: { ...process.env, DEEPSEEK_AGENT_TEST_HEAP_GUARD: "1" } });
  const exitCode = await new Promise((resolveExit) => {
    child.once("error", () => resolveExit(1));
    child.once("exit", (code, signal) => resolveExit(signal ? 1 : code ?? 1));
  });
  process.exit(exitCode);
}

const outDir = resolve(".tmp/unit-tests");
const testDir = resolve("src/test");
const integrationDir = resolve(testDir, "integration");
const entryPoints = collectTests(testDir)
  .filter((fileName) => !fileName.startsWith(`${integrationDir}\\`) && !fileName.startsWith(`${integrationDir}/`));

rmSync(outDir, { recursive: true, force: true });

const hostTestDir = resolve(testDir, "webview/host/handlers");
const hostTests = entryPoints.filter((file) => file.startsWith(`${hostTestDir}${sep}`));
const adapterTestDir = resolve(testDir, "webview/ui/chat/presentation/adapters");
const adapterTests = entryPoints.filter((file) => file.startsWith(`${adapterTestDir}${sep}`));
const storageTestDir = resolve(testDir, "storage/persistence/failures");
const storageTests = entryPoints.filter((file) => file.startsWith(`${storageTestDir}${sep}`));
const chromiumDistributionTests = entryPoints.filter((file) => file.startsWith(`${resolve(testDir, "tools/browser/distribution")}${sep}`));
const standardTests = entryPoints.filter((file) => !hostTests.includes(file) && !adapterTests.includes(file) && !storageTests.includes(file) && !chromiumDistributionTests.includes(file));
const buildOptions = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  resolveExtensions: [".ts", ".tsx", ".mjs", ".js", ".json"],
  outdir: outDir,
  outbase: testDir,
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  packages: "external",
  loader: { ".svg": "dataurl", ".ttf": "dataurl" },
  alias: { "@vscode/codicons/dist/codicon.css": resolve("node_modules/@vscode/codicons/dist/codicon.css") },
};

await esbuild.build({ ...buildOptions, entryPoints: standardTests });
// Only handler characterization tests substitute the VS Code UI boundary.
// Other unit tests retain their original module resolution.
if (hostTests.length) {
  await esbuild.build({
    ...buildOptions,
    entryPoints: hostTests,
    alias: { ...buildOptions.alias, vscode: resolve(testDir, "support/VsCodeMock.ts") },
  });
}

// Adapter tests exercise rendering-library failures and alternate valid AST shapes.
// Ordinary UI tests keep the actual markdown and highlighter implementations.
if (adapterTests.length) {
  await esbuild.build({
    ...buildOptions,
    entryPoints: adapterTests,
    alias: {
      ...buildOptions.alias,
      "react-markdown": resolve(testDir, "support/MarkdownAdapterMock.ts"),
      refractor: resolve(testDir, "support/MarkdownAdapterMock.ts"),
    },
  });
}

if (storageTests.length) {
  await esbuild.build({
    ...buildOptions,
    entryPoints: storageTests,
    alias: { ...buildOptions.alias, "node:fs/promises": resolve(testDir, "support/StorageFsFaults.ts") },
  });
}

// Exercise managed-download publication with a deterministic third-party boundary.
// Every other browser test uses the actual Puppeteer package.
if (chromiumDistributionTests.length) {
  await esbuild.build({
    ...buildOptions, entryPoints: chromiumDistributionTests,
    alias: { ...buildOptions.alias, "@puppeteer/browsers": resolve(testDir, "support/PuppeteerDistributionMock.ts") },
  });
}

// The compiler service is only needed while bundling. Leaving it attached keeps an
// auxiliary process alive and confuses memory accounting while tests run.
esbuild.stop();

const memoryLimitMb = Number(process.env.DEEPSEEK_AGENT_TEST_MEMORY_LIMIT_MB ?? "6144");
const memoryReportPath = process.env.DEEPSEEK_AGENT_TEST_MEMORY_REPORT;
const memoryDiagnostics = process.env.DEEPSEEK_AGENT_TEST_MEMORY_LOG === "1";
const memoryHistory = [];
let currentTest = "<loading test files>";
const guard = createMemoryGuard({
  limitMb: memoryLimitMb,
  currentLabel: () => currentTest,
  log: (message) => console.error(message),
  onExceeded: ({ label, ...snapshot }) => {
    writeMemoryReport({ reason: "limit-exceeded", test: label, snapshot, history: memoryHistory });
    // Abort immediately: a runaway allocation would otherwise exhaust system memory.
    process.exit(1);
  },
});

const grepIndex = process.argv.indexOf("--grep");
const mocha = new Mocha({
  color: true,
  ui: "tdd",
  ...(grepIndex >= 0 ? { grep: process.argv[grepIndex + 1] } : {}),
});

// Must load before any test module so that assertion failures never serialize a
// live DOM graph (the cause of the 54 GiB runaway recorded in the incident).
mocha.addFile(resolve("scripts/mocha-assert-guard.mjs"));
for (const entryPoint of entryPoints) {
  const outputPath = relative(testDir, entryPoint).replace(/\.ts$/, ".mjs");
  mocha.addFile(resolve(outDir, outputPath));
}

guard.start();
await mocha.loadFilesAsync();
const runner = mocha.run();
runner.on("test", (test) => {
  currentTest = test.fullTitle();
  recordProgress("start", currentTest, memorySnapshot());
  if (memoryDiagnostics) { console.error(`[memory] start ${currentTest} ${formatSnapshot(memorySnapshot())}`); }
});
runner.on("test end", (test) => {
  const snapshot = guard.check();
  memoryHistory.push({ test: test.fullTitle(), ...snapshot });
  recordProgress("end", test.fullTitle(), snapshot);
  if (memoryDiagnostics) { console.error(`[memory] end   ${test.fullTitle()} ${formatSnapshot(snapshot)}`); }
});
const failures = await new Promise((resolveRun) => {
  runner.once("end", () => resolveRun(runner.failures));
});
guard.stop();
writeMemoryReport({ reason: "completed", test: currentTest, snapshot: { ...guard.peak }, history: memoryHistory });

if (failures) {
  process.exitCode = 1;
}

// A synchronous runaway loop blocks timers, so the watchdog cannot run. The progress
// file is rewritten before every test and survives an external kill, naming the culprit.
function recordProgress(event, testName, snapshot) {
  if (!memoryReportPath) { return; }
  try {
    writeFileSync(`${memoryReportPath}.progress.json`, JSON.stringify({ event, test: testName, pid: process.pid, ...snapshot }, null, 2));
  } catch {
    // Diagnostics must never mask the test result.
  }
}

function writeMemoryReport({ reason, test: testName, snapshot, history }) {
  if (!memoryReportPath) { return; }
  try {
    writeFileSync(memoryReportPath, JSON.stringify({ reason, test: testName, peak: snapshot, history }, null, 2));
  } catch (error) {
    console.error(`Unable to write the memory report: ${String(error)}`);
  }
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
