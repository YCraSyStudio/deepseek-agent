import * as path from "node:path";
import { physicalFileSystem } from "./PhysicalFileSystem";
import { isSensitiveWorkspacePath } from "@/infrastructure/tools/ToolWorkspace";

export interface ExecutionPolicy {
  workspaceRoot: string;
  cwd: string;
  temporaryRoot: string;
  readRoots: string[];
  protectedPaths: string[];
  environment: Record<string, string>;
}

export function isWithin(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export async function createExecutionPolicy(
  workspaceRoot: string, cwd: string, temporaryRoot: string, additionalReadRoots: readonly string[] = [], signal?: AbortSignal,
): Promise<ExecutionPolicy> {
  const { realpath } = physicalFileSystem();
  const root = await realpath(workspaceRoot);
  const workingDirectory = await realpath(cwd);
  if (!isWithin(workingDirectory, root)) {
    throw new Error("sandbox_policy: command cwd must be inside its workspace. An outside-workspace approval does not disable command isolation.");
  }
  const defaults = process.platform === "win32"
    ? [process.env.SystemRoot ?? "C:\\Windows", process.env.ProgramFiles ?? "C:\\Program Files", process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"]
    : process.platform === "darwin"
      ? ["/usr", "/bin", "/sbin", "/System/Library", "/Library/Developer", "/Applications/Xcode.app/Contents/Developer", "/opt/homebrew"]
      : ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/opt", "/etc/ld.so.cache", "/etc/alternatives"];
  const readRoots: string[] = [];
  const canonicalReadRoots: string[] = [];
  for (const entry of [...defaults, ...additionalReadRoots]) {
    if (!path.isAbsolute(entry)) {throw new Error("sandbox_policy: toolchain read roots must be absolute paths");}
    try {
      const canonical = await realpath(entry);
      if (canonical === path.parse(canonical).root || isWithin(root, canonical)) {
        throw new Error("sandbox_policy: a toolchain root must not expose the filesystem root or an ancestor of the workspace");
      }
      readRoots.push(entry);
      canonicalReadRoots.push(canonical);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {throw error;}
    }
  }
  const protectedPaths = await discoverProtectedPaths(root, signal);
  if (protectedPaths.some((entry) => isWithin(workingDirectory, entry))) {
    throw new Error("sandbox_policy: cwd points to a protected path");
  }
  // Keep only PATH entries covered by declared toolchain grants. This restores
  // installed Windows tools without exposing the entire user profile or dotfiles.
  const allowedSearchPaths: string[] = [];
  const candidates = [
    ...(process.platform === "win32"
      ? [path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"), process.env.SystemRoot ?? "C:\\Windows"]
      : ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin"]),
    ...(process.env.PATH ?? process.env.Path ?? "").split(path.delimiter),
    ...additionalReadRoots.flatMap((entry) => [entry, path.join(entry, "bin")]),
  ];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {continue;}
    try {
      const canonical = await realpath(candidate);
      if (canonicalReadRoots.some((allowed) => isWithin(canonical, allowed))) {allowedSearchPaths.push(candidate);}
    } catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") {throw error;}}
  }
  const searchPath = [...new Set(allowedSearchPaths)].join(path.delimiter);
  const environment: Record<string, string> = {
    PATH: searchPath, HOME: path.join(temporaryRoot, "home"), TMPDIR: temporaryRoot,
    TMP: temporaryRoot, TEMP: temporaryRoot, LANG: "C.UTF-8",
    npm_config_cache: path.join(temporaryRoot, "npm"),
    DOTNET_CLI_HOME: path.join(temporaryRoot, "dotnet"),
    DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    DOTNET_GENERATE_ASPNET_CERTIFICATE: "false", DOTNET_CLI_USE_MSBUILD_SERVER: "0",
    MSBUILDDISABLENODEREUSE: "1", UseSharedCompilation: "false",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  };
  if (process.platform === "win32") {
    environment.SystemRoot = process.env.SystemRoot ?? "C:\\Windows";
    environment.USERPROFILE = environment.HOME;
    environment.LOCALAPPDATA = path.join(temporaryRoot, "local");
    environment.APPDATA = path.join(temporaryRoot, "roaming");
    environment.ComSpec = path.join(environment.SystemRoot, "System32", "cmd.exe");
  }
  return { workspaceRoot: root, cwd: workingDirectory, temporaryRoot, readRoots: [...new Set(readRoots)], protectedPaths, environment };
}

async function discoverProtectedPaths(root: string, signal?: AbortSignal): Promise<string[]> {
  const { lstat, readdir } = physicalFileSystem();
  const protectedPaths: string[] = [];
  const protectedDirectories: string[] = [];
  const hardlinks = new Map<string, string[]>();
  const sensitiveInodes = new Set<string>();
  const pending = [{ directory: root, protectedAncestor: false }];
  let inspected = 0;
  while (pending.length > 0) {
    signal?.throwIfAborted();
    const { directory, protectedAncestor } = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++inspected > 250_000) {throw new Error("sandbox_policy: workspace scan exceeds 250000 entries; refusing an incomplete protection policy");}
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
      const sensitive = protectedAncestor || isSensitiveWorkspacePath(relative)
        || [".agents", ".codex", ".aws", ".ssh", ".gnupg"].includes(entry.name.toLowerCase());
      if (sensitive && !protectedAncestor) {protectedPaths.push(absolute);}
      // Never follow symlinks/junctions during discovery. Also track hardlink
      // aliases so an existing innocently named alias cannot expose a secret.
      const metadata = await lstat(absolute);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
        if (sensitive && !protectedAncestor) {protectedDirectories.push(absolute);}
        pending.push({ directory: absolute, protectedAncestor: sensitive });
      } else if (metadata.isFile() && metadata.nlink > 1) {
        const inode = `${metadata.dev}:${metadata.ino}`;
        hardlinks.set(inode, [...hardlinks.get(inode) ?? [], absolute]);
        if (sensitive) {sensitiveInodes.add(inode);}
      }
    }
  }
  for (const inode of sensitiveInodes) {
    for (const alias of hardlinks.get(inode) ?? []) {
      if (!protectedDirectories.some((directory) => isWithin(alias, directory))) {protectedPaths.push(alias);}
    }
  }
  return [...new Set(protectedPaths)];
}
