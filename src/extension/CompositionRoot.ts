import { NativeCaptureBackend } from "@/infrastructure/capture/NativeCaptureBackend";
import { NativeDebugAnchor } from "@/vscode/tools/capture/NativeDebugAnchor";
import { registerCaptureBackend } from "@/infrastructure/capture/CaptureService";
import { WebCaptureBackend } from "@/vscode/tools/capture/WebCaptureBackend";
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

export class ExtensionCompositionRoot implements vscode.Disposable {
  readonly settings = new VsCodeSettingsRepository();
  readonly secrets: VsCodeSecretStore;
  readonly history: HistoryManager;
  readonly webRuntime: HeadlessWebRuntime;
  readonly toolRegistry: ToolRegistry;
  readonly webviewProvider: WebviewProvider;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = new VsCodeSecretStore(context);
    this.history = new HistoryManager(this.settings);
    registerCaptureBackend("web", new WebCaptureBackend(this.settings));
    const debugAnchor = new NativeDebugAnchor();
    context.subscriptions.push(debugAnchor);
    const nativeCapture = new NativeCaptureBackend(() => debugAnchor.pid());
    const desktopCapture = { capture: (request: Parameters<NativeCaptureBackend["capture"]>[0], signal: AbortSignal) => {
      if (vscode.env.remoteName || vscode.env.uiKind !== vscode.UIKind.Desktop) {throw new Error("Native capture requires a local desktop extension host; remote workspaces cannot capture the UI machine");}
      return nativeCapture.capture(request, signal);
    }};
    for (const target of ["window", "debug", "screen"] as const) {registerCaptureBackend(target, desktopCapture);}
    const webClient = new DeepSeekWebClient(async () => {
      const config = this.settings.load();
      if (!config.webSearchEnabled) {throw new Error("Web search is disabled in settings.");}
      return { baseUrl: config.baseUrl, apiKey: await this.secrets.getApiKey(config.baseUrl) ?? "" };
    });
    this.webRuntime = new HeadlessWebRuntime(webClient);
    configureWebRuntimeDiagnostics(this.webRuntime);

    this.toolRegistry = new ToolRegistry();
    for (const tool of BUILT_IN_TOOLS) {this.toolRegistry.register(tool);}
    for (const tool of createHeadlessWebTools(this.webRuntime, {
      systemLocale: () => Intl.DateTimeFormat().resolvedOptions().locale,
      vscodeLanguage: () => vscode.env.language,
      search: (query, _locale, limit, signal) => webClient.search(query, limit, signal),
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
    });
  }

  async initialize(): Promise<void> {
    await this.webviewProvider.initialize();
  }

  dispose(): void {
    this.webviewProvider.dispose();
  }
}
