import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const vscodeMock = [
  'import * as path from "node:path";',
  "const state = globalThis.__vscode = { commands: new Map(), executed: [], contentProviders: new Map(), inlineProviders: [], closeListeners: [], folderListeners: [], statusBar: undefined, progress: [], messages: [], errors: [], opened: [], clipboard: [], executedCommands: [] };",
  'export const version = "1.99.0-test";',
  'export const UIKind = { Desktop: 1, Web: 2 };',
  'export const StatusBarAlignment = { Left: 1, Right: 2 };',
  'export const ProgressLocation = { Notification: 15, Window: 10 };',
  'export const InlineCompletionTriggerKind = { Invoke: 0, Automatic: 1 };',
  'export const EndOfLine = { LF: 1, CRLF: 2 };',
  "export class Position { constructor(line, character) { this.line = line; this.character = character; } isEqual(other) { return other.line === this.line && other.character === this.character; } }",
  "export class Range { constructor(start, end) { this.start = start; this.end = end; } contains(other) { const start = other.start || other; const end = other.end || other; return this.start.line <= start.line && (this.start.line < start.line || this.start.character <= start.character) && this.end.line >= end.line && (this.end.line > end.line || this.end.character >= end.character); } isEqual(other) { return other.start.line === this.start.line && other.start.character === this.start.character && other.end.line === this.end.line && other.end.character === this.end.character; } }",
  "export class InlineCompletionItem { constructor(insertText, range) { this.insertText = insertText; this.range = range; } }",
  "const uri = (scheme, uriPath) => ({ scheme, path: uriPath, fsPath: uriPath, toString: () => scheme + \":\" + uriPath });",
  "export const Uri = { from: (value) => uri(value.scheme, value.path), file: (filePath) => uri(\"file\", filePath), joinPath: (base, ...parts) => uri(base.scheme, path.join(base.path, ...parts)), parse: (value) => uri(value.split(\":\")[0], value.split(\":\").slice(1).join(\":\")) };",
  "export const workspace = {",
  "  isTrusted: true,",
  "  registerTextDocumentContentProvider(scheme, provider) { state.contentProviders.set(scheme, provider); return { dispose() { state.contentProviders.delete(scheme); } }; },",
  "  onDidCloseTextDocument(listener) { state.closeListeners.push(listener); return { dispose() { state.closeListeners = []; } }; },",
  "  onDidChangeWorkspaceFolders(listener) { state.folderListeners.push(listener); return { dispose() { state.folderListeners = state.folderListeners.filter((item) => item !== listener); } }; },",
  "  getConfiguration() { return { get() {}, inspect() {} }; },",
  "};",
  "export const languages = { registerInlineCompletionItemProvider(selector, provider) { state.inlineProviders.push({ selector, provider }); return { dispose() {} }; } };",
  "export const commands = {",
  "  registerCommand(id, handler) { state.commands.set(id, handler); return { dispose() { state.commands.delete(id); } }; },",
  "  async executeCommand(id, ...args) { state.executed.push([id, ...args]); return globalThis.__commandResults && globalThis.__commandResults[id] ? globalThis.__commandResults[id](...args) : undefined; },",
  "};",
  "export const window = {",
  "  activeTextEditor: undefined,",
  "  createStatusBarItem(alignment, priority) { const item = { alignment, priority, text: \"\", command: \"\", tooltip: \"\", shown: 0, hidden: 0, disposed: 0, show() { item.shown += 1; }, hide() { item.hidden += 1; }, dispose() { item.disposed += 1; } }; state.statusBar = item; return item; },",
  "  async withProgress(options, task) { state.progress.push(options); return task({ report() {} }, globalThis.__progressToken || { onCancellationRequested() { return { dispose() {} }; } }); },",
  "  async showInformationMessage(...args) { state.messages.push(args); return globalThis.__messageResponse; },",
  "  async showErrorMessage(...args) { state.errors.push(args); },",
  "  async showTextDocument(document) { state.opened.push(document); if (!globalThis.__shownEditor) { throw new Error(\"No editor fixture\"); } return globalThis.__shownEditor; },",
  "  registerWebviewViewProvider(id, provider) { globalThis.__viewProvider = { id, provider }; return { dispose() {} }; },",
  "};",
  'export const env = { language: "en", remoteName: undefined, uiKind: 1, clipboard: { async writeText(text) { state.clipboard.push(text); } } };',
].join("\n");

const mocks: Record<string, string> = {
  vscode: vscodeMock,
  "@/infrastructure/browser/ChromiumProvider": "export class ChromiumProvider { constructor(directory, progress) { globalThis.__chromiumPath = directory; globalThis.__chromiumProgress = progress; } }",
  "@/infrastructure/capture/SystemBrowserCapture": "export class SystemBrowserCapture { constructor(browsers) { globalThis.__browserSource = browsers; } }",
  "@/infrastructure/capture/NativeCaptureBackend": "export class NativeCaptureBackend { constructor(pid, one, two, three, portalOptions) { this.timeoutMs = 4321; globalThis.__nativeCaptureArgs = [pid, one, two, three, portalOptions]; } capture(request) { globalThis.__nativeRequest = request; return \"captured\"; } }",
  "@/vscode/tools/capture/NativeDebugAnchor": "export class NativeDebugAnchor { pid() { return 4242; } dispose() { globalThis.__debugAnchorDisposed = (globalThis.__debugAnchorDisposed || 0) + 1; } }",
  "@/infrastructure/capture/CaptureService": "export function registerCaptureBackend(target, backend) { globalThis.__backends.push({ target, backend }); }",
  "@/infrastructure/capture/CapturePermissions": "export class CapturePermissions { constructor(options) { globalThis.__captureOptions = options; } wrap(backend) { return { ...backend, wrapped: true }; } portalOptions(request) { return { portal: true, request }; } }",
  "@/infrastructure/capture/WaylandPortalCapture": "export function usesWaylandPortal() { return globalThis.__wayland === true; }",
  "@/application/tools": "export class ToolRegistry { constructor() { this.tools = []; } register(tool) { this.tools.push(tool); } }",
  "@/infrastructure/browser/BrowserTools": "export function createHeadlessWebTools(runtime, options) { globalThis.__webToolRuntime = runtime; globalThis.__webToolOptions = options; return [{ name: \"web_search\" }]; }",
  "@/infrastructure/browser/HeadlessWebRuntime": "export class HeadlessWebRuntime { constructor(browsers, ensure) { globalThis.__webRuntimeEnsure = ensure; globalThis.__webRuntimeBrowsers = browsers; } }",
  "@/infrastructure/tools/builtins": "export const BUILT_IN_TOOLS = [{ name: \"read_file\" }, { name: \"edit_file\" }];",
  "@/vscode/tools/browser/Diagnostics": "export function configureWebRuntimeDiagnostics(runtime) { globalThis.__diagnosticsRuntime = runtime; }",
  "@/infrastructure/deepseek/web/DeepSeekWebClient": "export class DeepSeekWebClient { constructor(config) { globalThis.__webClientConfig = config; } async search(query, limit, signal, options) { globalThis.__webSearchArgs = [query, limit, signal, options]; return []; } dispose() { globalThis.__webClientDisposed = true; } }",
  "@/vscode/storage": "export class HistoryManager { constructor(settings) { globalThis.__historySettings = settings; } }",
  "@/vscode/storage/RepositoryAdapters": "export class VsCodeSecretStore { constructor(context) { globalThis.__secretContext = context; } async getApiKey() { return \"secret-key\"; } } export class VsCodeSettingsRepository { constructor() { globalThis.__settingsInstance = this; } load() { return globalThis.__settings.value; } }",
  "@/vscode/webviews/WebviewProvider": "export class WebviewProvider { static viewType = \"deepseek-agent.chatView\"; constructor(uri, context, dependencies) { globalThis.__webviewDeps = dependencies; globalThis.__webviewUri = uri; } async initialize() { globalThis.__webviewInitialized = true; } dispose() { globalThis.__webviewDisposed = true; } }",
  "@/infrastructure/deepseek/provider/DeepSeekModelProviderFactory": "export class DeepSeekModelProviderFactory { constructor() { globalThis.__modelFactory = (globalThis.__modelFactory || 0) + 1; } }",
  "@/vscode/completions/ChatSuggestionContext": "export function captureChatSuggestionContext(workspace, signal) { globalThis.__suggestionSignal = signal; return { signal }; }",
  "@/vscode/completions/CompletionService": "export class CompletionService { constructor(...args) { globalThis.__completionArgs = args; globalThis.__completionInstance = this; this.invalidations = 0; } invalidate() { this.invalidations += 1; globalThis.__invalidated = (globalThis.__invalidated || 0) + 1; } }",
  "@/vscode/completions/EditorFeatures": "export function registerEditorFeatures(context, service) { globalThis.__editorFeaturesService = service; }",
  "@/vscode/storage/SettingsManager": "export const SettingsManager = { onDidChange(listener) { globalThis.__settingsListener = listener; return () => { globalThis.__settingsUnsubscribed = true; }; } };",
  "@/vscode/commands/ChatCommands": "export function registerChatCommands(context, provider) { globalThis.__chatCommands = [context, provider]; }",
  "@/vscode/tools/browser": "export function getWebRuntimeDiagnostics() { return { chromium: \"ready\" }; }",
  "@/shared/logging/Logger": "export function logWarning() { globalThis.__warnings = (globalThis.__warnings || 0) + 1; } export function showDiagnostics() { globalThis.__diagnosticsShown = (globalThis.__diagnosticsShown || 0) + 1; } export function clearDiagnostics() { globalThis.__diagnosticsCleared = (globalThis.__diagnosticsCleared || 0) + 1; } export function createSanitizedSupportReport(facts) { globalThis.__supportFacts = facts; return JSON.stringify(facts); }",
  "./CompletionService": "export class CompletionService {}",
};

const child = String.raw`
import assert from "node:assert/strict";
import { ExtensionCompositionRoot } from "./src/extension/CompositionRoot";
import { createEditorCompletionProvider, registerEditorFeatures } from "./src/vscode/completions/EditorFeatures";
import { registerExtensionApi } from "./src/vscode/activation/RegisterExtensionApi";
import { SIDEBAR_VIEW_ID } from "@/shared/constants";
import * as vscode from "vscode";

const state = globalThis.__vscode;
globalThis.__backends = [];
globalThis.__settings = { value: { betaFeaturesEnabled: true, capturePermission: "ask", webSearchEnabled: true, baseUrl: "https://api.deepseek.com", webSearchRegion: "es", model: "deepseek-chat", permissionMode: "limited", thinkingMode: true, historyEnabled: true, includeHomeAgents: false } };
const settings = globalThis.__settings;

function makeContext() {
  return {
    subscriptions: [],
    globalStorageUri: vscode.Uri.file("/tmp/deepseek-storage"),
    globalState: {
      get(key) { state.globalStateReads = (state.globalStateReads || []).concat([key]); return { capturePermissions: { window: { allowed: true } } }[key]; },
      update(key, value) { state.globalStateWrites = (state.globalStateWrites || []).concat([[key, value]]); },
    },
    extension: { packageJSON: { version: "9.9.9" } },
  };
}

const rootContext = makeContext();
const root = new ExtensionCompositionRoot(rootContext);
assert.equal(state.statusBar.text, "$(sparkle) DeepSeek");
assert.equal(state.statusBar.command, "deepseek-agent.openChat");
assert.equal(state.statusBar.alignment, vscode.StatusBarAlignment.Right);
assert.equal(state.statusBar.priority, 15);
const completionArgs = globalThis.__completionArgs;
assert.equal(completionArgs.length, 7);
assert.equal(completionArgs[3](), true);
completionArgs[4]({ costUsd: 1.5, count: 3, totalTokens: 1200 });
assert.equal(state.statusBar.shown, 1);
assert.match(state.statusBar.tooltip, /3 requests/);
assert.match(state.statusBar.tooltip, /1200 tokens/);
completionArgs[4]({ costUsd: 0, count: 1 });
assert.match(state.statusBar.tooltip, /— tokens/);
const signal = new AbortController().signal;
completionArgs[6](signal);
assert.equal(globalThis.__suggestionSignal, signal);
assert.equal(globalThis.__editorFeaturesService, root.completions);

globalThis.__settingsListener();
assert.equal(globalThis.__invalidated, 1);
assert.equal(state.statusBar.hidden, 0);
settings.value.betaFeaturesEnabled = false;
globalThis.__settingsListener();
assert.equal(globalThis.__invalidated, 2);
assert.equal(state.statusBar.hidden, 1);
state.folderListeners[0]();
assert.equal(globalThis.__invalidated, 3);

assert.equal(globalThis.__chromiumPath, "/tmp/deepseek-storage/chromium");
assert.equal(await globalThis.__chromiumProgress(async () => "prepared"), "prepared");
assert.equal(state.progress[0].location, vscode.ProgressLocation.Notification);
assert.match(state.progress[0].title, /Preparing Chromium/);

const capture = globalThis.__captureOptions;
settings.value.capturePermission = "always";
assert.equal(capture.mode(), "always");
assert.deepEqual(capture.read(), { window: { allowed: true } });
capture.save({ screen: {} });
assert.deepEqual(state.globalStateWrites, [["capturePermissions", { screen: {} }]]);
globalThis.__messageResponse = "Allow";
assert.equal(await capture.confirm("the debug window"), true);
assert.equal(state.messages.at(-1)[0], "Allow YCraSy Agent to capture the debug window?");
globalThis.__messageResponse = undefined;
assert.equal(await capture.confirm("the debug window"), false);
assert.equal(capture.systemChooser({ target: "web" }), false);
assert.equal(capture.systemChooser({ target: "debug" }), false);
globalThis.__wayland = true;
assert.equal(capture.systemChooser({ target: "debug" }), true);
assert.equal(capture.debugPid(), 4242);

assert.deepEqual(globalThis.__backends.map((entry) => entry.target), ["web", "window", "debug", "screen"]);
assert.equal(globalThis.__backends[0].backend.wrapped, true);
assert.ok(globalThis.__backends[0].backend instanceof Object);
const desktop = globalThis.__backends[1].backend;
assert.equal(globalThis.__nativeCaptureArgs[0](), 4242);
vscode.env.remoteName = "ssh-remote";
assert.throws(() => desktop.capture({ target: "window" }, undefined), /Native capture requires a local desktop extension host/);
vscode.env.remoteName = undefined;
vscode.env.uiKind = 2;
assert.throws(() => desktop.capture({ target: "window" }, undefined), /Native capture requires a local desktop extension host/);
vscode.env.uiKind = 1;
assert.equal(desktop.capture({ target: "window" }, undefined), "captured");
assert.deepEqual(globalThis.__nativeRequest, { target: "window" });
assert.deepEqual(globalThis.__nativeCaptureArgs[4]({ target: "debug" }), { portal: true, request: { target: "debug" } });

settings.value.webSearchEnabled = false;
await assert.rejects(() => globalThis.__webClientConfig(), /Web search is disabled in settings\./);
settings.value.webSearchEnabled = true;
assert.deepEqual(await globalThis.__webClientConfig(), { baseUrl: "https://api.deepseek.com", apiKey: "secret-key" });
settings.value.webSearchEnabled = false;
assert.throws(() => globalThis.__webRuntimeEnsure(), /Web reading is disabled in settings/);
settings.value.webSearchEnabled = true;
assert.equal(globalThis.__webRuntimeEnsure(), undefined);
assert.equal(globalThis.__diagnosticsRuntime, root.webRuntime);
assert.equal(globalThis.__webRuntimeBrowsers, globalThis.__browserSource);

assert.equal(root.toolRegistry.tools.length, 3);
const webOptions = globalThis.__webToolOptions;
assert.equal(webOptions.vscodeLanguage(), "en");
assert.equal(webOptions.searchRegion(), "es");
vscode.env.remoteName = "ssh-remote";
assert.equal(webOptions.systemLocale(), undefined);
vscode.env.remoteName = undefined;
assert.equal(typeof webOptions.systemLocale(), "string");
assert.deepEqual(await webOptions.search("deepseek", "en", 5, undefined, { safe: true }), []);
assert.deepEqual(globalThis.__webSearchArgs, ["deepseek", 5, undefined, { safe: true }]);

const dependencies = globalThis.__webviewDeps;
assert.equal(dependencies.historyManager, root.history);
assert.equal(dependencies.toolRegistry, root.toolRegistry);
assert.equal(dependencies.headlessWebRuntime, root.webRuntime);
assert.equal(dependencies.settings, root.settings);
assert.equal(dependencies.secrets, root.secrets);
assert.equal(dependencies.completions, root.completions);
assert.ok(dependencies.modelProviderFactory);
assert.equal(globalThis.__historySettings, root.settings);
assert.equal(globalThis.__secretContext, rootContext);

for (const item of rootContext.subscriptions) { if (item && typeof item.dispose === "function") { item.dispose(); } }
assert.equal(globalThis.__invalidated, 4);
assert.equal(globalThis.__webClientDisposed, true);
assert.equal(state.statusBar.disposed, 1);
assert.equal(globalThis.__debugAnchorDisposed, 1);
await root.initialize();
assert.equal(globalThis.__webviewInitialized, true);
root.dispose();
assert.equal(globalThis.__webviewDisposed, true);
globalThis.__commandResults = {};

function makeDocument(text, options = {}) {
  const scheme = options.scheme || "file";
  const uriPath = options.path || "/workspace/a.ts";
  const separator = options.eol === vscode.EndOfLine.CRLF ? 2 : 1;
  const eolCharacter = options.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const lines = text.split(eolCharacter);
  const document = {
    uri: { scheme, path: uriPath, toString: () => scheme + ":" + uriPath },
    languageId: options.languageId || "typescript",
    version: options.version || 3,
    isClosed: false,
    eol: options.eol || vscode.EndOfLine.LF,
    lineCount: lines.length,
    getText(range) { return range ? text.slice(document.offsetAt(range.start), document.offsetAt(range.end)) : text; },
    offsetAt(position) { let offset = 0; for (let index = 0; index < position.line; index += 1) { offset += lines[index].length + separator; } return offset + position.character; },
    positionAt(offset) { let remaining = offset; let line = 0; while (line < lines.length - 1 && remaining > lines[line].length) { remaining -= lines[line].length + separator; line += 1; } return new vscode.Position(line, Math.max(0, Math.min(lines[line].length, remaining))); },
    lineAt(line) { const value = lines[line]; return { text: value, range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, value.length)) }; },
  };
  return document;
}

function makeService() {
  return {
    edits: [],
    suggestions: [],
    enabled() { return globalThis.__enabled !== false; },
    invalidate() {},
    async edit(...args) { this.edits.push(args); if (globalThis.__editError) { throw globalThis.__editError; } if (globalThis.__afterEdit) { globalThis.__afterEdit(); } return globalThis.__editResult; },
    async suggest(...args) { this.suggestions.push(args); if (globalThis.__suggestError) { throw globalThis.__suggestError; } return globalThis.__suggestResult; },
  };
}

function makeEditor(document, selection) {
  return { document, selection: selection || { isEmpty: true, active: new vscode.Position(0, 0) } };
}

const featureContext = makeContext();
const service = makeService();
state.messages.length = 0;
state.errors.length = 0;
registerEditorFeatures(featureContext, service);
assert.equal(featureContext.subscriptions.length, 5);
const previewProvider = state.contentProviders.get("ycrasy-edit-preview");
assert.equal(previewProvider.provideTextDocumentContent({ toString: () => "ycrasy-edit-preview:/x" }), "");
assert.deepEqual(state.inlineProviders[0].selector, [{ scheme: "file" }, { scheme: "untitled" }, { scheme: "vscode-remote" }]);

state.commands.get("deepseek-agent.completeEditor");
const complete = state.commands.get("deepseek-agent.completeEditor");
const refactor = state.commands.get("deepseek-agent.refactorEditor");
globalThis.__editResult = "const replaced = 1;";
await complete();
assert.equal(state.messages.length, 0);
vscode.window.activeTextEditor = makeEditor(makeDocument("const value = 1;\n", { scheme: "output" }));
await complete();
assert.equal(state.messages.length, 0);

let document = makeDocument("const value = compute();\n");
vscode.window.activeTextEditor = makeEditor(document);
const replaced = [];
globalThis.__shownEditor = { async edit(callback) { callback({ replace: (range, text) => replaced.push([range, text]) }); return globalThis.__applyResult !== false; } };
globalThis.__messageResponse = "Apply";
await complete();
assert.equal(service.edits.length, 1);
assert.equal(service.edits[0][0], "complete");
assert.equal(service.edits[0][1], "const value = compute();");
assert.equal(service.edits[0][2], "typescript");
assert.equal(service.edits[0][3], "");
assert.equal(service.edits[0][4], "\n");
assert.equal(replaced.length, 1);
assert.equal(replaced[0][1], "const replaced = 1;");
assert.equal(state.inlineProviders.length, 1);
assert.equal(state.executed.at(-1)[0], "vscode.diff");
assert.equal(state.executed.at(-1)[3], "YCraSy DeepSeek Agent — a.ts");
assert.equal(previewProvider.provideTextDocumentContent(state.executed.at(-1)[1]), "const value = compute();\n");
assert.equal(previewProvider.provideTextDocumentContent(state.executed.at(-1)[2]), "const replaced = 1;\n");
assert.match(state.messages.at(-1)[0], /Review the proposed changes/);
state.closeListeners.forEach((listener) => listener({ uri: state.executed.at(-1)[1] }));
assert.equal(previewProvider.provideTextDocumentContent(state.executed.at(-1)[1]), "");

globalThis.__messageResponse = "Discard";
await refactor();
assert.equal(state.executed.at(-1)[0], "vscode.diff");
globalThis.__messageResponse = undefined;

globalThis.__applyResult = false;
globalThis.__messageResponse = "Apply";
await complete().catch(() => undefined);
assert.equal(state.errors.length, 1);
assert.match(state.errors[0][0], /Could not apply the edit/);
globalThis.__applyResult = undefined;

globalThis.__editResult = "const value = compute();";
globalThis.__messageResponse = undefined;
await complete();
assert.match(state.messages.at(-1)[0], /No changes proposed/);
globalThis.__editResult = "const replaced = 1;";

document = makeDocument("first line\r\nconst value = compute();\r\n", { eol: vscode.EndOfLine.CRLF });
vscode.window.activeTextEditor = makeEditor(document);
globalThis.__editResult = "const replaced = 2;\nconst extra = 3;";
globalThis.__messageResponse = "Apply";
await complete();
assert.equal(replaced.at(-1)[1], "const replaced = 2;\r\nconst extra = 3;");

const originalError = new Error("provider failed");
globalThis.__editError = originalError;
globalThis.__messageResponse = undefined;
await complete();
assert.equal(state.errors.at(-1)[0], "provider failed");
globalThis.__editError = Object.assign(new Error("aborted"), { name: "AbortError" });
await complete();
assert.equal(state.errors.at(-1)[0], "provider failed");
globalThis.__editError = Object.assign(new Error("timed out"), { name: "TimeoutError" });
await complete();
assert.equal(state.errors.at(-1)[0], "provider failed");
globalThis.__editError = "plain failure";
await complete();
assert.equal(state.errors.at(-1)[0], "Could not generate the edit.");
globalThis.__editError = undefined;

vscode.env.language = "es-ES";
globalThis.__messageResponse = "Aplicar";
document = makeDocument("const value = compute();\n");
vscode.window.activeTextEditor = makeEditor(document);
await refactor();
assert.match(state.progress.at(-1).title, /Refactorizando/);
assert.match(state.messages.filter((message) => /Revisa los cambios/.test(message[0])).at(-1)[1], /Aplicar/);
vscode.window.activeTextEditor = makeEditor(document);
await complete();
assert.match(state.progress.at(-1).title, /Completando código/);
globalThis.__editResult = "const value = compute();";
globalThis.__messageResponse = undefined;
await complete();
assert.match(state.messages.at(-1)[0], /No hay cambios propuestos/);
vscode.env.language = "en";

globalThis.__editResult = "const replaced = 3;";
globalThis.__afterEdit = () => { document.version += 1; };
await complete();
assert.equal(state.errors.at(-1)[0], "The document changed; the suggestion was not applied. Run the command again.");
globalThis.__afterEdit = undefined;

const provider = createEditorCompletionProvider(service);
const token = { isCancellationRequested: false, onCancellationRequested() { return { dispose() {} }; } };
const target = makeDocument("const value = compute();\n");
vscode.window.activeTextEditor = makeEditor(target);
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token), []);
globalThis.__enabled = false;
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token), []);
globalThis.__enabled = undefined;
const blocked = makeDocument("api key\n", { languageId: "plaintext" });
vscode.window.activeTextEditor = makeEditor(blocked);
assert.deepEqual(await provider.provideInlineCompletionItems(blocked, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token), []);
vscode.window.activeTextEditor = undefined;
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token), []);
vscode.window.activeTextEditor = { document: target, selection: { isEmpty: false, active: new vscode.Position(0, 0) } };
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token), []);
vscode.window.activeTextEditor = makeEditor(makeDocument("other\n"));
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token), []);
vscode.window.activeTextEditor = makeEditor(target, { isEmpty: true, active: new vscode.Position(0, 4) });
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token), []);

vscode.window.activeTextEditor = makeEditor(target);
globalThis.__suggestResult = "value = 2";
const items = await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token);
assert.equal(items.length, 1);
assert.equal(items[0].insertText, "value = 2");
assert.equal(items[0].range.start.line, 0);
assert.equal(items[0].range.start.character, 0);
assert.equal(service.suggestions.at(-1)[0], "editor");
assert.equal(service.suggestions.at(-1)[1], "");
assert.equal(service.suggestions.at(-1)[2], "const value = compute();\n");

const selected = { text: "con", range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)) };
const selectedItems = await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: selected }, token);
assert.equal(selectedItems[0].insertText, "convalue = 2");
assert.equal(service.suggestions.at(-1)[1], "con");

const crlf = makeDocument("const value = compute();\r\n", { eol: vscode.EndOfLine.CRLF });
vscode.window.activeTextEditor = makeEditor(crlf);
globalThis.__suggestResult = "one\ntwo";
const crlfItems = await provider.provideInlineCompletionItems(crlf, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token);
assert.equal(crlfItems[0].insertText, "one\r\ntwo");

vscode.window.activeTextEditor = makeEditor(target);
globalThis.__suggestResult = "";
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token), []);
globalThis.__suggestResult = "value = 2";
const cancelled = { isCancellationRequested: true, onCancellationRequested() { return { dispose() {} }; } };
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, cancelled), []);

const warnings = globalThis.__warnings || 0;
globalThis.__suggestError = new Error("suggest failed");
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token), []);
assert.equal(globalThis.__warnings, warnings + 1);
globalThis.__suggestError = Object.assign(new Error("aborted"), { name: "AbortError" });
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Invoke }, token), []);
globalThis.__suggestError = undefined;

const automatic = { isCancellationRequested: false, onCancellationRequested(callback) { setTimeout(() => callback(), 0); return { dispose() {} }; } };
assert.deepEqual(await provider.provideInlineCompletionItems(target, new vscode.Position(0, 0), { triggerKind: vscode.InlineCompletionTriggerKind.Automatic }, automatic), []);

const symbolDocument = makeDocument("function outer() {\n  const inner = 1;\n}\n", { version: 1 });
const outerRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(2, 1));
const innerRange = new vscode.Range(new vscode.Position(1, 2), new vscode.Position(1, 17));
globalThis.__commandResults["vscode.executeDocumentSymbolProvider"] = () => [
  { range: outerRange, children: [{ range: innerRange }] },
  { location: { range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)) } },
];
vscode.window.activeTextEditor = makeEditor(symbolDocument, { isEmpty: true, active: new vscode.Position(1, 5) });
globalThis.__editResult = "replaced";
globalThis.__messageResponse = "Discard";
await complete();
assert.equal(service.edits.at(-1)[1], "const inner = 1");

globalThis.__commandResults["vscode.executeDocumentSymbolProvider"] = () => [];
globalThis.__commandResults["vscode.executeSelectionRangeProvider"] = () => [
  { range: new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 17)), parent: { range: outerRange, parent: undefined } },
];
await complete();
assert.equal(service.edits.at(-1)[1], "function outer() {\n  const inner = 1;\n}");

globalThis.__commandResults["vscode.executeDocumentSymbolProvider"] = () => { symbolDocument.version += 1; return []; };
await complete();
assert.equal(state.errors.at(-1)[0], "The document changed. Run the command again.");
globalThis.__commandResults["vscode.executeDocumentSymbolProvider"] = () => [];

const hugeDocument = makeDocument("x".repeat(200_000) + "\n");
vscode.window.activeTextEditor = { document: hugeDocument, selection: {
  isEmpty: false, start: new vscode.Position(0, 0), end: new vscode.Position(0, 200_000), active: new vscode.Position(0, 200_000) } };
await complete();
assert.equal(state.errors.at(-1)[0], "Select a smaller scope (at most 128 KiB).");

const blankDocument = makeDocument("first\n\n");
vscode.window.activeTextEditor = makeEditor(blankDocument, { isEmpty: true, active: new vscode.Position(1, 0) });
await complete();
assert.equal(service.edits.at(-1)[1], "first\n\n");

const selectionDocument = makeDocument("alpha beta\n");
vscode.window.activeTextEditor = { document: selectionDocument, selection: {
  isEmpty: false, start: new vscode.Position(0, 0), end: new vscode.Position(0, 5), active: new vscode.Position(0, 5) } };
await complete();
assert.equal(service.edits.at(-1)[1], "alpha");
globalThis.__messageResponse = undefined;

const apiContext = makeContext();
const providerInstance = { dispose() {} };
const settingsRepository = { load: () => ({ model: "deepseek-chat", permissionMode: "limited", thinkingMode: true, historyEnabled: true, includeHomeAgents: false }) };
registerExtensionApi(apiContext, providerInstance, settingsRepository);
assert.equal(globalThis.__viewProvider.id, "deepseek-agent.chatView");
assert.equal(globalThis.__chatCommands[1], providerInstance);
assert.ok(apiContext.subscriptions.includes(providerInstance));
await state.commands.get("deepseek-agent.openChat")();
assert.equal(state.executed.at(-1)[0], SIDEBAR_VIEW_ID);
state.executed.length = 0;

globalThis.__messageResponse = "Copy sanitized report";
await state.commands.get("deepseek-agent.showDiagnostics")();
assert.equal(globalThis.__diagnosticsShown, 1);
assert.equal(state.clipboard.length, 1);
assert.match(state.clipboard[0], /9\.9\.9/);
assert.deepEqual(globalThis.__supportFacts.features, { thinkingMode: true, workspaceSnapshots: true, historyEnabled: true, includeHomeAgents: false });
assert.equal(globalThis.__supportFacts.webRuntime.chromium, "ready");
assert.match(state.messages.at(-1)[0], /Sanitized diagnostics copied/);
globalThis.__messageResponse = "Clear diagnostics";
await state.commands.get("deepseek-agent.showDiagnostics")();
assert.equal(globalThis.__diagnosticsCleared, 1);
globalThis.__messageResponse = undefined;
await state.commands.get("deepseek-agent.showDiagnostics")();
assert.equal(globalThis.__diagnosticsCleared, 1);
await state.commands.get("deepseek-agent.clearDiagnostics")();
assert.equal(globalThis.__diagnosticsCleared, 2);

console.log(JSON.stringify({ ok: true }));
`;

suite("extension composition wiring", () => {
  test("constructs the extension root, editor features and API with deterministic boundaries", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "deepseek-wiring-"));
    const entry = path.join(directory, "wiring.mjs");
    try {
      await build({
        stdin: { contents: child, resolveDir: process.cwd(), sourcefile: "wiring.ts", loader: "ts" },
        bundle: true, platform: "node", format: "esm", outfile: entry, sourcemap: "inline",
        plugins: [{
          name: "extension-wiring-dependencies",
          setup(plugin) {
            plugin.onResolve({ filter: /.*/ }, (args) => {
              if (args.path in mocks && !args.importer.includes("EditorFeatures.test")) { return { path: args.path, namespace: "mock" }; }
              return undefined;
            });
            plugin.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
          },
        }],
      });
      const result = await promisify(execFile)(process.execPath, ["--enable-source-maps", entry], { env: { ...process.env }, maxBuffer: 10 * 1024 * 1024 });
      assert.deepEqual(JSON.parse(result.stdout), { ok: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
