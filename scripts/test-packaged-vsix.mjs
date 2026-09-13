import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from "@vscode/test-electron";

const vsixPath = resolve(process.argv[2] ?? "");
const version = process.argv[3] ?? "stable";
const root = resolve(".tmp", `packaged-${version}`);
const vscodeCache = resolve(".tmp", "vscode");
const userDataDir = resolve(root, "user-data");
const extensionsDir = resolve(root, "extensions");
const workspaceDir = resolve(root, "workspace");
await rm(root, { recursive: true, force: true });
await mkdir(userDataDir, { recursive: true });
await mkdir(extensionsDir, { recursive: true });
await mkdir(workspaceDir, { recursive: true });

const executable = await downloadAndUnzipVSCode({ version, cachePath: vscodeCache });
const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable, { reuseMachineInstall: true });
const installation = spawnSync(cli, [
  ...cliArgs,
  "--install-extension", vsixPath,
  "--force",
  "--user-data-dir", userDataDir,
  "--extensions-dir", extensionsDir,
], { encoding: "utf8", stdio: "inherit", shell: process.platform === "win32" });
if (installation.status !== 0) {
  throw new Error(`VSIX installation failed with exit code ${installation.status}`);
}
const installedDirectory = (await readdir(extensionsDir, { withFileTypes: true }))
  .find((entry) => entry.isDirectory() && entry.name.startsWith("yarcrasy.deepseek-agent-"));
if (!installedDirectory) {
  throw new Error("The installed extension directory could not be located.");
}

const inheritedElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_RUN_AS_NODE;
try {
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: resolve(extensionsDir, installedDirectory.name),
    extensionTestsPath: resolve(".tmp/integration-tests/PackagedRunner.js"),
    launchArgs: [workspaceDir, "--user-data-dir", userDataDir, "--extensions-dir", extensionsDir],
    extensionTestsEnv: {
      NODE_ENV: "test",
      DEEPSEEK_AGENT_USER_DATA_DIR: resolve(root, "extension-data"),
      EXPECTED_PACKAGED_EXTENSION_ROOT: resolve(extensionsDir, installedDirectory.name),
    },
  });
} finally {
  if (inheritedElectronRunAsNode !== undefined) {
    process.env.ELECTRON_RUN_AS_NODE = inheritedElectronRunAsNode;
  }
}
