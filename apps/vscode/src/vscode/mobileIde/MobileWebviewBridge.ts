import * as vscode from "vscode";

export type WebviewMessageSink = (message: unknown) => void;

/**
 * Stands in for the sidebar webview so remote clients can drive the real chat,
 * history and settings UI while the desktop view keeps working.
 */
export class MobileWebviewBridge {
  public readonly view: vscode.WebviewView;
  private target?: vscode.WebviewView;
  private readonly senders = new Set<WebviewMessageSink>();
  private readonly receivers = new Set<WebviewMessageSink>();
  private readonly disposables: vscode.Disposable[] = [];
  private webviewOptions: vscode.WebviewOptions = {};
  private page = "";
  private handshake?: unknown;
  private protocolReady = false;
  private readyMessage?: unknown;

  constructor() {
    const bridge = this;
    this.view = {
      webview: {
        postMessage: async (message: unknown) => bridge.publish(message),
        onDidReceiveMessage: (receiver: WebviewMessageSink) => bridge.subscribe(receiver),
        asWebviewUri: (uri: vscode.Uri) => bridge.target?.webview.asWebviewUri(uri) ?? uri,
        get cspSource() {
          return bridge.target?.webview.cspSource ?? "vscode-resource:";
        },
        get options() {
          return bridge.webviewOptions;
        },
        set options(value: vscode.WebviewOptions) {
          bridge.webviewOptions = value;
          if (bridge.target) { bridge.target.webview.options = value; }
        },
        get html() {
          return bridge.page;
        },
        set html(value: string) {
          bridge.page = value;
          if (bridge.target) { bridge.target.webview.html = value; }
        },
      },
      visible: true,
      onDidDispose: () => new vscode.Disposable(() => undefined),
      onDidChangeVisibility: () => new vscode.Disposable(() => undefined),
      show: () => undefined,
      title: "Chat",
      viewType: "deepseek-agent.chatView",
    } as unknown as vscode.WebviewView;
  }

  /** Binds the real sidebar view so desktop posts keep flowing. */
  public bind(target: vscode.WebviewView): vscode.WebviewView {
    this.unbind();
    this.target = target;
    target.webview.options = this.webviewOptions;
    this.disposables.push(
      target.webview.onDidReceiveMessage((message: unknown) => this.receive(message)),
      target.onDidDispose(() => {
        if (this.target === target) { this.target = undefined; }
      }),
    );
    return this.view;
  }

  public addSender(sender: WebviewMessageSink): vscode.Disposable {
    this.senders.add(sender);
    if (this.readyMessage) {
      sender(this.readyMessage);
    }
    return new vscode.Disposable(() => this.senders.delete(sender));
  }

  public receive(message: unknown): void {
    if (isHandshake(message)) {
      this.handshake = message;
      this.protocolReady = false;
      this.readyMessage = undefined;
    }
    this.dispatch(message);
  }

  private publish(message: unknown): boolean {
    this.trackProtocol(message);
    for (const sender of this.senders) {
      sender(message);
    }
    if (!this.target) { return true; }
    void this.target.webview.postMessage(message).then(undefined, () => {
      if (this.target) { this.target = undefined; }
    });
    return true;
  }

  private subscribe(receiver: WebviewMessageSink): vscode.Disposable {
    this.receivers.add(receiver);
    if (this.handshake && !this.protocolReady) {
      receiver(this.handshake);
    }
    return new vscode.Disposable(() => this.receivers.delete(receiver));
  }

  private trackProtocol(message: unknown): void {
    const type = readType(message);
    if (type === "protocolReady") {
      this.protocolReady = true;
      this.readyMessage = message;
    } else if (type === "protocolError") {
      this.protocolReady = false;
      this.readyMessage = undefined;
    }
  }

  private dispatch(message: unknown): void {
    for (const receiver of this.receivers) {
      receiver(message);
    }
  }

  private unbind(): void {
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      void disposable?.dispose();
    }
    this.target = undefined;
  }
}

function isHandshake(message: unknown): boolean {
  return readType(message) === "initializeProtocol";
}

function readType(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) {
    return undefined;
  }
  const type = (message as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}
