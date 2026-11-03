import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

suite("activation storage notifications", () => {
  test("registers the chat without waiting for a storage warning to be dismissed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "deepseek-activation-"));
    const entry = path.join(root, "activate.mjs");
    const mocks: Record<string, string> = {
      vscode: `export const window = {
        createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
        showWarningMessage: () => { globalThis.warningShown = true; return new Promise(() => {}); },
        showInformationMessage: () => { globalThis.reviewShown = true; return new Promise(() => {}); },
      }; export const workspace = { getConfiguration: (section) => ({ get() {},
        inspect(key) {
          if (!globalThis.legacy) { return undefined; }
          if (section.endsWith("webSearch")) { return { globalValue: key === "engine" ? "x" : undefined, workspaceValue: key === "locale" ? "x" : undefined }; }
          return { globalValue: key === "baseUrl" ? "x" : undefined, workspaceValue: key === "model" ? "x" : undefined, workspaceFolderValue: key === "topP" ? "x" : undefined };
        },
        update() { globalThis.updates = (globalThis.updates || 0) + 1; return Promise.resolve(); } }) };
      export const commands = { async executeCommand() {} }; export const ConfigurationTarget = { Global: 1, Workspace: 2 };`,
      "@/infrastructure/persistence/UserDataPaths": 'export function configureUserDataDirectory() {} export function getUserDataDirectory() {return "/test";}',
      "@/vscode/storage/StorageLocation": 'export function getConfiguredStorageDirectory() { return "/test"; }',
      "@/vscode/storage": `export const SettingsManager = {
        async initialize() {}, getPersistenceError: () => process.env.SIMULATE_STORAGE_ERROR ? "Storage unavailable" : undefined, load: () => ({}),
        async completeMigration() { if (!globalThis.initialized) throw new Error("Cleanup before startup"); globalThis.cleaned = true; return process.env.SIMULATE_CLEANUP_ERROR || undefined; },
      }; export const SecretsManager = { async migrateLegacyApiKey() {} };`,
      "@/vscode/activation/RegisterExtensionApi": "export function registerExtensionApi() {globalThis.registered = true;}",
      "./ExtensionRuntime": "export function setActiveProvider() {}",
      "@/vscode/tools/browser": "export function getWebRuntimeDiagnostics() {return {};}",
      "../CompositionRoot": `export class ExtensionCompositionRoot {
        webviewProvider = {}; settings = {}; async initialize() {globalThis.initialized = true;}
      }`,
    };
    try {
      await build({
        stdin: { contents: `
          import { activate } from "./src/extension/lifecycle/Activate";
          globalThis.legacy = process.env.LEGACY_SETTINGS === "1";
          await Promise.race([
            activate({subscriptions: [], globalState: {setKeysForSync() {}}}),
            new Promise((_, reject) => {const timer = setTimeout(() => reject(new Error("Activation blocked by warning")), 500); timer.unref();}),
          ]);
          console.log(JSON.stringify({initialized: globalThis.initialized, registered: globalThis.registered,
            warningShown: !!globalThis.warningShown, reviewShown: !!globalThis.reviewShown, cleaned: globalThis.cleaned,
            updates: globalThis.updates || 0}));
        `, resolveDir: process.cwd() },
        bundle: true, platform: "node", format: "esm", outfile: entry, sourcemap: "inline",
        plugins: [{ name: "activation-dependencies", setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "mock" } : undefined);
          plugin.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "js" }));
        } }],
      });
      const result = await promisify(execFile)(process.execPath, [entry], { env: { ...process.env, SIMULATE_STORAGE_ERROR: "1" } });
      assert.deepEqual(JSON.parse(result.stdout), { initialized: true, registered: true, warningShown: true, reviewShown: false, cleaned: true, updates: 0 });
      const silent = await promisify(execFile)(process.execPath, [entry], { env: { ...process.env, SIMULATE_STORAGE_ERROR: "" } });
      assert.deepEqual(JSON.parse(silent.stdout), { initialized: true, registered: true, warningShown: false, reviewShown: false, cleaned: true, updates: 0 });
      const cleanup = await promisify(execFile)(process.execPath, [entry], { env: {
        ...process.env, SIMULATE_STORAGE_ERROR: "", SIMULATE_CLEANUP_ERROR: "Permission denied during cleanup",
      } });
      assert.deepEqual(JSON.parse(cleanup.stdout), { initialized: true, registered: true, warningShown: true, reviewShown: false, cleaned: true, updates: 0 });
      const legacy = await promisify(execFile)(process.execPath, [entry], { env: {
        ...process.env, SIMULATE_STORAGE_ERROR: "", SIMULATE_CLEANUP_ERROR: "", LEGACY_SETTINGS: "1",
      } });
      assert.deepEqual(JSON.parse(legacy.stdout), { initialized: true, registered: true, warningShown: false, reviewShown: false, cleaned: true, updates: 5 });
    } finally {await rm(root, { recursive: true, force: true });}
  });
});
