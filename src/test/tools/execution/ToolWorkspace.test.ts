import * as assert from "assert";
import * as path from "path";
import { mkdtemp, mkdir, realpath, rm, symlink } from "fs/promises";
import { tmpdir } from "os";
import {
  getToolWorkspaceHost,
  resolveWorkspacePath,
  resolveWorkspacePathSecure,
  setToolWorkspaceHost,
  type ToolWorkspaceEntryType,
  type ToolWorkspaceHost,
  type ToolWorkspaceStat,
} from "@/infrastructure/tools/ToolWorkspace";

suite("workspace path validation", () => {
  const workspaceRoot = path.resolve("/tmp/deepseek-agent-workspace");

  test("resolves relative paths inside the workspace", () => {
    const resolved = resolveWorkspacePath("src/core/index.ts", workspaceRoot);

    assert.strictEqual(resolved.relativePath, "src/core/index.ts");
    assert.strictEqual(resolved.absolutePath, path.join(workspaceRoot, "src/core/index.ts"));
  });

  test("resolves absolute paths inside the workspace to relative paths", () => {
    const resolved = resolveWorkspacePath(path.join(workspaceRoot, "README.md"), workspaceRoot);

    assert.strictEqual(resolved.relativePath, "README.md");
    assert.strictEqual(resolved.absolutePath, path.join(workspaceRoot, "README.md"));
  });

  test("rejects traversal and absolute paths outside the workspace", () => {
    assert.throws(() => resolveWorkspacePath("../outside.txt", workspaceRoot), /traversal/);
    assert.throws(() => resolveWorkspacePath("src/../../outside.txt", workspaceRoot), /traversal/);
    assert.throws(() => resolveWorkspacePath(path.resolve("/tmp/outside.txt"), workspaceRoot), /inside the workspace/);
  });

  test("rejects URI-like paths", () => {
    assert.throws(() => resolveWorkspacePath("file:///tmp/workspace/README.md", workspaceRoot), /not a URI/);
    assert.throws(() => resolveWorkspacePath("vscode://file/tmp/workspace/README.md", workspaceRoot), /not a URI/);
    assert.throws(() => resolveWorkspacePath("https://example.com/file.txt", workspaceRoot), /not a URI/);
  });

  test("rejects sensitive file paths by default", () => {
    assert.throws(() => resolveWorkspacePath(".env", workspaceRoot), /sensitive/);
    assert.throws(() => resolveWorkspacePath("Config/.env.local", workspaceRoot), /sensitive/);
    assert.throws(() => resolveWorkspacePath("keys/id_ed25519", workspaceRoot), /sensitive/);
    assert.throws(() => resolveWorkspacePath("certs/server.pem", workspaceRoot), /sensitive/);
    assert.throws(() => resolveWorkspacePath("auth/tokens.json", workspaceRoot), /sensitive/);
  });

  test("allows sensitive paths only when explicitly requested", () => {
    const resolved = resolveWorkspacePath(".env.example", workspaceRoot, { allowSensitive: true });

    assert.strictEqual(resolved.relativePath, ".env.example");
  });

  test("validating host normalizes accepted paths and blocks rejected paths", async () => {
    const calls: string[] = [];
    const host: ToolWorkspaceHost = {
      getRootPath: () => workspaceRoot,
      readFile: async (filePath: string) => {
        calls.push(filePath);
        return Buffer.from("ok");
      },
      writeFile: async (filePath: string) => {
        calls.push(filePath);
      },
      stat: async (filePath: string): Promise<ToolWorkspaceStat> => {
        calls.push(filePath);
        return { type: "file", size: 2 };
      },
      createParentDirectory: async (filePath: string) => {
        calls.push(filePath);
      },
      readDirectory: async (filePath: string): Promise<Array<[string, ToolWorkspaceEntryType]>> => {
        calls.push(filePath);
        return [];
      },
    };

    setToolWorkspaceHost(host);
    await getToolWorkspaceHost().readFile(path.join(workspaceRoot, "src/index.ts"));

    assert.deepStrictEqual(calls, ["src/index.ts"]);
    await assert.rejects(() => getToolWorkspaceHost().readFile("../outside.txt"), /traversal/);
    await assert.rejects(() => getToolWorkspaceHost().readFile(".env"), /sensitive/);
    await getToolWorkspaceHost().writeFile(".env", Buffer.from("secret"));
    assert.strictEqual(calls.at(-1), ".env", "writes use a separate path policy and may update legitimate sensitive-named files");
  });

  test("rejects symbolic links and junctions that resolve outside the workspace", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "deepseek-agent-path-test-"));
    const root = path.join(sandbox, "workspace");
    const outside = path.join(sandbox, "outside");
    await mkdir(root);
    await mkdir(outside);
    const link = path.join(root, "escape");

    try {
      await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
      await assert.rejects(
        () => resolveWorkspacePathSecure("escape/data.txt", root, realpath),
        /outside the workspace through a symbolic link or junction/,
      );

      let readAttempted = false;
      setToolWorkspaceHost({
        ...createNoopWorkspaceHost(root),
        realPath: (absolutePath) => realpath(absolutePath),
        readFile: async () => {
          readAttempted = true;
          return Buffer.from("outside");
        },
      });
      await assert.rejects(() => getToolWorkspaceHost().readFile("escape/data.txt"), /outside the workspace/);
      assert.strictEqual(readAttempted, false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  test("preserves multi-root aliases when validating search results", async () => {
    const validated: string[] = [];
    setToolWorkspaceHost({
      ...createNoopWorkspaceHost(""),
      getRootPath: () => undefined,
      getWorkspaceId: () => "workspace:multi-root",
      resolvePath: async (rawPath) => {
        if (!/^(frontend|backend)\//.test(rawPath) || rawPath.split("/").includes("..")) {
          throw new Error("Path must use a workspace alias");
        }
        validated.push(rawPath);
        return rawPath;
      },
      findFiles: async () => ["frontend/src/App.tsx", "backend/src/server.ts", "../outside.ts"],
    });

    const files = await getToolWorkspaceHost().findFiles!({ includePattern: "**/*", maxResults: 10 });
    assert.deepStrictEqual(files, ["frontend/src/App.tsx", "backend/src/server.ts"]);
    assert.deepStrictEqual(validated, ["frontend/src/App.tsx", "backend/src/server.ts"]);
  });
});

function createNoopWorkspaceHost(rootPath: string): ToolWorkspaceHost {
  return {
    getRootPath: () => rootPath,
    readFile: async () => Buffer.from(""),
    writeFile: async () => undefined,
    stat: async () => ({ type: "unknown", size: 0 }),
    createParentDirectory: async () => undefined,
    readDirectory: async () => [],
  };
}
