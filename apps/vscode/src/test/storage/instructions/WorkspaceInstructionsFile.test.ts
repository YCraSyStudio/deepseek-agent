import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ensureWorkspaceInstructionsFile } from "@/infrastructure/persistence/WorkspaceInstructionsFile";

suite("workspace customization instructions", () => {
  let root: string;
  setup(async () => {root = await mkdtemp(path.join(os.tmpdir(), "deepseek-workspace-instructions-"));});
  teardown(async () => {await rm(root, { recursive: true, force: true });});

  test("creates an editable template in the selected workspace and language", async () => {
    for (const [locale, heading] of [["es-ES", "Descripción del proyecto"], ["en", "Project overview"], ["zh-CN", "项目概述"]]) {
      const folder = path.join(root, locale);
      await mkdir(folder);
      const file = await ensureWorkspaceInstructionsFile(folder, locale);
      assert.equal(file, path.join(folder, "AGENTS.md"));
      const content = await readFile(file, "utf8");
      assert.ok(content.startsWith("# AGENTS.md\n"));
      assert.ok(content.includes(heading));
      assert.equal(content.match(/^## /gm)?.length, 5);
    }
  });

  test("preserves existing instructions exactly during simultaneous opens", async () => {
    const file = path.join(root, "AGENTS.md");
    const content = "# Custom instructions\r\nKeep my content.\r\n";
    await writeFile(file, content);
    await Promise.all([ensureWorkspaceInstructionsFile(root, "es"), ensureWorkspaceInstructionsFile(root, "zh")]);
    assert.equal(await readFile(file, "utf8"), content);
  });

  test("simultaneous generation creates one complete template", async () => {
    await Promise.all(Array.from({ length: 4 }, () => ensureWorkspaceInstructionsFile(root)));
    assert.equal((await readFile(path.join(root, "AGENTS.md"), "utf8")).match(/^## /gm)?.length, 5);
  });

  test("does not create missing workspaces or replace invalid paths", async () => {
    await assert.rejects(() => ensureWorkspaceInstructionsFile(path.join(root, "missing")));
    const file = path.join(root, "existing-file");
    await writeFile(file, "preserve");
    await assert.rejects(() => ensureWorkspaceInstructionsFile(file));
    assert.equal(await readFile(file, "utf8"), "preserve");
    await mkdir(path.join(root, "AGENTS.md"));
    await assert.rejects(() => ensureWorkspaceInstructionsFile(root), /must be a file/);
  });
});
