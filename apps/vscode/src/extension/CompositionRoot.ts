import { ChromiumProvider } from "@/infrastructure/browser/ChromiumProvider";
import { SystemBrowserCapture } from "@/infrastructure/capture/SystemBrowserCapture";
import { NativeCaptureBackend } from "@/infrastructure/capture/NativeCaptureBackend";
import { NativeDebugAnchor } from "@/vscode/tools/capture/NativeDebugAnchor";
import { registerCaptureBackend } from "@/infrastructure/capture/CaptureService";
import { CapturePermissions } from "@/infrastructure/capture/CapturePermissions";
import { usesWaylandPortal } from "@/infrastructure/capture/WaylandPortalCapture";
import * as vscode from "vscode";
import { ToolRegistry } from "@/application/tools";
import { createHeadlessWebTools } from "@/infrastructure/browser/BrowserTools";
import { HeadlessWebRuntime } from "@/infrastructure/browser/HeadlessWebRuntime";
import { BUILT_IN_TOOLS } from "@/infrastructure/tools/builtins";
import { configureWebRuntimeDiagnostics } from "@/vscode/tools/browser/Diagnostics";
import { DeepSeekWebClient } from "@/infrastructure/deepseek/web/DeepSeekWebClient";
import { HistoryManager } from "@/vscode/storage";
import {
  VsCodeSecretStore,
  VsCodeSettingsRepository,
} from "@/vscode/storage/RepositoryAdapters";
import { WebviewProvider } from "@/vscode/webviews/WebviewProvider";
import { DeepSeekModelProviderFactory } from "@/infrastructure/deepseek/provider/DeepSeekModelProviderFactory";
import { captureChatSuggestionContext } from "@/vscode/completions/ChatSuggestionContext";
import { CompletionService } from "@/vscode/completions/CompletionService";
import { registerEditorFeatures } from "@/vscode/completions/EditorFeatures";
import { SettingsManager } from "@/vscode/storage/SettingsManager";
import { formatUsageCost } from "@/shared/usage/Usage";

export class ExtensionCompositionRoot implements vscode.Disposable {
  readonly settings = new VsCodeSettingsRepository();
  readonly secrets: VsCodeSecretStore;
  readonly history: HistoryManager;
  readonly webRuntime: HeadlessWebRuntime;
  readonly toolRegistry: ToolRegistry;
  readonly webviewProvider: WebviewProvider;
  readonly completions: CompletionService;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = new VsCodeSecretStore(context);
    this.history = new HistoryManager(this.settings);
    const completionStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 15);
    completionStatus.text = "$(sparkle) DeepSeek";
    completionStatus.command = "deepseek-agent.openChat";
    this.completions = new CompletionService(this.settings, this.secrets, new DeepSeekModelProviderFactory(),
      () => vscode.workspace.isTrusted, (usage) => {
        const cost = formatUsageCost(usage.costUsd, { currency: "usd", locale: vscode.env.language, unavailable: "—" });
        completionStatus.tooltip = `DeepSeek · ${usage.count} requests · ${usage.totalTokens ?? "—"} tokens · ${cost}\nEditor/chat suggestions and editor actions (this session).`;
        completionStatus.show();
      }, undefined, (signal) => captureChatSuggestionContext(vscode.workspace, signal));
    const unsubscribe = SettingsManager.onDidChange(() => {
      this.completions.invalidate();
      if (!this.settings.load().betaFeaturesEnabled) {completionStatus.hide();}
    });
    context.subscriptions.push(completionStatus, { dispose: unsubscribe },
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.completions.invalidate()),
      { dispose: () => this.completions.invalidate() });
    registerEditorFeatures(context, this.completions);
    const browsers = new ChromiumProvider(vscode.Uri.joinPath(context.globalStorageUri, "chromium").fsPath,
      async (task) => vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
        title: "Preparing Chromium for web reads and screenshots (first download may take several minutes)" }, task));
    const debugAnchor = new NativeDebugAnchor();
    context.subscriptions.push(debugAnchor);
    const capturePermissions = new CapturePermissions({
      mode: () => this.settings.load().capturePermission,
      read: () => context.globalState.get("capturePermissions"),
      save: state => context.globalState.update("capturePermissions", state),
      confirm: async view => await vscode.window.showInformationMessage(`Allow YCraSy Agent to capture ${view}?`, { modal: true }, "Allow") === "Allow",
      systemChooser: request => request.target !== "web" && usesWaylandPortal(),
      debugPid: () => debugAnchor.pid(),
    });
    registerCaptureBackend("web", capturePermissions.wrap(new SystemBrowserCapture(browsers)));
    const nativeCapture = new NativeCaptureBackend(() => debugAnchor.pid(), undefined, undefined, undefined, request => capturePermissions.portalOptions(request));
    const desktopCapture = { timeoutMs: nativeCapture.timeoutMs, capture: (request: Parameters<NativeCaptureBackend["capture"]>[0], signal: AbortSignal) => {
      if (vscode.env.remoteName || vscode.env.uiKind !== vscode.UIKind.Desktop) {throw new Error("Native capture requires a local desktop extension host; remote workspaces cannot capture the UI machine");}
      return nativeCapture.capture(request, signal);
    }};
    for (const target of ["window", "debug", "screen"] as const) {registerCaptureBackend(target, capturePermissions.wrap(desktopCapture));}
    const webClient = new DeepSeekWebClient(async () => {
      const config = this.settings.load();
      if (!config.webSearchEnabled) {throw new Error("Web search is disabled in settings.");}
      return { baseUrl: config.baseUrl, apiKey: await this.secrets.getApiKey(config.baseUrl) ?? "" };
    });
    context.subscriptions.push({ dispose: () => webClient.dispose() });
    this.webRuntime = new HeadlessWebRuntime(browsers, () => {
      const config = this.settings.load();
      if (!config.webSearchEnabled) {throw new Error("Web reading is disabled in settings");}
    });
    configureWebRuntimeDiagnostics(this.webRuntime);

    this.toolRegistry = new ToolRegistry();
    for (const tool of BUILT_IN_TOOLS) {this.toolRegistry.register(tool);}
    for (const tool of createHeadlessWebTools(this.webRuntime, {
      systemLocale: () => vscode.env.remoteName ? undefined : Intl.DateTimeFormat().resolvedOptions().locale,
      vscodeLanguage: () => vscode.env.language,
      searchRegion: () => this.settings.load().webSearchRegion,
      search: (query, _locale, limit, signal, options) => webClient.search(query, limit, signal, options),
    })) {
      this.toolRegistry.register(tool);
    }

    this.webviewProvider = new WebviewProvider(context.extensionUri, context, {
      historyManager: this.history,
      toolRegistry: this.toolRegistry,
      headlessWebRuntime: this.webRuntime,
      settings: this.settings,
      secrets: this.secrets,
      modelProviderFactory: new DeepSeekModelProviderFactory(),
      completions: this.completions,
    });
  }

  async initialize(): Promise<void> {
    await this.webviewProvider.initialize();
  }

  dispose(): void {
    this.webviewProvider.dispose();
  }
}
