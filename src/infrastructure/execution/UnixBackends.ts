import { physicalFileSystem } from "./PhysicalFileSystem";
import * as path from "node:path";
import { isWithin, type ExecutionPolicy } from "./ExecutionPolicy";
import type { CommandLaunch } from "@/infrastructure/tools/builtins/terminal/ProcessExecution";

export function createSeatbeltProfile(policy: ExecutionPolicy): string {
  const literal = (value: string) => JSON.stringify(value);
  const reads = [...policy.readRoots, policy.workspaceRoot, policy.temporaryRoot];
  return [
    "(version 1)", "(deny default)",
    "(allow process-fork process-exec)", "(allow signal (target self))",
    "(allow sysctl-read)",
    // Metadata is needed to traverse ancestors; it does not grant file contents.
    "(allow file-read-metadata)",
    ...reads.map((entry) => `(allow file-read* (subpath ${literal(entry)}))`),
    ...[policy.workspaceRoot, policy.temporaryRoot].map((entry) => `(allow file-write* (subpath ${literal(entry)}))`),
    "(allow file-read* file-write* (literal \"/dev/null\") (literal \"/dev/zero\") (literal \"/dev/random\") (literal \"/dev/urandom\"))",
    "(allow mach-lookup (global-name \"com.apple.system.logger\"))",
    // Explicit deny overrides broad workspace grants.
    ...policy.protectedPaths.map((entry) => `(deny file-read* file-write* (subpath ${literal(entry)}))`),
    "(deny network*)",
  ].join("\n");
}

export async function createUnixLaunch(command: string, policy: ExecutionPolicy): Promise<{ launch: CommandLaunch; close(): Promise<void> }> {
  const { lstat, open, writeFile, realpath, stat } = physicalFileSystem();
  if (process.platform === "darwin") {
    return {
      launch: { executable: "/usr/bin/sandbox-exec", args: ["-p", createSeatbeltProfile(policy), "/bin/sh", "-c", 'printf ready >&4 || exit 125; exec 4>&-; exec /bin/sh -c "$1"', "sandbox", command], options: { env: policy.environment, stdio: ["ignore", "pipe", "pipe", "ignore", "pipe"] }, readinessFd: 4 },
      close: async () => {},
    };
  }
  if (process.platform !== "linux") {throw new Error("sandbox_unavailable: unsupported Unix platform");}
  const args = ["--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL"];
  for (const entry of policy.readRoots) {args.push("--ro-bind", entry, entry);}
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    "--bind", policy.workspaceRoot, policy.workspaceRoot,
    "--bind", policy.temporaryRoot, policy.temporaryRoot);
  const empty = path.join(policy.temporaryRoot, "empty");
  await writeFile(empty, "", { mode: 0o600 });
  for (const entry of policy.protectedPaths) {
    let target = entry;
    let metadata = await lstat(entry);
    if (metadata.isSymbolicLink()) {
      try {target = await realpath(entry); metadata = await stat(target);}
      catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") {continue;} throw error;}
      // Targets outside every mount are already inaccessible. Mask canonical targets
      // inside a grant, so changing the symlink cannot expose them via another alias.
      if (![policy.workspaceRoot, ...policy.readRoots].some((root) => isWithin(target, root))) {continue;}
    }
    if (metadata.isDirectory()) {args.push("--tmpfs", target, "--remount-ro", target);}
    else {args.push("--ro-bind", empty, target);}
  }
  const passwd = path.join(policy.temporaryRoot, "passwd");
  const group = path.join(policy.temporaryRoot, "group");
  await writeFile(passwd, `sandbox:x:${process.getuid!()}:${process.getgid!()}:Sandbox:${policy.environment.HOME}:/bin/sh\n`);
  await writeFile(group, `sandbox:x:${process.getgid!()}:\n`);
  args.push("--ro-bind", passwd, "/etc/passwd", "--ro-bind", group, "/etc/group", "--clearenv");
  for (const [key, value] of Object.entries(policy.environment)) {args.push("--setenv", key, value);}
  const filterPath = path.join(policy.temporaryRoot, "seccomp");
  await writeFile(filterPath, createSeccompFilter(process.arch), { mode: 0o600 });
  const filter = await open(filterPath, "r");
  args.push("--seccomp", "3", "--chdir", policy.cwd, "/bin/sh", "-c", 'printf ready >&4 || exit 125; exec 4>&-; exec /bin/sh -c "$1"', "sandbox", command);
  return {
    launch: { executable: "bwrap", args, options: { env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe", filter.fd, "pipe"] }, readinessFd: 4 },
    close: () => filter.close(),
  };
}

// Classic BPF: validate the syscall ABI before denying dangerous kernel interfaces.
// Network namespaces block IP connectivity; denying socket also closes Unix-socket access.
export function createSeccompFilter(architecture: string): Buffer {
  const audit = architecture === "x64" ? 0xc000003e : architecture === "arm64" ? 0xc00000b7 : undefined;
  if (audit === undefined) {throw new Error(`sandbox_unavailable: seccomp is not implemented for ${architecture}`);}
  const denied = architecture === "x64"
    ? [41, 101, 155, 165, 166, 169, 175, 176, 246, 248, 249, 250, 272, 298, 304, 308, 313, 321, 323, 425, 426, 427, 428, 429, 430, 431, 432, 433, 438]
    : [40, 39, 97, 104, 105, 106, 117, 142, 198, 217, 218, 219, 224, 225, 241, 268, 273, 280, 282, 294, 425, 426, 427, 428, 429, 430, 431, 432, 433, 438];
  const instructions: number[][] = [[0x20, 0, 0, 4], [0x15, 1, 0, audit], [0x06, 0, 0, 0x80000000], [0x20, 0, 0, 0]];
  if (architecture === "x64") {instructions.push([0x45, 0, 1, 0x40000000], [0x06, 0, 0, 0x80000000]);}
  for (const syscall of denied) {instructions.push([0x15, 0, 1, syscall], [0x06, 0, 0, 0x00050001]);}
  instructions.push([0x06, 0, 0, 0x7fff0000]);
  const buffer = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, yes, no, value], index) => {
    buffer.writeUInt16LE(code, index * 8); buffer[index * 8 + 2] = yes; buffer[index * 8 + 3] = no;
    buffer.writeUInt32LE(value, index * 8 + 4);
  });
  return buffer;
}
