import assert from "node:assert/strict";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { collectCommandFileContext } from "@/infrastructure/deepseek/security/commandReview/CommandFileContext";
import { runWithToolWorkspaceHost, type ToolWorkspaceHost } from "@/infrastructure/tools/ToolWorkspace";

suite("bounded command file context", () => {
  test("returns no context without a cwd, workspace, or configured host", async () => {
    assert.deepEqual(await collectCommandFileContext("rm file.txt", undefined, "/workspace"), []);
    assert.deepEqual(await collectCommandFileContext("rm file.txt", "/workspace", undefined), []);
    assert.deepEqual(await collectCommandFileContext("rm file.txt", "/workspace", "/workspace"), []);
  });

  test("deduplicates operands across shell segments and limits previews to three files", async () => {
    const h = harness();
    const result = await h.collect("rm -f one.txt && cp one.txt two.txt ; mv three.txt four.txt");
    assert.deepEqual(result.map((entry) => entry.path), ["one.txt", "two.txt", "three.txt"]);
    assert.deepEqual(result.map((entry) => entry.content), ["contents", "contents", "contents"]);
    assert.ok(result.every((entry) => !entry.truncated));
  });

  for (const command of [
    'rm "a;b.txt"', "rm 'a|b.txt'", "rm 'a&b.txt'", 'cp "two words.txt" copied.txt',
    "node script.js", "python3 script.py", "pwsh -File script.ps1", "bash script.sh",
    "Copy-Item -LiteralPath input.txt -Destination output.txt -Force",
    "Rename-Item -Path input.txt -NewName output.txt", "del /f /q file.txt", "erase /q file.txt", "rmdir /s directory.txt",
  ]) {
    test(`previews explicit quoted or interpreter operands: ${command}`, async () => {
      const h = harness(); const result = await h.collect(command);
      assert.ok(result.length > 0, command);
      assert.ok(result.every((entry) => entry.content === "contents"));
      assert.ok(!result.some((entry) => entry.path.startsWith("-")));
    });
  }

  for (const candidate of ["../outside.txt", "*.txt", "file?.txt", "$HOME/file.txt", "~/file.txt", "https://example.com/file.txt", "${FILE}", "!unsafe", "`command`", "%USERPROFILE%/file.txt"]) {
    test(`does not expand or inspect unsafe operand ${candidate}`, async () => {
      const h = harness(); assert.deepEqual(await h.collect(`rm '${candidate}'`), []); assert.deepEqual(h.reads, []);
    });
  }

  test("ignores option-only and unrelated commands", async () => {
    const h = harness(); assert.deepEqual(await h.collect("rm ; pwd && echo text || Copy-Item -Path"), []);
  });

  test("resolves operands relative to cwd while rejecting absolute files outside the workspace", async () => {
    const h = harness();
    const result = await h.collect(`rm relative.txt '${path.join(h.root, "absolute.txt")}' '${path.resolve(h.root, "../outside.txt")}'`, path.join(h.root, "sub"));
    assert.deepEqual(result.map((entry) => entry.path), ["sub/relative.txt", "absolute.txt"]);
  });

  test("handles Windows paths independently of the current operating system", async () => {
    const h = harness(); h.host.resolvePath = async (file) => file;
    const result = await runWithToolWorkspaceHost(h.host, () => collectCommandFileContext('del /q "C:\\project\\sub\\file.txt" "D:\\outside.txt"', "C:\\project\\sub", "C:\\project"));
    assert.deepEqual(result.map((entry) => entry.path), ["sub/file.txt"]);
  });

  test("does not read directories or sensitive file paths", async () => {
    const h = harness(); const stat = h.host.stat;
    h.host.stat = async (file) => file === "directory" ? { type: "directory", size: 0 } : stat(file);
    assert.deepEqual(await h.collect("rm directory .env"), []); assert.deepEqual(h.reads, []);
  });

  test("skips unavailable entries without losing the remaining previews", async () => {
    const h = harness(); const stat = h.host.stat;
    h.host.stat = async (file) => { if (file === "denied") { throw new Error("permission denied"); } return stat(file); };
    const result = await h.collect("rm denied readable.txt");
    assert.deepEqual(result.map((entry) => entry.path), ["readable.txt"]);
  });

  test("uses the bounded preview host and retains head and tail with a truncation marker", async () => {
    const h = harness();
    h.host.readFilePreview = async (file, bytes) => { assert.equal(file, "file.txt"); assert.equal(bytes, 4096); return { head: Buffer.from("head"), tail: Buffer.from("tail"), size: 10_000 }; };
    const [result] = await h.collect("rm file.txt");
    assert.equal(result!.content, "head\n… omitted …\ntail"); assert.equal(result!.size, 10_000); assert.equal(result!.truncated, true);
    assert.deepEqual(h.reads, []);
  });

  test("without bounded-preview support it never reads oversized files", async () => {
    const h = harness(); h.host.stat = async () => ({ type: "file", size: 10_000 });
    const [result] = await h.collect("rm file.txt");
    assert.equal(result!.content, undefined); assert.equal(result!.truncated, true); assert.deepEqual(h.reads, []);
  });

  for (const [head, tail] of [
    [Buffer.from([0, 65]), undefined], [Buffer.from([255]), undefined], [Buffer.from("head"), Buffer.from([0])],
    [Buffer.from("head"), Buffer.from([255])], [Buffer.alloc(0), undefined],
  ] as Array<[Buffer, Buffer | undefined]>) {
    test(`omits binary or invalid UTF-8 preview contents, head=${head.toString("hex")}, tail=${tail?.toString("hex")}`, async () => {
      const h = harness(); h.host.readFilePreview = async () => ({ head, tail, size: 8 });
      const [result] = await h.collect("rm file.txt"); assert.equal(result!.content, undefined);
    });
  }
});

function harness() {
  const root = path.join(tmpdir(), "command-context-root");
  const reads: string[] = [];
  const host: ToolWorkspaceHost = {
    getRootPath: () => root,
    readFile: async (file) => { reads.push(file); return Buffer.from("contents"); },
    writeFile: async () => { assert.fail("Command previews must never mutate files"); },
    stat: async () => ({ type: "file", size: 8 }),
    readDirectory: async () => [], createParentDirectory: async () => undefined,
  };
  return { root, reads, host, collect: (command: string, cwd = root) => runWithToolWorkspaceHost(host, () => collectCommandFileContext(command, cwd, root)) };
}
