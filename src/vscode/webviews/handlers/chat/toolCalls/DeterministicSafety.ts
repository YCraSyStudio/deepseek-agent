import { createHash } from "node:crypto";
import * as path from "node:path";
import type { ToolCall } from "@/contracts";
import type { ConfirmationRequiredResult } from "@/application/tools/Types";
import { getToolWorkspaceHost, isSensitiveWorkspacePath } from "@/infrastructure/tools/ToolWorkspace";
import {
  normalizeCommandForDecision,
  parseCommandFacts,
  type ScriptInvocation,
} from "@/infrastructure/tools/safety/CommandFacts";
import { analyzeScriptEffects, type ScriptEffectProfile } from "@/infrastructure/tools/safety/ScriptEffects";
import {
  approveGitRecoverablePathChange,
  approveReadOnlyDiagnostic,
  approveVerifiedWorkspaceScript,
  approveWorkspaceFileMutation,
  type SafetyVerdict,
  type ScriptProvenance,
} from "@/infrastructure/tools/safety/DeterministicApproval";
import { probeGitRecovery } from "@/infrastructure/tools/safety/GitRecovery";
import {
  createDecisionKey,
  isCacheableScope,
  type DecisionScope,
} from "@/infrastructure/tools/safety/DecisionCache";
import { fileChangeRegistry } from "@/vscode/editor/diff/FileChangeRegistry";

const FILE_MUTATION_TOOLS = new Set(["create_file", "edit_file", "apply_patch"]);
const GIT_RECOVERABLE_TOOLS = new Set(["move_path", "delete_path"]);
const MAX_SCRIPT_CHARACTERS = 64 * 1024;

export interface DeterministicSafetyInput {
  toolCall: ToolCall;
  confirmation: ConfirmationRequiredResult;
  effect?: string;
  scope: DecisionScope;
}

export interface DeterministicSafetyResult {
  verdict: SafetyVerdict;
  key?: string;
}

export async function evaluateDeterministicSafety(
  input: DeterministicSafetyInput,
): Promise<DeterministicSafetyResult> {
  try {
    return await evaluate(input);
  } catch {
    return { verdict: { kind: "review", code: "facts-unavailable", facts: {} } };
  }
}

export function currentWorkspaceId(): string | undefined {
  try {
    return getToolWorkspaceHost().getWorkspaceId?.();
  } catch {
    return undefined;
  }
}

async function evaluatePathRecovery(
  input: DeterministicSafetyInput,
  toolName: string,
): Promise<DeterministicSafetyResult> {
  const filePath = input.confirmation.filePath;
  if (!filePath) {
    return { verdict: { kind: "review", code: "path-unknown", facts: { toolName } } };
  }

  const report = await probeGitRecovery(filePath, { workspaceRoot: input.confirmation.workspaceRoot });
  return {
    verdict: approveGitRecoverablePathChange({
      toolName,
      effect: input.effect,
      filePath,
      sensitivePath: isSensitiveWorkspacePath(normalizePathSubject(filePath)),
      insideRepository: report.insideRepository,
      recoverable: report.recoverable,
      reason: report.reason,
    }),
  };
}

function fileMutationDecisionKey(
  scope: DecisionScope,
  toolName: string,
  filePath: string,
  beforeHash?: string,
): string | undefined {
  return isCacheableScope(scope)
    ? createDecisionKey({ ...scope, toolName, subject: normalizePathSubject(filePath), contentHash: beforeHash })
    : undefined;
}

async function evaluate(input: DeterministicSafetyInput): Promise<DeterministicSafetyResult> {
  const toolName = input.toolCall.function.name;

  if (input.effect === "workspace-mutation" && GIT_RECOVERABLE_TOOLS.has(toolName)) {
    return evaluatePathRecovery(input, toolName);
  }

  if (input.effect === "workspace-mutation" && FILE_MUTATION_TOOLS.has(toolName)) {
    const filePath = input.confirmation.filePath;
    const verdict = approveWorkspaceFileMutation({
      toolName,
      effect: input.effect,
      workspaceContained: input.confirmation.workspaceContained,
      reasonCode: input.confirmation.reasonCode,
      filePath,
      sensitivePath: filePath ? isSensitiveWorkspacePath(normalizePathSubject(filePath)) : false,
    });
    return {
      verdict,
      key: filePath ? fileMutationDecisionKey(input.scope, toolName, filePath, input.confirmation.beforeHash) : undefined,
    };
  }

  if (toolName !== "run_terminal_command") {
    return { verdict: { kind: "review", code: "not-deterministically-classified", facts: { toolName } } };
  }

  const command = input.confirmation.command ?? readCommandArgument(input.toolCall);
  if (!command) {
    return { verdict: { kind: "review", code: "command-unknown", facts: {} } };
  }

  const facts = parseCommandFacts(command);
  const diagnostic = approveReadOnlyDiagnostic(facts);
  if (diagnostic.kind === "approve") {
    return { verdict: diagnostic };
  }

  if (facts.classification === "script-execution" && facts.script) {
    const script = await collectScriptFacts(facts.script, input.confirmation.cwd);
    const verdict = approveVerifiedWorkspaceScript({
      facts,
      contained: script.contained,
      provenance: script.provenance,
      profile: script.profile,
      hash: script.hash,
    });
    const key = isCacheableScope(input.scope) && script.hash
      ? createDecisionKey({
          ...input.scope,
          toolName,
          subject: normalizeCommandForDecision(command),
          contentHash: script.hash,
          effectProfile: describeProfile(script.profile),
        })
      : undefined;
    return { verdict, key };
  }

  return {
    verdict: { kind: "review", code: `command-${facts.classification}`, facts: { programs: facts.programs } },
    key: isCacheableScope(input.scope)
      ? createDecisionKey({ ...input.scope, toolName, subject: normalizeCommandForDecision(command) })
      : undefined,
  };
}

interface ScriptFacts {
  contained: boolean;
  provenance: ScriptProvenance;
  profile: ScriptEffectProfile;
  hash?: string;
}

async function collectScriptFacts(script: ScriptInvocation, cwd: string | undefined): Promise<ScriptFacts> {
  const unknown: ScriptFacts = {
    contained: false,
    provenance: "unknown",
    profile: { bounded: false, capabilities: [], blockedBy: ["script-unreadable"] },
  };
  let host;
  try {
    host = getToolWorkspaceHost();
  } catch {
    return unknown;
  }
  const workspaceRoot = host.getRootPath?.();
  if (!workspaceRoot) {
    return unknown;
  }

  const absoluteScript = resolveScriptPath(script.path, cwd, workspaceRoot);
  const relativeScript = absoluteScript ? toWorkspaceRelativePath(absoluteScript, workspaceRoot) : undefined;
  if (!absoluteScript || !relativeScript) {
    return unknown;
  }
  if (!await host.isPathInsideWorkspace?.(absoluteScript)) {
    return { ...unknown, contained: false };
  }

  let content: Uint8Array;
  try {
    content = await host.readFile(relativeScript);
  } catch {
    return { ...unknown, contained: true };
  }
  const text = decodeText(content);
  if (text === undefined) {
    return { ...unknown, contained: true };
  }

  const hash = createHash("sha256").update(content).digest("hex");
  return {
    contained: true,
    provenance: fileChangeRegistry.find(relativeScript, undefined, hash) ? "agent-authored" : "changed",
    profile: analyzeScriptEffects(text.slice(0, MAX_SCRIPT_CHARACTERS), script.language, { workspaceRoot }),
    hash,
  };
}

function resolveScriptPath(operand: string, cwd: string | undefined, workspaceRoot: string): string | undefined {
  const absolute = path.isAbsolute(operand) || path.win32.isAbsolute(operand)
    ? path.resolve(operand)
    : path.resolve(cwd ?? workspaceRoot, operand);
  return absolute || undefined;
}

function toWorkspaceRelativePath(absolutePath: string, workspaceRoot: string): string | undefined {
  const relative = path.relative(path.resolve(workspaceRoot), absolutePath);
  if (!relative || relative === "." || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.replace(/\\/g, "/");
}

function decodeText(content: Uint8Array): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    return text.includes("\0") ? undefined : text;
  } catch {
    return undefined;
  }
}

function describeProfile(profile: ScriptEffectProfile): string {
  return [...profile.capabilities].sort().join(",");
}

function normalizePathSubject(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readCommandArgument(toolCall: ToolCall): string | undefined {
  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    return typeof args.command === "string" && args.command.trim() ? args.command : undefined;
  } catch {
    return undefined;
  }
}
