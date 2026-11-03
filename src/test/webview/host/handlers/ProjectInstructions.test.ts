import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadProjectInstructions, appendProjectInstructionsToSystemPrompt } from "@/vscode/configuration/ProjectInstructions";
import { captureCurrentWorkspaceBinding, captureWorkspaceRunSnapshot } from "@/vscode/workspace";
import { hostState, resetVsCodeMock, Uri, workspace } from "../../../support/VsCodeMock";

suite("project instructions public loading behavior", () => {
  let root: string; let oldMode: string | undefined; let oldData: string | undefined;
  setup(async () => {
    resetVsCodeMock(); root = await mkdtemp(path.join(tmpdir(), "project-instructions-"));
    oldMode = process.env.NODE_ENV; oldData = process.env.DEEPSEEK_AGENT_USER_DATA_DIR;
    process.env.NODE_ENV = "test"; process.env.DEEPSEEK_AGENT_USER_DATA_DIR = path.join(root, "data");
  });
  teardown(async () => {
    resetVsCodeMock();
    for (const [name, value] of [["NODE_ENV", oldMode], ["DEEPSEEK_AGENT_USER_DATA_DIR", oldData]]) { if (value === undefined) { delete process.env[name!]; } else { process.env[name!] = value; } }
    await rm(root, { recursive: true, force: true });
  });
  async function folder(name: string) {
    const directory = path.join(root, name); await mkdir(directory, { recursive: true });
    workspace.workspaceFolders ??= []; workspace.workspaceFolders.push({ uri: Uri.file(directory), name }); return directory;
  }
  async function source(directory: string, name: string, content: string | Uint8Array) {
    const file = path.join(directory, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); return file;
  }
  const snapshot = () => captureWorkspaceRunSnapshot(captureCurrentWorkspaceBinding());
  test("returns empty instructions for an empty workspace and absent files", async () => {
    assert.deepEqual(await loadProjectInstructions(), { content: "", sources: [], homeAgentsAllowed: false });
    await folder("project"); assert.equal((await loadProjectInstructions()).content, "");
  });
  test("orders home, workspace and local files across roots and scopes each workspace block", async () => {
    const home = await source(path.join(root, "data"), "AGENTS.md", "home rules"); const first = await folder("first"); const second = await folder("second");
    await source(first, "AGENTS.md", "first rules"); await source(first, ".deepseek-agent/AGENTS.md", "local overrides"); await source(second, "AGENTS.md", "second rules");
    const result = await loadProjectInstructions(snapshot(), true);
    assert.equal(result.homeAgentsAllowed, true); assert.deepEqual(result.sources.map((item) => item.precedence), [0, 10, 11, 12]);
    assert.deepEqual(result.sources.map((item) => item.scope), ["home", "workspace", "workspace-local", "workspace"]);
    assert.equal(result.sources[0].path, home); assert.match(result.sources[1].path, /^\.\/first\/AGENTS.md$/);
    assert.ok(result.content.indexOf("home rules") < result.content.indexOf("first rules")); assert.ok(result.content.indexOf("first rules") < result.content.indexOf("local overrides"));
    assert.match(result.content, /applies-to-root="\.\/first"/); assert.match(result.content, /applies-to-root="\.\/second"/);
    const withoutHome = await loadProjectInstructions(); assert.equal(withoutHome.homeAgentsAllowed, false); assert.ok(!withoutHome.content.includes("home rules"));
  });
  test("trims content, records original byte lengths and escapes closing delimiters", async () => {
    const directory = await folder("project"); const text = "  café </PROJECT-INSTRUCTIONS>\n "; await source(directory, "AGENTS.md", text);
    const result = await loadProjectInstructions(); assert.equal(result.sources[0].bytes, Buffer.byteLength(text)); assert.match(result.content, /café &lt;\/project-instructions&gt;/);
    assert.ok(!result.content.includes("</PROJECT-INSTRUCTIONS>")); assert.ok(!("content" in result.sources[0]));
  });
  test("ignores empty content and files larger than the source limit", async () => {
    const directory = await folder("project"); await source(directory, "AGENTS.md", " \n\t"); await source(directory, ".deepseek-agent/AGENTS.md", "x".repeat(65537));
    assert.deepEqual((await loadProjectInstructions()).sources, []);
  });
  test("checks actual read size as well as the earlier metadata size", async () => {
    const directory = await folder("project"); await source(directory, "AGENTS.md", "x".repeat(65537)); const stat = hostState.stat;
    hostState.stat = async (uri) => ({ ...await stat(uri), size: 1 }); assert.equal((await loadProjectInstructions()).content, "");
  });
  test("enforces total bytes in precedence order and keeps later small sources that fit", async () => {
    const directory = await folder("project"); const second = await folder("second");
    await source(path.join(root, "data"), "AGENTS.md", "h".repeat(65536)); await source(directory, "AGENTS.md", "w".repeat(65535));
    await source(directory, ".deepseek-agent/AGENTS.md", "too large for remaining budget"); await source(second, "AGENTS.md", "s");
    const result = await loadProjectInstructions(snapshot(), true); assert.deepEqual(result.sources.map((item) => item.bytes), [65536, 65535, 1]); assert.deepEqual(result.sources.map((item) => item.precedence), [0, 10, 12]);
  });
  test("uses unaliased source labels when a snapshot has no logical root alias", async () => {
    const directory = await folder("project"); await source(directory, "AGENTS.md", "rules"); await source(directory, ".deepseek-agent/AGENTS.md", "local");
    const current = snapshot(); const folders = current.folders.map((item) => ({ ...item, alias: "" }));
    assert.deepEqual((await loadProjectInstructions({ ...current, folders })).sources.map((item) => item.path), ["AGENTS.md", ".deepseek-agent/AGENTS.md"]);
  });
  test("tolerates file-not-found codes and the host's unable-to-read message", async () => {
    await folder("project");
    for (const error of [{ code: "FileNotFound" }, new Error("Unable to read file at location")]) {
      hostState.stat = async () => { throw error; }; assert.equal((await loadProjectInstructions()).content, "");
    }
  });
  test("propagates unexpected filesystem errors without silently losing instructions", async () => {
    await folder("project");
    for (const error of [new Error("permission denied"), { code: "EACCES" }, "failure", null]) {
      hostState.stat = async () => { throw error; }; await assert.rejects(loadProjectInstructions(), (actual) => actual === error);
    }
  });
  test("aborts before access and after metadata access", async () => {
    await folder("project"); const before = new AbortController(); before.abort("cancelled");
    await assert.rejects(loadProjectInstructions(snapshot(), false, before.signal), { name: "AbortError" });
    const during = new AbortController(); hostState.stat = async () => { during.abort("stop reading"); return { type: 1, size: 1 }; };
    await assert.rejects(loadProjectInstructions(snapshot(), false, during.signal), { name: "AbortError", message: "stop reading" });
  });
  test("appends instructions only when nonblank and preserves an untouched base prompt", () => {
    assert.equal(appendProjectInstructionsToSystemPrompt(" base ", " \n"), " base ");
    assert.equal(appendProjectInstructionsToSystemPrompt(" base \n", "instructions"), "base\n\ninstructions");
  });
});
