import { instructionReference, resolveSelectedInstructions } from "@/application/chat/context/InstructionReferences";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createReusableInstruction, formatReusableInstructionCatalog, instructionName, listReusableInstructions, openReusableInstruction, type InstructionRoot } from "@/infrastructure/persistence/ReusableInstructions";

suite("reusable task instructions", () => {
  let directory: string;
  let global: InstructionRoot;
  let workspace: InstructionRoot;
  setup(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "deepseek-instructions-"));
    global = { id: "global", scope: "global", boundary: path.join(directory, "data"), relativeDirectory: "instructions" };
    workspace = { id: "workspace:project", scope: "workspace", rootUri: "file:///project", boundary: path.join(directory, "project"), relativeDirectory: "instructions" };
    await mkdir(workspace.boundary);
  });
  teardown(async () => {await rm(directory, { recursive: true, force: true });});

  test("creates an editable localized commit template with its activation description", async () => {
    const file = await createReusableInstruction(global, "Commit", "Al crear un commit", "es", "commit");
    assert.equal(file, path.join(global.boundary, "instructions", "commit.md"));
    const text = await readFile(file, "utf8");
    assert.ok(text.includes('description: "Al crear un commit"'));
    assert.ok(text.includes("## Convenciones del mensaje"));
    assert.ok(text.includes("[ticket]"));
    const entries = await listReusableInstructions([global]);
    assert.deepEqual(entries.map(({id, name, description}) => ({id, name, description})), [{ id: "global:commit", name: "commit", description: "Al crear un commit" }]);
  });

  test("keeps user-entered extensions in the base name and always adds Markdown", async () => {
    for (const name of ["commit.txt", "review.json", "notes.md", "multi.part.name"]) {
      const file = await createReusableInstruction(global, name, "Custom task");
      assert.equal(file, path.join(global.boundary, "instructions", `${name}.md`));
      const { file: opened } = await openReusableInstruction([global], `global:${name}`);
      assert.equal(opened, file);
    }
    const entries = await listReusableInstructions([global]);
    assert.deepEqual(entries.map((entry) => entry.name).sort(), ["commit.txt", "multi.part.name", "notes.md", "review.json"]);
    assert.ok(formatReusableInstructionCatalog(entries).includes("global:commit.txt"));
  });

  test("selected template controls the body independently of the file name", async () => {
    const git = await createReusableInstruction(global, "workflow", "Git tasks", "en", "git");
    const commit = await createReusableInstruction(global, "messages", "Commit tasks", "en", "commit");
    const blank = await createReusableInstruction(global, "commit", "Custom task", "en", "blank");
    const gitText = await readFile(git, "utf8");
    const commitText = await readFile(commit, "utf8");
    const blankText = await readFile(blank, "utf8");
    assert.ok(gitText.includes("merge/rebase"));
    assert.ok(gitText.includes("Preserve unrelated local changes"));
    assert.ok(commitText.includes("[ticket]"));
    assert.ok(commitText.includes("Language:"));
    assert.ok(commitText.includes("fix: / feature:"));
    assert.ok(!blankText.includes("[ticket]"));
    assert.ok(blankText.includes("## Instructions"));
    await createReusableInstruction(global, "workflow", "Changed trigger", "zh", "commit");
    assert.equal(await readFile(git, "utf8"), gitText);
  });

  test("opening an existing instruction preserves all its content and metadata", async () => {
    const file = await createReusableInstruction(global, "commit", "Original");
    const existing = "---\r\ndescription: Existing rules\r\n---\r\n\r\n# Commit\r\nUse Spanish and [ticket].\r\n";
    await writeFile(file, existing);
    await createReusableInstruction(global, "commit", "Replacement", "zh");
    assert.equal(await readFile(file, "utf8"), existing);
    assert.equal((await openReusableInstruction([global], "global:commit")).content, existing);
  });

  test("global and workspace entries with the same name keep distinct scoped ids", async () => {
    await createReusableInstruction(global, "commit", "Global commits");
    const workspaceFile = await createReusableInstruction(workspace, "commit", "Project commits");
    assert.equal(workspaceFile, path.join(workspace.boundary, "instructions", "commit.md"));
    const entries = await listReusableInstructions([global, workspace]);
    assert.deepEqual(entries.map((entry) => entry.id), ["global:commit", "workspace:project:commit"]);
    assert.equal(entries[1].rootUri, "file:///project");
    const content = await openReusableInstruction([global, workspace], "workspace:project:commit");
    assert.ok(content.file.startsWith(workspace.boundary));
  });

  test("autocomplete references read the latest selected file from the bound instruction roots", async () => {
    await createReusableInstruction(global, "commit", "Global rules");
    const file = await createReusableInstruction(workspace, "commit", "Workspace rules");
    const roots = [global, workspace];
    const entries = await listReusableInstructions(roots);
    const selected = entries.find((entry) => entry.scope === "workspace")!;
    await writeFile(file, "# Updated project commit rules\nUse Spanish and [ticket].\n");
    const context = await resolveSelectedInstructions(`Follow ${instructionReference(selected)}`, entries,
      async (id) => (await openReusableInstruction(roots, id)).content);
    assert.ok(context.includes("Updated project commit rules"));
    assert.ok(context.includes("Use Spanish and [ticket]"));
    assert.ok(!context.includes("Global rules"));
    await rm(file);
    await assert.rejects(resolveSelectedInstructions(instructionReference(selected), entries,
      async (id) => (await openReusableInstruction(roots, id)).content));
  });

  test("catalog includes only names and descriptions, while the tool can read the full rules", async () => {
    const file = await createReusableInstruction(global, "commit", "When preparing commits");
    await writeFile(file, (await readFile(file, "utf8")) + "\nPRIVATE BODY NOT FOR EVERY MESSAGE\n");
    const catalog = formatReusableInstructionCatalog(await listReusableInstructions([global]));
    assert.ok(catalog.includes("When preparing commits"));
    assert.ok(catalog.includes("read_instruction"));
    assert.ok(!catalog.includes("PRIVATE BODY"));
    assert.ok(!catalog.includes(directory));
    assert.ok((await openReusableInstruction([global], "global:commit")).content.includes("PRIVATE BODY"));
  });

  test("rejects traversal, absolute paths and nonexistent scope ids", async () => {
    for (const name of ["../outside", "/tmp/other", "a/b", "a\\b", ".hidden", "a:other", "", "x".repeat(65)]) {
      assert.throws(() => instructionName(name));
    }
    await createReusableInstruction(global, "commit", "When committing");
    for (const id of ["global:../outside", "global:/tmp/other", "global:commit.md", "workspace:other:commit"]) {
      await assert.rejects(openReusableInstruction([global], id));
    }
  });

  test("does not follow file or parent-directory symlinks", async () => {
    const unrelated = path.join(directory, "unrelated.md");
    await writeFile(unrelated, "keep");
    const file = await createReusableInstruction(global, "commit", "When committing");
    await rm(file);
    await symlink(unrelated, file);
    await assert.rejects(openReusableInstruction([global], "global:commit"), /regular/);
    await assert.rejects(createReusableInstruction(global, "commit", "No replacement"), /regular/);
    assert.deepEqual(await listReusableInstructions([global]), []);
    await mkdir(path.join(directory, "outside"));
    await symlink(path.join(directory, "outside"), path.join(workspace.boundary, "instructions"));
    await assert.rejects(createReusableInstruction(workspace, "commit", "When committing"), /ordinary directories/);
    assert.equal(await readFile(unrelated, "utf8"), "keep");
  });

  test("rejects multiline or oversized descriptions and oversized instruction files", async () => {
    for (const summary of ["", "line\nbreak", "x".repeat(351)]) {
      await assert.rejects(createReusableInstruction(global, "commit", summary));
    }
    const file = await createReusableInstruction(global, "commit", "Valid");
    await writeFile(file, "x".repeat(65537));
    assert.deepEqual(await listReusableInstructions([global]), []);
    await assert.rejects(openReusableInstruction([global], "global:commit"), /64 KiB/);
  });

  test("missing optional directories are empty and an aborted scan stops", async () => {
    assert.deepEqual(await listReusableInstructions([global, workspace]), []);
    assert.equal(formatReusableInstructionCatalog([]), "");
    await assert.rejects(listReusableInstructions([global], AbortSignal.abort()));
  });

  test("existing files without metadata remain discoverable by name", async () => {
    const file = await createReusableInstruction(global, "release", "Release workflow");
    await writeFile(file, "# Release\n\nDetailed steps.\n");
    const entries = await listReusableInstructions([global]);
    assert.equal(entries[0].description, "release");
  });
});
