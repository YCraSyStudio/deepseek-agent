import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ensureGlobalInstructionsFile, getGlobalInstructionsFilePath } from "@/infrastructure/persistence/GlobalInstructionsFile";

suite("global customization instructions", () => {
  let root: string;
  setup(async () => {root = await mkdtemp(path.join(os.tmpdir(), "deepseek-global-instructions-"));});
  teardown(async () => {await rm(root, { recursive: true, force: true });});

  test("creates an empty AGENTS.md in the configured data directory", async () => {
    const directory = path.join(root, "custom-data");
    const file = await ensureGlobalInstructionsFile(directory);
    assert.equal(file, getGlobalInstructionsFilePath(directory));
    assert.equal(file, path.join(directory, "AGENTS.md"));
    assert.equal(await readFile(file, "utf8"), "");
  });

  test("preserves existing user instructions exactly", async () => {
    const file = getGlobalInstructionsFilePath(root);
    const instructions = "# Mis instrucciones\r\nResponde en español.\r\n";
    await writeFile(file, instructions);
    await ensureGlobalInstructionsFile(root);
    assert.equal(await readFile(file, "utf8"), instructions);
  });

  test("simultaneous opens do not overwrite the file", async () => {
    const directory = path.join(root, "data");
    const files = await Promise.all(Array.from({ length: 4 }, () => ensureGlobalInstructionsFile(directory)));
    assert.ok(files.every((file) => file === files[0]));
    await writeFile(files[0], "User customization");
    await Promise.all([ensureGlobalInstructionsFile(directory), ensureGlobalInstructionsFile(directory)]);
    assert.equal(await readFile(files[0], "utf8"), "User customization");
  });

  test("reports invalid data directories instead of replacing them", async () => {
    const file = path.join(root, "not-a-directory");
    await writeFile(file, "keep this");
    await assert.rejects(() => ensureGlobalInstructionsFile(file));
    assert.equal(await readFile(file, "utf8"), "keep this");
    await mkdir(path.join(root, "AGENTS.md"));
    await assert.rejects(() => ensureGlobalInstructionsFile(root), /must be a file/);
  });
});
