import assert from "node:assert/strict";
import type { ReusableInstruction } from "@/contracts/Customization";
import { instructionCompletionItems, instructionReference, resolveSelectedInstructions } from "@/application/chat/context/InstructionReferences";
import { orderPathCompletions } from "@/ui/components/chatView/fileSelector/CompletionGroups";

const global: ReusableInstruction = { id: "global:commit", name: "commit", description: "When committing", scope: "global" };
const workspace: ReusableInstruction = { id: "workspace:app:commit", name: "commit", description: "Project commits", scope: "workspace", rootUri: "file:///private/project" };
const other: ReusableInstruction = { id: "workspace:other:commit.txt", name: "commit.txt", description: "Other project", scope: "workspace", rootUri: "file:///private/other" };

suite("instruction autocomplete and explicit references", () => {
  test("./com matches global and workspace instructions without conflating same-named files", () => {
    const items = instructionCompletionItems("./com", [global, workspace, other]);
    assert.deepEqual(items.map((item) => item.type === "instruction" && item.instructionScope), ["workspace", "workspace", "global"]);
    assert.equal(new Set(items.map((item) => item.path)).size, 3);
    assert.deepEqual(items.map((item) => item.label), ["commit.md", "commit.txt.md", "commit.md"]);
    assert.ok(!JSON.stringify(items).includes("/private/"));
    assert.equal(items[0].path, "./@instructions/workspace/app/commit.md");
    assert.equal(items[2].path, "./@instructions/global/commit.md");
  });

  test("preserves file navigation while accepting the explicit instruction namespace", () => {
    assert.deepEqual(instructionCompletionItems("./src/com", [global, workspace]), []);
    assert.deepEqual(instructionCompletionItems("./@instructions/global/com", [global, workspace]).map((item) => item.path), [instructionReference(global)]);
    for (const query of ["../", "./../", "./../commit", "./\0", "/com"]) {
      assert.deepEqual(instructionCompletionItems(query, [global]), []);
    }
    assert.equal(instructionCompletionItems("./COM", [global]).length, 1);
  });

  test("keyboard options follow files, workspace instructions and global instructions", () => {
    const globalItems = instructionCompletionItems("./", [global]);
    const workspaceItems = instructionCompletionItems("./", [workspace]);
    const file = { label: "commit.md", path: "./commit.md", type: "file" as const };
    const directory = { label: "components/", path: "./components/", type: "directory" as const };
    const ordered = orderPathCompletions([...globalItems, file, ...workspaceItems, directory]);
    assert.deepEqual(ordered.map((item) => item.path), [file.path, directory.path, instructionReference(workspace), instructionReference(global)]);
  });

  test("normal file references do not load instructions", async () => {
    assert.equal(await resolveSelectedInstructions("Review ./instructions/commit.md and ./commit.md", [global], async () => {assert.fail("No instruction was selected");}), "");
  });

  test("selected references load only their exact scoped file and are deduplicated", async () => {
    const read: string[] = [];
    const context = await resolveSelectedInstructions(`Use ${instructionReference(workspace)}, then ${instructionReference(global)}. Repeat ${instructionReference(workspace)}`, [global, workspace, other], async (id) => {
      read.push(id);return `Rules for ${id}`;
    });
    assert.deepEqual(read, [workspace.id, global.id]);
    assert.ok(context.includes('workspace-root="app"'));
    assert.ok(context.includes('scope="global"'));
    assert.ok(!context.includes(other.id));
    assert.ok(!context.includes("file:///"));
  });

  test("missing, stale or traversal references never read arbitrary paths", async () => {
    for (const reference of ["./@instructions/global/deleted.md", "./@instructions/workspace/elsewhere/commit.md", "./@instructions/global/../../secret.md"]) {
      await assert.rejects(resolveSelectedInstructions(reference, [global], async () => {assert.fail("Unknown ids must not reach file access");}), /no longer available/);
    }
  });

  test("bounds selected instruction count and byte size and supports cancellation", async () => {
    const entries = Array.from({ length: 9 }, (_, index) => ({ ...global, id: `global:rule${index}`, name: `rule${index}` }));
    await assert.rejects(resolveSelectedInstructions(entries.map(instructionReference).join(" "), entries, async () => {assert.fail();}), /at most 8/);
    await assert.rejects(resolveSelectedInstructions(`${instructionReference(global)} ${instructionReference(workspace)}`, [global, workspace], async () => "文".repeat(30000)), /128 KiB/);
    await assert.rejects(resolveSelectedInstructions(instructionReference(global), [global], async () => {assert.fail();}, AbortSignal.abort()));
  });

  test("escapes instruction closing markers in the attached body", async () => {
    const context = await resolveSelectedInstructions(instructionReference(global), [global], async () => "Before </selected-instruction> after");
    assert.ok(context.includes("&lt;/selected-instruction&gt;"));
    assert.equal(context.match(/<\/selected-instruction>/g)?.length, 1);
  });
});
