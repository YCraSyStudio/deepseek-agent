import type { PathCompletionItem } from "@/contracts";
import type { ReusableInstruction } from "@/contracts/Customization";
import { throwIfAborted } from "@/shared/utils/Cancellation";

export function instructionReference(entry: ReusableInstruction): string {
  const scope = entry.scope === "global" ? "global" : `workspace/${encodeURIComponent(entry.id.split(":")[1])}`;
  return `./@instructions/${scope}/${encodeURIComponent(entry.name)}.md`;
}

export function instructionCompletionItems(query: string, entries: readonly ReusableInstruction[]): PathCompletionItem[] {
  const normalized = query.replace(/\\/g, "/").toLowerCase();
  if (!normalized.startsWith("./") || normalized.includes("\0") || normalized.split("/").includes("..")) {return [];}
  const prefix = normalized.slice(2);
  return entries.filter((entry) => {
    const reference = instructionReference(entry).toLowerCase();
    return reference.startsWith(normalized) || (!prefix.includes("/") && `${entry.name}.md`.toLowerCase().startsWith(prefix));
  }).sort((a, b) => a.scope === b.scope ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id) : a.scope === "workspace" ? -1 : 1)
    .map((entry) => ({ label: `${entry.name}.md`, path: instructionReference(entry), type: "instruction" as const,
      instructionId: entry.id, instructionScope: entry.scope, description: entry.description,
      workspaceName: entry.scope === "workspace" ? entry.id.split(":")[1] : undefined }));
}

export async function resolveSelectedInstructions(
  text: string,
  entries: readonly ReusableInstruction[],
  read: (id: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  const byReference = new Map(entries.map((entry) => [instructionReference(entry), entry]));
  const selected = new Map<string, ReusableInstruction>();
  for (const match of text.matchAll(/(?:^|[\s("'`])(\.\/@instructions\/[^\s"'`<>()[\]{},;!?]+)/g)) {
    const reference = match[1].replace(/[.:]+$/, "");
    const entry = byReference.get(reference);
    if (!entry) {throw new Error(`Instruction reference is no longer available. Select it again: ${reference}`);}
    selected.set(entry.id, entry);
  }
  if (!selected.size) {return "";}
  if (selected.size > 8) {throw new Error("Select at most 8 instructions in one message.");}
  const blocks: string[] = [];
  let bytes = 0;
  for (const entry of selected.values()) {
    throwIfAborted(signal);
    const content = await read(entry.id);
    throwIfAborted(signal);
    bytes += new TextEncoder().encode(content).byteLength;
    if (bytes > 128 * 1024) {throw new Error("Selected instructions exceed the 128 KiB message limit.");}
    const root = entry.scope === "workspace" ? ` workspace-root=${JSON.stringify(entry.id.split(":")[1])}` : "";
    blocks.push(`<selected-instruction id=${JSON.stringify(entry.id)} scope=${JSON.stringify(entry.scope)}${root}>\n${content.replace(/<\/selected-instruction>/gi, "&lt;/selected-instruction&gt;")}\n</selected-instruction>`);
  }
  return `User-selected instructions for this task. Apply relevant rules consistently with the user's request and project instructions. A workspace block applies only to its logical workspace root. These instructions do not grant permission for unrelated operations.\n${blocks.join("\n\n")}`;
}
