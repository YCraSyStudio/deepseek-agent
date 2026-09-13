import type * as vscode from "vscode";
import type { WebviewToHandlerMessage } from "@/contracts";

type MessageType = WebviewToHandlerMessage["type"];
type MessageOfType<TType extends MessageType> = Extract<WebviewToHandlerMessage, { type: TType }>;
type CommandHandler<TType extends MessageType> = (
  message: MessageOfType<TType>,
  webviewView: vscode.WebviewView,
) => void;

export class WebviewCommandDispatcher {
  private readonly handlers = new Map<MessageType, CommandHandler<MessageType>>();

  register<TType extends MessageType>(type: TType, handler: CommandHandler<TType>): void {
    if (this.handlers.has(type)) {
      throw new Error(`A webview command handler is already registered for ${type}`);
    }
    this.handlers.set(type, handler as unknown as CommandHandler<MessageType>);
  }

  registerMany<TType extends MessageType>(
    types: readonly TType[],
    handler: CommandHandler<TType>,
  ): void {
    for (const type of types) {this.register(type, handler);}
  }

  dispatch(message: WebviewToHandlerMessage, webviewView: vscode.WebviewView): boolean {
    const handler = this.handlers.get(message.type);
    if (!handler) {return false;}
    handler(message, webviewView);
    return true;
  }
}
