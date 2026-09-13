import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { ChatHandler } from "./handlers/chat/ChatHandler";
import { SettingsHandler } from "./handlers/SettingsHandler";
import { HistoryHandler } from "./handlers/HistoryHandler";
import { getDevViewContent } from "./utils/DevViewRenderer";
import { getHtmlContent } from "./utils/HtmlRenderer";
import { HistoryManager } from "@/vscode/storage";
import { getPathCompletionItems, insertCodeIntoActiveEditor, openWorkspaceFile } from "@/vscode/editor/EditorActions";
import { CHAT_VIEW_TYPE, SIDEBAR_VIEW_ID } from "@/shared/constants";
import { logWarning } from "@/shared/logging/Logger";
import { getErrorMessage } from "@/shared/utils/Errors";
import type { ReferencedFile, ReferencedFilePayload, WebviewToHandlerMessage } from "@/contracts";
import { ChangeDiffViewer } from "@/vscode/editor/diff/ChangeDiffViewer";
import type { ToolRegistry } from "@/application/tools";
import type { HeadlessWebRuntime } from "@/infrastructure/browser/HeadlessWebRuntime";
import { WebviewCommandDispatcher } from "./WebviewCommandDispatcher";
import type { ModelProviderFactory, SecretStore, SettingsRepository } from "@/application/ports";
import { ImageAttachmentController } from "./ImageAttachmentController";
import { AttachmentSelectionController } from "./AttachmentSelectionController";
import { registerWebviewProtocol } from "./WebviewProtocolSession";

type ChatCommandMessage = { type: "addReferencedFiles"; files: ReferencedFilePayload[] } | { type: "setDraft"; text: string };
const MAX_PENDING_WEBVIEW_MESSAGES = 128;
const MAX_PENDING_WEBVIEW_BYTES = 8 * 1024 * 1024;

export interface WebviewProviderDependencies {
  historyManager: HistoryManager;
  toolRegistry: ToolRegistry;
  headlessWebRuntime: HeadlessWebRuntime;
  settings: SettingsRepository;
  secrets: SecretStore;
  modelProviderFactory: ModelProviderFactory;
}

export class WebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = CHAT_VIEW_TYPE;

  private readonly chatHandler: ChatHandler;
  private readonly settingsHandler: SettingsHandler;
  private readonly historyHandler: HistoryHandler;
  private readonly historyManager: HistoryManager;
  private readonly settings: SettingsRepository;
  private readonly changeDiffViewer: ChangeDiffViewer;
  private readonly imageAttachments: ImageAttachmentController;
  private readonly attachmentSelection: AttachmentSelectionController;
  private readonly commandDispatcher = new WebviewCommandDispatcher();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingMessages: ChatCommandMessage[] = [];
  private viewDisposables: vscode.Disposable[] = [];
  private webviewView?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    dependencies: WebviewProviderDependencies,
  ) {
    this.historyManager = dependencies.historyManager;
    this.settings = dependencies.settings;
    this.changeDiffViewer = new ChangeDiffViewer();
    this.imageAttachments = new ImageAttachmentController(this._context, dependencies.settings, dependencies.secrets);
    this.disposables.push(this.changeDiffViewer);
    this.chatHandler = new ChatHandler(
      this._context,
      this.historyManager,
      dependencies.toolRegistry,
      dependencies.headlessWebRuntime,
      dependencies.settings,
      dependencies.secrets,
      dependencies.modelProviderFactory,
    );
    this.settingsHandler = new SettingsHandler(
      this._context,
      this.chatHandler,
      dependencies.settings,
      dependencies.secrets,
      dependencies.modelProviderFactory,
    );
    this.attachmentSelection = new AttachmentSelectionController({
      chatHandler: this.chatHandler,
      imageAttachments: this.imageAttachments,
    });
    this.historyHandler = new HistoryHandler(
      this.historyManager,
      (conversation) => this.chatHandler.loadConversation(conversation),
      (id) => {
        if (this.chatHandler.forgetConversation(id)) {
          void this.webviewView?.webview.postMessage({ type: "clearChat" });
        }
      },
      (id) => this.chatHandler.prepareConversationDeletion(id),
      async (conversation) => {
        const attachments = conversation.messages.flatMap((message) => message.imageAttachments ?? []);
        await Promise.allSettled(attachments.map((attachment) => this.imageAttachments.delete(attachment)));
      },
    );
    this.registerMessageHandlers();
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void this.chatHandler.handleWorkspaceFoldersChanged();
    }));

  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.disposeViewRegistrations();
    this.settingsHandler.handleWebviewRecreation();
    await this.chatHandler.discardIncognitoForWebviewRecreation();
    this.webviewView = webviewView;
    this.chatHandler.attachWebview(webviewView);
    const webviewDistUri = vscode.Uri.joinPath(this._extensionUri, "dist", "webview");
    const codiconsDistUri = vscode.Uri.joinPath(this._extensionUri, "node_modules", "@vscode", "codicons", "dist");
    const devServerUrl = process.env.DEEPSEEK_AGENT_WEBVIEW_DEV_SERVER;
    const codiconFontUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(codiconsDistUri, "codicon.ttf"));

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: devServerUrl
        ? [webviewDistUri, codiconsDistUri, this.imageAttachments.cacheRoot]
        : [webviewDistUri, this.imageAttachments.cacheRoot],
      portMapping: [
        {
          webviewPort: 5175,
          extensionHostPort: 5175,
        },
      ],
    };

    const useDevServer = devServerUrl ? await this.isDevServerAvailable(devServerUrl) : false;
    webviewView.webview.html =
      devServerUrl && useDevServer
        ? getDevViewContent({ webview: webviewView.webview, devServerUrl, codiconFontUri })
        : getHtmlContent(webviewView.webview, webviewDistUri);

    this.viewDisposables.push(registerWebviewProtocol(webviewView, (message) => this._routeMessage(message, webviewView)));
    this.viewDisposables.push(webviewView.onDidDispose(() => {
      if (this.webviewView === webviewView) {
        this.webviewView = undefined;
      }
      this.chatHandler.detachWebview(webviewView);
      this.disposeViewRegistrations();
    }));

    await this.flushPendingMessages();
  }

  public dispose(): void {
    this.disposeViewRegistrations();
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    this.webviewView = undefined;
  }

  public async initialize(): Promise<void> {
    try {
      await this.historyManager.initialize();
    } catch (error: unknown) {
      this.settings.enterDegradedMode(error);
      await vscode.window.showWarningMessage(
        "YCraSy DeepSeek Agent could not initialize persistent storage. Chat remains available in incognito mode; check access to the extension data directory and reload VS Code.",
      );
    }
    await this.chatHandler.initialize();
  }

  private disposeViewRegistrations(): void {
    const registrations = this.viewDisposables;
    this.viewDisposables = [];
    for (const registration of registrations) {
      registration.dispose();
    }
  }

  public async shutdown(): Promise<void> {
    await this.chatHandler.shutdown();
    this.dispose();
  }

  public async addReferencedFiles(files: ReferencedFilePayload[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    this.chatHandler.registerExternalContextFiles(files as ReferencedFile[]);
    await this.postToChat({ type: "addReferencedFiles", files });
  }

  public async setDraft(text: string): Promise<void> {
    await this.postToChat({ type: "setDraft", text });
  }

  public async startNewChat(): Promise<void> {
    await this.revealChat();
    if (this.webviewView) {
      this.chatHandler.handle({ type: "newConversation", requestId: randomUUID() }, this.webviewView);
      await this.webviewView.webview.postMessage({ type: "clearChat" });
      await this.webviewView.webview.postMessage({ type: "setDraft", text: "" });
    }
  }

  private async postToChat(message: ChatCommandMessage): Promise<void> {
    await this.revealChat();

    if (!this.webviewView) {
      const pendingBytes = this.pendingMessages.reduce(
        (total, item) => total + Buffer.byteLength(JSON.stringify(item), "utf8"),
        0,
      );
      const messageBytes = Buffer.byteLength(JSON.stringify(message), "utf8");
      if (this.pendingMessages.length >= MAX_PENDING_WEBVIEW_MESSAGES || pendingBytes + messageBytes > MAX_PENDING_WEBVIEW_BYTES) {
        throw new Error("Webview message queue resource limit reached");
      }
      this.pendingMessages.push(message);
      return;
    }

    await this.webviewView.webview.postMessage(message);
  }

  private async revealChat(): Promise<void> {
    await vscode.commands.executeCommand(SIDEBAR_VIEW_ID);
  }

  private async flushPendingMessages(): Promise<void> {
    if (!this.webviewView || this.pendingMessages.length === 0) {
      return;
    }

    const messages = this.pendingMessages.splice(0);
    for (const message of messages) {
      await this.webviewView.webview.postMessage(message);
    }
  }

  private async isDevServerAvailable(devServerUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 750);
      try {
        const response = await fetch(devServerUrl, { signal: controller.signal });
        return response.ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      logWarning(`[WebviewProvider] Webview dev server unavailable at ${devServerUrl}; falling back to built webview.`);
      return false;
    }
  }

  private _routeMessage(message: WebviewToHandlerMessage, webviewView: vscode.WebviewView): void {
    if (!this.commandDispatcher.dispatch(message, webviewView)) {
      logWarning(`[WebviewProvider] No handler registered for message type ${message.type}`);
    }
  }

  private registerMessageHandlers(): void {
    this.commandDispatcher.registerMany([
      "sendMessage", "steerGeneration", "cancelGeneration", "getGenerationSnapshot",
      "consumeRecoveredDraft", "getAvailableTools", "executeToolCall",
      "newConversation", "getWorkspaceContext", "rebindConversationWorkspace", "openConversationWorkspace",
    ] as const, (message, view) => this.chatHandler.handle(message, view));
    this.commandDispatcher.registerMany([
      "getConfig", "saveConfig", "resetConfig", "resolveHistoryTransition", "deleteApiKey", "testConnection",
    ] as const, (message, view) => this.settingsHandler.handle(message, view));
    this.commandDispatcher.registerMany([
      "getHistory", "deleteConversation", "deleteConversations", "loadConversation", "loadConversationPage",
    ] as const, (message, view) => this.historyHandler.handle(message, view));

    this.commandDispatcher.register("selectAttachments", (message, view) => {
      void this.attachmentSelection.select(message.requestId, message.conversationId, view);
    });
    this.commandDispatcher.register("uploadClipboardImage", (message, view) => {
      void this.imageAttachments.uploadClipboard(view.webview, message).then(
        (attachment) => view.webview.postMessage({ type: "imageAttachmentsSelected", requestId: message.requestId, attachments: [attachment] }),
        (error: unknown) => view.webview.postMessage({ type: "imageAttachmentsSelected", requestId: message.requestId, attachments: [], error: getErrorMessage(error) }),
      );
    });
    this.commandDispatcher.register("deleteImageAttachment", (message, view) => {
      void this.imageAttachments.delete(message.attachment).then(
        () => view.webview.postMessage({ type: "imageAttachmentDeleted", requestId: message.requestId, fileId: message.attachment.fileId, success: true }),
        (error: unknown) => view.webview.postMessage({ type: "imageAttachmentDeleted", requestId: message.requestId, fileId: message.attachment.fileId, success: false, error: getErrorMessage(error) }),
      );
    });
    this.commandDispatcher.register("getPathCompletions", (message, view) => {
      void this.handlePathCompletions(message, view);
    });
    this.commandDispatcher.register("copyCode", (message) => {
      void vscode.env.clipboard.writeText(message.code);
    });
    this.commandDispatcher.register("insertCode", (message) => {
      void this.withWorkspaceBinding(message.conversationId, message.workspaceRevision, (binding) =>
        insertCodeIntoActiveEditor(message.code, binding));
    });
    this.commandDispatcher.register("selectModel", (message, view) => {
      void view.webview.postMessage({ type: "modelChanged", modelId: message.modelId });
    });
    this.commandDispatcher.register("openFile", (message) => {
      void this.withWorkspaceBinding(message.conversationId, message.workspaceRevision, (binding) =>
        openWorkspaceFile(message.path, binding, message.line));
    });
    this.commandDispatcher.register("openFileDiff", (message) => {
      void this.withWorkspaceBinding(message.conversationId, message.workspaceRevision, (binding) =>
        this.changeDiffViewer.open(
          {
            path: message.path,
            diff: message.diff,
            beforeHash: message.beforeHash,
            afterHash: message.afterHash,
            preview: message.preview,
          },
          binding,
        ));
    });
  }

  private async handlePathCompletions(
    message: Extract<WebviewToHandlerMessage, { type: "getPathCompletions" }>,
    webviewView: vscode.WebviewView,
  ): Promise<void> {
    const context = await this.chatHandler.getWorkspaceContext(message.conversationId);
    const items = context.state === "connected" && (!message.workspaceRevision || message.workspaceRevision === context.binding.revision)
      ? await getPathCompletionItems(message.query, context.binding)
      : [];
    await webviewView.webview.postMessage({
      type: "pathCompletions",
      requestId: message.requestId,
      query: message.query,
      workspaceRevision: context.binding.revision,
      items,
    });
  }

  private async withWorkspaceBinding(
    conversationId: string | undefined,
    workspaceRevision: string | undefined,
    operation: (binding: Awaited<ReturnType<ChatHandler["getWorkspaceContext"]>>["binding"]) => Promise<void>,
  ): Promise<void> {
    const context = await this.chatHandler.getWorkspaceContext(conversationId);
    if (context.state !== "connected" || (workspaceRevision && workspaceRevision !== context.binding.revision)) {
      await vscode.window.showErrorMessage("The chat workspace is no longer connected or has changed.");
      return;
    }
    await operation(context.binding);
  }

}

