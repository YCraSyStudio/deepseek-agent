import * as esbuild from "esbuild";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as assert from "node:assert/strict";
import net from "node:net";

await esbuild.build({ entryPoints: ["src/infrastructure/execution/LocalExecutionBroker.ts"], bundle: true, platform: "node", format: "esm", packages: "external", outfile: ".tmp/sandbox/broker.mjs" });
const { executeSandboxedCommand } = await import(path.resolve(".tmp/sandbox/broker.mjs"));
const root = await mkdtemp(path.join(tmpdir(), "ycrasy-native-test-"));
const project = path.join(root, "project");
await mkdir(project);
const outside = path.join(root, "private.txt");
await writeFile(outside, "synthetic outside secret");
await writeFile(path.join(project, ".env"), "synthetic project secret");
await link(path.join(project, ".env"), path.join(project, "public-alias.txt"));
await mkdir(path.join(project, ".codex"));
await writeFile(path.join(project, ".codex", "policy.txt"), "synthetic control secret");
await symlink(outside, path.join(project, "escape"), process.platform === "win32" ? "file" : undefined);
const server = net.createServer((socket) => socket.end());
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const port = server.address().port;
const options = { cwd: project, workspaceRoot: project, timeoutMs: 2000, maxOutputBytes: 4096 };
const tools = [path.dirname(path.dirname(process.execPath))];
const node = JSON.stringify(process.execPath);
// Scripts are fixtures in the writable project; command strings contain only generated fixture paths.
async function runScript(name, source, override = {}) {
  const file = path.join(project, `${name}.cjs`);
  await writeFile(file, source);
  return executeSandboxedCommand(`${node} ${JSON.stringify(file)}`, { ...options, ...override }, false, undefined, tools);
}
try {
  const result = await runScript("isolation", `const fs=require('fs');
    fs.writeFileSync('allowed.txt','ok');
    for(const file of [${JSON.stringify(outside)},'escape','.env','public-alias.txt','.codex/policy.txt']) {
      try {const bytes=fs.readFileSync(file,'utf8'); if(bytes.includes('secret'))process.exit(2);}catch{}
    }
    if(process.env.SSH_AUTH_SOCK||process.env.OPENAI_API_KEY||process.env.NODE_OPTIONS)process.exit(4);
    const child=require('child_process').spawnSync(process.execPath,['-e',${JSON.stringify(`try{require('fs').readFileSync(${JSON.stringify(outside)});process.exit(5)}catch{}`)}]);
    if(child.status!==0)process.exit(6);
    try{fs.writeFileSync(${JSON.stringify(outside)},'bad')}catch{}
    const s=require('net').connect({host:'127.0.0.1',port:${port}});
    s.on('connect',()=>process.exit(7));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(8),500);`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.sandbox.network, "deny");
  assert.equal(await readFile(path.join(project, "allowed.txt"), "utf8"), "ok");
  assert.equal(await readFile(outside, "utf8"), "synthetic outside secret");
  const bounded = await runScript("output", "process.stdout.write('x'.repeat(12000));process.stderr.write('tail');process.exit(7)");
  assert.equal(bounded.exitCode, 7); assert.equal(bounded.truncated.stdout, true); assert.ok(bounded.stdout.length <= 4096);
  const timeout = await runScript("timeout", "setInterval(()=>{},1000)", { timeoutMs: 200 });
  assert.equal(timeout.timedOut, true);
  const controller = new AbortController();
  const aborted = runScript("abort", "setInterval(()=>{},1000)", { signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  await assert.rejects(aborted, (error) => error.name === "AbortError");
  if (process.platform !== "darwin") {
    const marker = path.join(project, "descendant.txt");
    await runScript("descendant", `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'survived'),500)`)}], {detached:true,stdio:'ignore'}).unref()`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await assert.rejects(readFile(marker));
  }
  const concurrent = await Promise.all([runScript("parallel-a", "console.log('a')"), runScript("parallel-b", "console.log('b')")]);
  assert.ok(concurrent.every((entry) => entry.exitCode === 0));
  await assert.rejects(executeSandboxedCommand("echo must-not-run", { ...options, cwd: root }), /cwd must be inside/);
  console.log(`Native isolation, child inheritance, network denial, output limits, timeout and cancellation passed: ${result.sandbox.backend}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
