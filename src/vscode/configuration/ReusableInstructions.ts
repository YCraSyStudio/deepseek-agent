import { resolveSelectedInstructions } from "@/application/chat/context/InstructionReferences";
import type { ReusableInstruction } from "@/contracts/Customization";
import { throwIfAborted } from "@/shared/utils/Cancellation";
import { logWarning } from "@/shared/logging/Logger";
import { getUserDataDirectory } from "@/infrastructure/persistence/UserDataPaths";
import { listReusableInstructions, openReusableInstruction, type InstructionRoot } from "@/infrastructure/persistence/ReusableInstructions";
import { captureCurrentWorkspaceBinding, captureWorkspaceRunSnapshot, type WorkspaceRunSnapshot } from "@/vscode/workspace";

export function reusableInstructionRoots(snapshot = captureWorkspaceRunSnapshot(captureCurrentWorkspaceBinding())): InstructionRoot[] {
  return [
    { id: "global", scope: "global", boundary: getUserDataDirectory(), relativeDirectory: "instructions" },
    ...snapshot.folders.filter((folder) => folder.localPath).map((folder): InstructionRoot => ({
      id: `workspace:${folder.alias}`, scope: "workspace", rootUri: folder.uri, boundary: folder.localPath!, relativeDirectory: "instructions",
    })),
  ];
}

export async function reusableInstructionCatalog(snapshot?: WorkspaceRunSnapshot, signal?: AbortSignal) {
  try {return await listReusableInstructions(reusableInstructionRoots(snapshot), signal);}
  catch {
    throwIfAborted(signal);
    logWarning("[ReusableInstructions] Optional instruction catalog is unavailable.");
    return [];
  }
}

export async function readReusableInstruction(id: string, snapshot: WorkspaceRunSnapshot, signal?: AbortSignal): Promise<string> {
  const roots = reusableInstructionRoots(snapshot);
  const entry = (await listReusableInstructions(roots, signal)).find((item) => item.id === id);
  if (!entry) {throw new Error("Instruction is not in the current catalog.");}
  const { content } = await openReusableInstruction(roots, id, signal);
  return JSON.stringify({ id, scope: entry.scope, workspaceRoot: entry.id.startsWith("workspace:") ? entry.id.split(":")[1] : undefined, content });
}

export async function selectedInstructionContext(text: string, entries: readonly ReusableInstruction[], snapshot?: WorkspaceRunSnapshot, signal?: AbortSignal): Promise<string> {
  const roots = reusableInstructionRoots(snapshot);
  return resolveSelectedInstructions(text, entries, async (id) => (await openReusableInstruction(roots, id, signal)).content, signal);
}
