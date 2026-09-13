import type { CommandFacts } from "./CommandFacts";
import type { ScriptEffectProfile } from "./ScriptEffects";


type ApprovalCode =
  | "workspace-file-mutation"
  | "git-recoverable-path-change"
  | "read-only-diagnostic"
  | "verified-workspace-script"
  | "cached-positive-decision";

interface ApprovalVerdict {
  kind: "approve";
  code: ApprovalCode;
  facts: Record<string, unknown>;
}

interface ReviewVerdict {
  kind: "review";
  code: string;
  facts: Record<string, unknown>;
}

export type SafetyVerdict = ApprovalVerdict | ReviewVerdict;

const FILE_MUTATION_TOOLS = new Set(["create_file", "edit_file", "apply_patch"]);

export interface FileMutationFacts {
  toolName: string;
  effect?: string;
  workspaceContained?: boolean;
  reasonCode?: string;
  filePath?: string;
  sensitivePath: boolean;
}

export function approveWorkspaceFileMutation(facts: FileMutationFacts): SafetyVerdict {
  const evidence: Record<string, unknown> = {
    toolName: facts.toolName,
    effect: facts.effect,
    workspaceContained: facts.workspaceContained,
    reasonCode: facts.reasonCode,
    filePath: facts.filePath,
    sensitivePath: facts.sensitivePath,
  };
  if (!FILE_MUTATION_TOOLS.has(facts.toolName)) {
    return review("not-a-file-mutation", evidence);
  }
  if (facts.effect !== "workspace-mutation") {
    return review("unexpected-effect", evidence);
  }
  if (facts.reasonCode === "outside-workspace") {
    return review("outside-workspace", evidence);
  }
  if (facts.workspaceContained !== true) {
    return review("containment-unknown", evidence);
  }
  if (!facts.filePath) {
    return review("path-unknown", evidence);
  }
  if (facts.sensitivePath) {
    return review("sensitive-path", evidence);
  }
  return {
    kind: "approve",
    code: "workspace-file-mutation",
    facts: { toolName: facts.toolName, filePath: facts.filePath },
  };
}

export function approveReadOnlyDiagnostic(facts: CommandFacts): SafetyVerdict {
  if (facts.classification !== "read-only-diagnostic") {
    return review("not-a-read-only-diagnostic", { classification: facts.classification });
  }
  if (facts.escalatesPrivileges) {
    return review("privilege-escalation", { programs: facts.programs });
  }
  if (facts.changesExecutionPolicy) {
    return review("execution-policy-change", { segments: facts.segments });
  }
  return {
    kind: "approve",
    code: "read-only-diagnostic",
    facts: { programs: facts.programs, segments: facts.segments },
  };
}

export type ScriptProvenance = "agent-authored" | "changed" | "unknown";

export interface ScriptExecutionFacts {
  facts: CommandFacts;
  contained: boolean;
  provenance: ScriptProvenance;
  profile: ScriptEffectProfile;
  hash?: string;
}

export function approveVerifiedWorkspaceScript(input: ScriptExecutionFacts): SafetyVerdict {
  const facts: Record<string, unknown> = {
    script: input.facts.script?.path,
    language: input.facts.script?.language,
    hash: input.hash,
    capabilities: input.profile.capabilities,
    blockedBy: input.profile.blockedBy,
  };
  if (input.facts.classification !== "script-execution" || !input.facts.script) {
    return review("not-a-script-execution", facts);
  }
  if (input.facts.escalatesPrivileges) {
    return review("privilege-escalation", facts);
  }
  if (input.facts.changesExecutionPolicy) {
    return review("execution-policy-change", facts);
  }
  if (!input.contained) {
    return review("outside-workspace", facts);
  }
  if (input.provenance !== "agent-authored") {
    return review(`provenance-${input.provenance}`, facts);
  }
  if (!input.profile.bounded) {
    return review("unbounded-effects", facts);
  }
  return { kind: "approve", code: "verified-workspace-script", facts };
}

function review(code: string, facts: Record<string, unknown>): ReviewVerdict {
  return { kind: "review", code, facts };
}

const GIT_RECOVERABLE_TOOLS = new Set(["move_path", "delete_path"]);

export interface GitRecoverablePathFacts {
  toolName: string;
  effect?: string;
  filePath?: string;
  sensitivePath: boolean;
  insideRepository: boolean;
  recoverable: boolean;
  reason: string;
}

export function approveGitRecoverablePathChange(facts: GitRecoverablePathFacts): SafetyVerdict {
  const evidence: Record<string, unknown> = {
    toolName: facts.toolName,
    effect: facts.effect,
    filePath: facts.filePath,
    sensitivePath: facts.sensitivePath,
    insideRepository: facts.insideRepository,
    recoverable: facts.recoverable,
    gitReason: facts.reason,
  };
  if (!GIT_RECOVERABLE_TOOLS.has(facts.toolName)) {
    return review("not-a-path-change-tool", evidence);
  }
  if (facts.effect !== "workspace-mutation") {
    return review("unexpected-effect", evidence);
  }
  if (!facts.filePath) {
    return review("path-unknown", evidence);
  }
  if (facts.sensitivePath) {
    return review("sensitive-path", evidence);
  }
  if (!facts.insideRepository || !facts.recoverable) {
    return review(`git-${facts.reason}`, evidence);
  }
  return { kind: "approve", code: "git-recoverable-path-change", facts: evidence };
}
