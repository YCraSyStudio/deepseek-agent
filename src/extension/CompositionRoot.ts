import * as vscode from "vscode";
import type { AppConfig } from "@/contracts";
import { ToolRegistry } from "@/application/tools";
import { createHeadlessWebTools } from "@/infrastructure/browser/BrowserTools";
import { HeadlessWebRuntime } from "@/infrastructure/browser/HeadlessWebRuntime";
import { configureSearxngEngineSelection, fetchSearxngEngines } from "@/infrastructure/browser/SearxngSearch";
import { BUILT_IN_TOOLS } from "@/infrastructure/tools/builtins";
import { configureWebRuntimeDiagnostics } from "@/vscode/tools/browser/Diagnostics";
import { SearxngManager } from "@/vscode/tools/browser/SearxngManager";
import {
  HistoryManager,
  SettingsManager,
} from "@/vscode/storage";
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
  readonly searxngManager: SearxngManager;
  readonly webRuntime: HeadlessWebRuntime;
  readonly toolRegistry: ToolRegistry;
  readonly webviewProvider: WebviewProvider;
  private readonly disposables: vscode.Disposable[];
  private searxngConfigKey?: string;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = new VsCodeSecretStore(context);
    this.history = new HistoryManager(this.settings);
    this.searxngManager = new SearxngManager(context);
    configureSearxngEngineSelection(() => this.settings.load().searxngEngines);
    this.webRuntime = new HeadlessWebRuntime();
    configureWebRuntimeDiagnostics(this.webRuntime, this.settings);

    this.toolRegistry = new ToolRegistry();
    for (const tool of BUILT_IN_TOOLS) {this.toolRegistry.register(tool);}
    for (const tool of createHeadlessWebTools(this.webRuntime, {
      systemLocale: () => Intl.DateTimeFormat().resolvedOptions().locale,
      vscodeLanguage: () => vscode.env.language,
      resolveSearxngUrl: () => this.searxngManager.resolve(this.settings.load().searxngUrl),
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
    const unsubscribeSettings = SettingsManager.onDidChange((config) => this.syncSearxng(config));
    this.disposables = [
      { dispose: unsubscribeSettings },
      this.searxngManager,
      ...registerSearxngCommands(this.searxngManager, this.settings),
    ];
    context.subscriptions.push(...this.disposables);
  }

  async initialize(): Promise<void> {
    await this.webviewProvider.initialize();
    this.syncSearxng(this.settings.load());
  }

  dispose(): void {
    this.webviewProvider.dispose();
  }

  private syncSearxng(config: AppConfig): void {
    const key = JSON.stringify({
      enabled: config.webSearchEnabled,
      endpoint: config.searxngUrl,
    });
    if (key === this.searxngConfigKey) {return;}
    this.searxngConfigKey = key;
    void this.searxngManager.sync(config).then(
      () => this.refreshSearxngEngineCatalog(config),
      async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        await vscode.window.showWarningMessage(`SearXNG runtime could not synchronize with settings: ${message}`);
      },
    );
  }

  private async refreshSearxngEngineCatalog(config: AppConfig): Promise<void> {
    if (!config.webSearchEnabled) {return;}
    try {
      const endpoint = await this.searxngManager.resolve(config.searxngUrl);
      const catalog = await fetchSearxngEngines(endpoint);
      const current = this.settings.load().searxngEngineCatalog;
      if (JSON.stringify(current) === JSON.stringify(catalog)) {return;}
      await this.settings.save({ searxngEngineCatalog: catalog });
    } catch {
    }
  }
}

function registerSearxngCommands(
  searxngManager: SearxngManager,
  settings: VsCodeSettingsRepository,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("deepseek-agent.startSearxng", async () => {
      const endpoint = await searxngManager.resolve(settings.load().searxngUrl);
      await vscode.window.showInformationMessage(`SearXNG is running at ${endpoint}`);
    }),
    vscode.commands.registerCommand("deepseek-agent.stopSearxng", async () => {
      await searxngManager.stopManaged();
      await vscode.window.showInformationMessage("Managed SearXNG stopped.");
    }),
  ];
}
