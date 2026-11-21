import * as path from "path";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  DeleteWorkspacePathOptions,
  MoveWorkspacePathOptions,
  RealPathResolver,
  ResolvedWorkspacePath,
  ResolveWorkspacePathOptions,
  ToolWorkspaceFindOptions,
  ToolWorkspaceHost,
} from "@/application/ports";
export type {
  DeleteWorkspacePathOptions,
  MoveWorkspacePathOptions,
  RealPathResolver,
  ResolvedWorkspacePath,
  ResolveWorkspacePathOptions,
  ToolHostDocumentSymbol,
  ToolWorkspaceEntryType,
  ToolWorkspaceFilePreview,
  ToolWorkspaceFindOptions,
  ToolWorkspaceHost,
  ToolWorkspaceStat,
} from "@/application/ports";

let workspaceHost: ToolWorkspaceHost | undefined;
const scopedWorkspaceHost = new AsyncLocalStorage<ToolWorkspaceHost>();

export function setToolWorkspaceHost(host: ToolWorkspaceHost): void {
  workspaceHost = createValidatingWorkspaceHost(host);
}

export function getToolWorkspaceHost(): ToolWorkspaceHost {
  const scoped = scopedWorkspaceHost.getStore();
  if (scoped) {
    return scoped;
  }
  if (!workspaceHost) {
    throw new Error("Tool workspace host has not been configured");
  }
  return workspaceHost;
}

export function runWithToolWorkspaceHost<T>(host: ToolWorkspaceHost, operation: () => Promise<T>): Promise<T> {
  return scopedWorkspaceHost.run(createValidatingWorkspaceHost(host), operation);
}

export function resolveWorkspacePath(rawPath: string, workspaceRoot: string, options: ResolveWorkspacePathOptions = {}): ResolvedWorkspacePath {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new Error("Workspace path is required");
  }
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
    throw new Error("Workspace root is required");
  }
  if (rawPath.includes("\0")) {
    throw new Error("Workspace path contains an invalid null byte");
  }
  if (looksLikeUri(rawPath)) {
    throw new Error("Workspace path must be a filesystem path, not a URI");
  }

  const normalizedInput = rawPath.replace(/\\/g, "/");
  const inputSegments = normalizedInput.split("/").filter(Boolean);
  if (inputSegments.includes("..")) {
    throw new Error("Workspace path cannot contain '..' traversal");
  }

  const root = path.resolve(workspaceRoot);
  const absoluteInput = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(root, rawPath);
  const relativePath = path.relative(root, absoluteInput);

  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("Workspace path must stay inside the workspace");
  }

  const normalizedRelativePath = relativePath === "" ? "." : relativePath.replace(/\\/g, "/");
  if (!options.allowSensitive && isSensitiveWorkspacePath(normalizedRelativePath)) {
    throw new Error("Workspace path points to a sensitive file");
  }

  return {
    absolutePath: absoluteInput,
    relativePath: normalizedRelativePath,
  };
}

export async function resolveWorkspacePathSecure(
  rawPath: string,
  workspaceRoot: string,
  resolveRealPath: RealPathResolver,
  options: ResolveWorkspacePathOptions = {},
): Promise<ResolvedWorkspacePath> {
  const lexical = resolveWorkspacePath(rawPath, workspaceRoot, options);
  const realRoot = path.resolve(await resolveRealPath(path.resolve(workspaceRoot)));
  const realTarget = await resolveTargetThroughExistingAncestor(lexical.absolutePath, resolveRealPath);
  assertPathInsideRoot(realTarget, realRoot);
  return {
    absolutePath: realTarget,
    relativePath: lexical.relativePath,
  };
}

function createValidatingWorkspaceHost(host: ToolWorkspaceHost): ToolWorkspaceHost {
  async function validate(rawPath: string, allowSensitive = false): Promise<string> {
    if (host.resolvePath) {
      return host.resolvePath(rawPath, allowSensitive);
    }
    const rootPath = host.getRootPath();
    if (!rootPath) {
      throw new Error("No workspace folder open");
    }
    const resolved = host.realPath
      ? await resolveWorkspacePathSecure(rawPath, rootPath, host.realPath, { allowSensitive })
      : resolveWorkspacePath(rawPath, rootPath, { allowSensitive });
    return resolved.relativePath;
  }

  return {
    getRootPath: host.getRootPath.bind(host),
    getWorkspaceId: host.getWorkspaceId?.bind(host),
    isPathInsideWorkspace: host.isPathInsideWorkspace?.bind(host),
    resolvePath: host.resolvePath?.bind(host),
    resolveLocalPath: host.resolveLocalPath?.bind(host),
    getCommandShell: host.getCommandShell?.bind(host),
    executeCommand: host.executeCommand?.bind(host),
    realPath: host.realPath?.bind(host),
    findFiles: host.findFiles
      ? async (options: ToolWorkspaceFindOptions) => {
          const paths = await host.findFiles!(options);
          const accepted = new Set<string>();
          for (const rawPath of paths) {
            if (host.resolvePath) {
              try {
                accepted.add(await host.resolvePath(rawPath, false));
              } catch {
              }
            } else {
              const rootPath = host.getRootPath();
              if (!rootPath) {
                throw new Error("No workspace folder open");
              }
              const resolved = resolveWorkspacePath(rawPath, rootPath, { allowSensitive: true });
              if (!isSensitiveWorkspacePath(resolved.relativePath)) {
                accepted.add(resolved.relativePath);
              }
            }
          }
          return [...accepted];
        }
      : undefined,
    readFile: async (rawPath: string) => host.readFile(await validate(rawPath)),
    readFilePreview: host.readFilePreview
      ? async (rawPath: string, maxBytes: number) => host.readFilePreview!(await validate(rawPath), maxBytes)
      : undefined,
    writeFile: async (rawPath: string, content: Uint8Array) => host.writeFile(await validate(rawPath, true), content),
    movePath: host.movePath
      ? async (source: string, options: MoveWorkspacePathOptions) => host.movePath!(
          await validate(source, true),
          { ...options, destination: await validate(options.destination, true) },
        )
      : undefined,
    deletePath: host.deletePath
      ? async (rawPath: string, options: DeleteWorkspacePathOptions) => host.deletePath!(await validate(rawPath, true), options)
      : undefined,
    stat: async (rawPath: string) => host.stat(await validate(rawPath)),
    createParentDirectory: async (rawPath: string) => host.createParentDirectory(await validate(rawPath, true)),
    readDirectory: async (rawPath: string) => host.readDirectory(await validate(rawPath)),
    readDocumentSymbols: host.readDocumentSymbols
      ? async (rawPath: string) => host.readDocumentSymbols!(await validate(rawPath))
      : undefined,
    prepareFileDiff: host.prepareFileDiff
      ? async (rawPath: string, before: string, after: string) => host.prepareFileDiff!(await validate(rawPath), before, after)
      : undefined,
    clearFileDiffPreview: host.clearFileDiffPreview ? () => host.clearFileDiffPreview!() : undefined,
  };
}

async function resolveTargetThroughExistingAncestor(absolutePath: string, resolveRealPath: RealPathResolver): Promise<string> {
  let candidate = path.resolve(absolutePath);
  const missingSegments: string[] = [];

  while (true) {
    try {
      const realAncestor = path.resolve(await resolveRealPath(candidate));
      return path.resolve(realAncestor, ...missingSegments);
    } catch (err: unknown) {
      if (!isMissingPathError(err)) {
        throw err;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        throw err;
      }
      missingSegments.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

function assertPathInsideRoot(absolutePath: string, rootPath: string): void {
  const relativePath = path.relative(rootPath, absolutePath);
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("Workspace path resolves outside the workspace through a symbolic link or junction");
  }
}

function isMissingPathError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && ((err as { code?: unknown }).code === "ENOENT" || (err as { code?: unknown }).code === "ENOTDIR");
}

function looksLikeUri(rawPath: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawPath) && !/^[a-zA-Z]:[\\/]/.test(rawPath);
}

export function isSensitiveWorkspacePath(relativePath: string): boolean {
  return relativePath
    .split("/")
    .filter(Boolean)
    .some((segment) => {
      const lower = segment.toLowerCase();
      return (
        /^\.env(?:\..*)?$/.test(lower) ||
        /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(lower) ||
        /\.(?:pem|key|p12|pfx|crt|cer|der)$/.test(lower) ||
        /(?:^|[._-])(?:token|tokens|secret|secrets|credential|credentials)(?:[._-]|$)/.test(lower)
      );
    });
}
