import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as esbuild from "esbuild";

const executable = process.argv[2];
if (!executable) {throw new Error("Usage: node scripts/test-electron-sandbox.mjs <VS Code executable>");}
mkdirSync(".tmp/sandbox", { recursive: true });
// CJS matches the actual extension-host bundle. Use Electron's ASAR-enabled fs,
// and scan this real workspace, including the downloaded VS Code installation.
writeFileSync(".tmp/sandbox/electron-entry.ts", `
import { executeSandboxedCommand } from "../../src/infrastructure/execution/LocalExecutionBroker";
import { physicalFileSystem } from "../../src/infrastructure/execution/PhysicalFileSystem";
async function main() {
  const result = await executeSandboxedCommand("printf 'sandbox funcionando\\\\n'", {
    cwd: process.cwd(), workspaceRoot: process.cwd(), timeoutMs: 5000, maxOutputBytes: 4096,
  });
  if (result.exitCode !== 0 || result.stdout !== "sandbox funcionando\\n") {
    throw new Error(JSON.stringify(result));
  }
  console.log(JSON.stringify({ electron: process.versions.electron, node: process.versions.node,
    physicalFs: typeof physicalFileSystem().readdir, sandbox: result.sandbox, stdout: result.stdout }));
}
main().catch(error => {console.error(error); process.exitCode = 1});
`);
await esbuild.build({ entryPoints: [".tmp/sandbox/electron-entry.ts"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile: ".tmp/sandbox/electron-entry.cjs" });
const child = spawnSync(resolve(executable), [resolve(".tmp/sandbox/electron-entry.cjs")], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 60000, maxBuffer: 64 * 1024,
});
process.stdout.write(child.stdout ?? "");
process.stderr.write(child.stderr ?? "");
if (child.error) {throw child.error;}
if (child.status !== 0) {throw new Error(`Electron sandbox regression failed: ${child.status}`);}
