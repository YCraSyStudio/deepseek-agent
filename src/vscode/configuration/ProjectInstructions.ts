import * as os from "os";
import * as vscode from "vscode";
import {
  captureCurrentWorkspaceBinding,
  captureWorkspaceRunSnapshot,
} from "@/vscode/workspace";
import { createAbortError, throwIfAborted } from "@/shared/utils/Cancellation";

const AGENTS_FILE_NAME = "AGENTS.md";
const PROJECT_INSTRUCTIONS_HEADER = "## Project Instructions";
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024;

interface ProjectInstructionSource {
  path: string;
  scope: "home" | "workspace" | "workspace-local";
  precedence: number;
  bytes: number;
}

export interface ProjectInstructionsResult {
  content: string;
  sources: ProjectInstructionSource[];
  homeAgentsAllowed: boolean;
}

interface CandidateSource {
  uri: vscode.Uri;
  scope: ProjectInstructionSource["scope"];
  precedence: number;
  rootAlias?: string;
}

export async function loadProjectInstructions(
  workspaceSnapshot = captureWorkspaceRunSnapshot(captureCurrentWorkspaceBinding()),
  includeHomeAgents = false,
  signal?: AbortSignal,
): Promise<ProjectInstructionsResult> {
  throwIfAborted(signal);
  const homeAgentsAllowed = includeHomeAgents;
  const candidates: CandidateSource[] = [];

  if (homeAgentsAllowed) {
    candidates.push({
      uri: vscode.Uri.joinPath(vscode.Uri.file(os.homedir()), ".deepseek-agent", AGENTS_FILE_NAME),
      scope: "home",
      precedence: 0,
    });
  }

  for (const [rootIndex, folder] of workspaceSnapshot.folders.entries()) {
    candidates.push(
      {
        uri: vscode.Uri.joinPath(folder.rootUri, AGENTS_FILE_NAME),
        scope: "workspace",
        precedence: 10 + rootIndex * 2,
        rootAlias: folder.alias,
      },
      {
        uri: vscode.Uri.joinPath(folder.rootUri, ".deepseek-agent", AGENTS_FILE_NAME),
        scope: "workspace-local",
        precedence: 11 + rootIndex * 2,
        rootAlias: folder.alias,
      },
    );
  }

  const loaded = await Promise.all(candidates.map((candidate) => readInstructionSource(candidate, signal)));
  throwIfAborted(signal);
  const sources: LoadedInstructionSource[] = [];
  let totalBytes = 0;
  for (const source of loaded.filter((item): item is LoadedInstructionSource => item !== undefined).sort((a, b) => a.precedence - b.precedence)) {
    if (totalBytes + source.bytes <= MAX_TOTAL_BYTES) {
      sources.push(source);
      totalBytes += source.bytes;
    }
  }

  return {
    content: formatProjectInstructions(sources),
    sources: sources.map(({ content, ...source }) => source),
    homeAgentsAllowed,
  };
}

export function appendProjectInstructionsToSystemPrompt(systemPrompt: string, projectInstructions: string): string {
  if (!projectInstructions.trim()) {
    return systemPrompt;
  }

  return `${systemPrompt.trim()}

${projectInstructions}`;
}

interface LoadedInstructionSource extends ProjectInstructionSource {
  content: string;
}

async function readInstructionSource(
  candidate: CandidateSource,
  signal?: AbortSignal,
): Promise<LoadedInstructionSource | undefined> {
  try {
    throwIfAborted(signal);
    const metadata = await vscode.workspace.fs.stat(candidate.uri);
    throwIfAborted(signal);
    if (metadata.size > MAX_SOURCE_BYTES) {return undefined;}
    const bytes = await vscode.workspace.fs.readFile(candidate.uri);
    throwIfAborted(signal);
    if (bytes.byteLength > MAX_SOURCE_BYTES) {
      return undefined;
    }
    const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
    if (!content) {
      return undefined;
    }

    return {
      path: formatSourcePath(candidate),
      scope: candidate.scope,
      precedence: candidate.precedence,
      bytes: bytes.byteLength,
      content,
    };
  } catch (err: unknown) {
    if (signal?.aborted) {
      throw createAbortError(signal.reason);
    }
    if (isFileNotFoundError(err)) {
      return undefined;
    }
    throw err;
  }
}

function formatSourcePath(candidate: CandidateSource): string {
  if (candidate.scope === "home") {return "~/.deepseek-agent/AGENTS.md";}
  const relativePath = candidate.scope === "workspace-local" ? ".deepseek-agent/AGENTS.md" : "AGENTS.md";
  return candidate.rootAlias ? `./${candidate.rootAlias}/${relativePath}` : relativePath;
}

function formatProjectInstructions(sources: LoadedInstructionSource[]): string {
  if (sources.length === 0) {
    return "";
  }

  const sections = sources.map((source) => {
    const rootScope = source.scope === "home" ? "" : ` applies-to-root=${JSON.stringify(source.path.split("/").slice(0, 2).join("/"))}`;
    return `<project-instructions source=${JSON.stringify(source.path)}${rootScope}>
${source.content.replace(/<\/project-instructions>/gi, "&lt;/project-instructions&gt;")}
</project-instructions>`;
  });

  return `${PROJECT_INSTRUCTIONS_HEADER}
The following AGENTS.md instructions are ordered from lowest to highest precedence. When they conflict within the same root, follow the later, higher-precedence source. A block with applies-to-root affects only files under that logical workspace root.

${sections.join("\n\n")}`;
}

function isFileNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }

  const code = "code" in err ? String((err as { code?: unknown }).code) : "";
  const message = err instanceof Error ? err.message : "";
  return code === "FileNotFound" || code === "ENOENT" || message.includes("Unable to read file");
}
