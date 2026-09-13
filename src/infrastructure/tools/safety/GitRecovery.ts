import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 4_000;
const GIT_MAX_OUTPUT_BYTES = 512 * 1024;

type GitRecoveryReason =
  | "recoverable"
  | "not-a-repository"
  | "untracked-path"
  | "ignored-path"
  | "uncommitted-changes"
  | "git-unavailable";

export interface GitRecoveryReport {
  insideRepository: boolean;
  recoverable: boolean;
  reason: GitRecoveryReason;
}

export interface GitRecoveryOptions {
  workspaceRoot?: string;
  signal?: AbortSignal;
}

interface GitInvocation {
  exitCode: number;
  stdout: string;
  unavailable: boolean;
}

interface RepositoryLocation {
  root: string;
  relativePath: string;
}

export async function probeGitRecovery(target: string, options: GitRecoveryOptions = {}): Promise<GitRecoveryReport> {
  const absolutePath = resolveTargetPath(target, options.workspaceRoot);
  if (!absolutePath) {
    return { insideRepository: false, recoverable: false, reason: "untracked-path" };
  }

  const location = await locateRepository(absolutePath, options.signal);
  if (typeof location === "string") {
    return { insideRepository: false, recoverable: false, reason: location };
  }

  const ignored = await runGit(location.root, ["check-ignore", "-q", "--", location.relativePath], options.signal);
  if (ignored.unavailable) {
    return { insideRepository: true, recoverable: false, reason: "git-unavailable" };
  }
  if (ignored.exitCode === 0) {
    return { insideRepository: true, recoverable: false, reason: "ignored-path" };
  }

  const tracked = await runGit(location.root, ["ls-files", "--error-unmatch", "--", location.relativePath], options.signal);
  if (tracked.unavailable) {
    return { insideRepository: true, recoverable: false, reason: "git-unavailable" };
  }
  if (tracked.exitCode !== 0) {
    return { insideRepository: true, recoverable: false, reason: "untracked-path" };
  }

  const status = await runGit(location.root, ["status", "--porcelain", "--", location.relativePath], options.signal);
  if (status.unavailable || status.exitCode !== 0) {
    return { insideRepository: true, recoverable: false, reason: "git-unavailable" };
  }
  if (status.stdout.trim() !== "") {
    return { insideRepository: true, recoverable: false, reason: "uncommitted-changes" };
  }

  return { insideRepository: true, recoverable: true, reason: "recoverable" };
}

async function locateRepository(absolutePath: string, signal?: AbortSignal): Promise<RepositoryLocation | GitRecoveryReason> {
  const cwd = path.dirname(absolutePath);
  const workTree = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], signal);
  if (workTree.unavailable) {
    return "git-unavailable";
  }
  if (workTree.exitCode !== 0 || workTree.stdout.trim() !== "true") {
    return "not-a-repository";
  }

  const topLevel = await runGit(cwd, ["rev-parse", "--show-toplevel"], signal);
  if (topLevel.unavailable) {
    return "git-unavailable";
  }
  if (topLevel.exitCode !== 0 || topLevel.stdout.trim() === "") {
    return "not-a-repository";
  }

  const root = path.resolve(topLevel.stdout.trim());
  const relative = path.relative(root, absolutePath).replace(/\\/g, "/");
  if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
    return "not-a-repository";
  }
  return { root, relativePath: relative === "" ? "." : relative };
}

function resolveTargetPath(target: string, workspaceRoot: string | undefined): string | undefined {
  if (typeof target !== "string" || target.trim() === "" || target.includes("\0") || target.includes("\n")) {
    return undefined;
  }
  if (path.isAbsolute(target) || path.win32.isAbsolute(target)) {
    return path.resolve(target);
  }
  if (!workspaceRoot) {
    return undefined;
  }
  return path.resolve(workspaceRoot, target);
}

async function runGit(cwd: string, args: string[], signal?: AbortSignal): Promise<GitInvocation> {
  if (signal?.aborted) {
    return { exitCode: 1, stdout: "", unavailable: true };
  }

  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_OUTPUT_BYTES,
      signal,
      windowsHide: true,
    });
    return { exitCode: 0, stdout, unavailable: false };
  } catch (err: unknown) {
    const record = err && typeof err === "object"
      ? err as { code?: unknown; stdout?: unknown; killed?: unknown }
      : {};
    if (record.code === "ENOENT" || record.killed === true) {
      return { exitCode: 1, stdout: "", unavailable: true };
    }
    return {
      exitCode: typeof record.code === "number" ? record.code : 1,
      stdout: typeof record.stdout === "string" ? record.stdout : "",
      unavailable: false,
    };
  }
}
