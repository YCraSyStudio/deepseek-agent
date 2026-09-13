import * as vscode from "vscode";
import type { ContextWindowStatus, WebviewToHandlerMessage } from "@/contracts";
import type { StoredConversation } from "@/application/chat/ProviderTranscript";
import { toPresentationConversation } from "@/application/chat/ProviderTranscript";
import { HistoryManager } from "@/vscode/storage";
import { logWarning } from "@/shared/logging/Logger";
import { summarizeConversationUsage } from "@/shared/usage/Usage";

const HISTORY_PAGE_MESSAGES = 200;
const HISTORY_PAGE_BYTES = 4 * 1024 * 1024;

export class HistoryHandler {
  constructor(
    private readonly historyManager: HistoryManager,
    private readonly onConversationLoaded?: (conversation: StoredConversation) => ContextWindowStatus | undefined,
    private readonly onConversationDeleted?: (id: string) => void,
    private readonly onBeforeConversationDelete?: (id: string) => Promise<void>,
    private readonly onConversationPermanentlyDeleted?: (conversation: StoredConversation) => Promise<void>,
  ) {}

  handle(message: WebviewToHandlerMessage, webviewView: vscode.WebviewView): void {
    switch (message.type) {
      case "getHistory":
        void this.run(() => this.getHistory(webviewView), webviewView);
        break;
      case "deleteConversation":
        void this.run(() => this.deleteConversation(message.id, webviewView), webviewView);
        break;
      case "deleteConversations":
        void this.run(() => this.deleteConversations(message.ids, webviewView), webviewView);
        break;
      case "loadConversation":
        void this.run(() => this.loadConversation(message.requestId, message.id, webviewView), webviewView, message.requestId);
        break;
      case "loadConversationPage":
        void this.run(() => this.loadConversationPage(message.requestId, message.id, message.cursor, webviewView), webviewView, message.requestId);
        break;
      default:
        logWarning(`[HistoryHandler] Unknown message: ${message.type}`);
    }
  }

  private async getHistory(webviewView: vscode.WebviewView): Promise<void> {
    const conversations = await this.historyManager.getSummaries();
    await webviewView.webview.postMessage({ type: "history", conversations });
  }

  private async deleteConversation(id: string, webviewView: vscode.WebviewView): Promise<void> {
    const deleted = await this.historyManager.getById(id);
    if (!deleted) {
      await this.getHistory(webviewView);
      return;
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Delete conversation "${deleted.title}"?`,
      { modal: true, detail: "You can undo the deletion immediately afterwards." },
      "Delete",
    );
    if (confirmation !== "Delete") {
      return;
    }
    await this.onBeforeConversationDelete?.(id);
    if (!await this.historyManager.delete(id, deleted.updatedAt)) {
      await webviewView.webview.postMessage({ type: "historyError", error: "The conversation changed in another window and was not deleted." });
      await this.getHistory(webviewView);
      return;
    }
    this.onConversationDeleted?.(id);
    await webviewView.webview.postMessage({ type: "conversationDeleted", id });
    await this.getHistory(webviewView);
    if ((await vscode.window.showInformationMessage("Conversation deleted.", "Undo")) === "Undo") {
      const restored = await this.historyManager.saveIfAbsent(deleted);
      if (!restored) {
        await webviewView.webview.postMessage({ type: "historyError", error: "Undo was skipped because a newer conversation with the same ID exists." });
        await this.onConversationPermanentlyDeleted?.(deleted);
      }
      await this.getHistory(webviewView);
    } else {
      await this.onConversationPermanentlyDeleted?.(deleted);
    }
  }

  private async run(operation: () => Promise<void>, webviewView: vscode.WebviewView, requestId?: string): Promise<void> {
    try {
      await operation();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning(`[HistoryHandler] ${message}`);
      await webviewView.webview.postMessage({ type: "historyError", requestId, error: message });
    }
  }

  private async deleteConversations(ids: string[], webviewView: vscode.WebviewView): Promise<void> {
    const deleted = (await Promise.all(ids.map((id) => this.historyManager.getById(id)))).filter(
      (item): item is StoredConversation => item !== undefined,
    );
    if (deleted.length === 0) {
      await this.getHistory(webviewView);
      return;
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Delete ${deleted.length} conversation(s)?`,
      { modal: true, detail: "You can undo the deletion immediately afterwards." },
      "Delete all",
    );
    if (confirmation !== "Delete all") {
      return;
    }
    await Promise.all(ids.map((id) => this.onBeforeConversationDelete?.(id)));
    const deletedIds = await this.historyManager.deleteMany(deleted.map((conversation) => ({ id: conversation.id, expectedUpdatedAt: conversation.updatedAt })));
    await Promise.all(deletedIds.map(async (id) => {
      this.onConversationDeleted?.(id);
      await webviewView.webview.postMessage({ type: "conversationDeleted", id });
    }));
    await this.getHistory(webviewView);
    if (deleted.length > 0 && (await vscode.window.showInformationMessage(`${deleted.length} conversation(s) deleted.`, "Undo")) === "Undo") {
      const restored = await Promise.all(deleted
        .filter((conversation) => deletedIds.includes(conversation.id))
        .map(async (conversation) => ({ conversation, restored: await this.historyManager.saveIfAbsent(conversation) })));
      await Promise.all(restored
        .filter((result) => !result.restored)
        .map((result) => this.onConversationPermanentlyDeleted?.(result.conversation)));
      await this.getHistory(webviewView);
    } else {
      await Promise.all(deleted
        .filter((conversation) => deletedIds.includes(conversation.id))
        .map((conversation) => this.onConversationPermanentlyDeleted?.(conversation)));
    }
  }

  private async loadConversation(requestId: string, id: string, webviewView: vscode.WebviewView): Promise<void> {
    const conversation = await this.historyManager.getById(id);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const contextWindow = this.onConversationLoaded?.(conversation);
    const presentation = toPresentationConversation(conversation);
    const page = createHistoryPage(presentation.messages, presentation.messages.length);
    await webviewView.webview.postMessage({
      type: "conversationLoaded",
      requestId,
      usage: summarizeConversationUsage(presentation.messages),
      contextWindow,
      conversation: {
        ...presentation,
        messages: page.messages,
        hasEarlierMessages: page.hasEarlierMessages,
        historyCursor: page.cursor,
      },
    });
  }

  private async loadConversationPage(requestId: string, id: string, cursor: string, webviewView: vscode.WebviewView): Promise<void> {
    const conversation = await this.historyManager.getById(id);
    if (!conversation) {throw new Error("Conversation not found");}
    const end = decodeHistoryCursor(cursor);
    if (end === undefined || end > conversation.messages.length) {
      throw new Error("Invalid conversation history cursor");
    }
    const page = createHistoryPage(toPresentationConversation(conversation).messages, end);
    await webviewView.webview.postMessage({
      type: "conversationPageLoaded",
      requestId,
      id,
      messages: page.messages,
      hasEarlierMessages: page.hasEarlierMessages,
      cursor: page.cursor,
    });
  }
}

function createHistoryPage(messages: ReturnType<typeof toPresentationConversation>["messages"], end: number) {
  const selected = [] as typeof messages;
  let bytes = 0;
  let start = end;
  while (start > 0 && selected.length < HISTORY_PAGE_MESSAGES) {
    const message = messages[start - 1]!;
    const messageBytes = Buffer.byteLength(JSON.stringify(message), "utf8");
    if (selected.length > 0 && bytes + messageBytes > HISTORY_PAGE_BYTES) {break;}
    selected.unshift(message);
    bytes += messageBytes;
    start -= 1;
  }
  return {
    messages: selected,
    hasEarlierMessages: start > 0,
    cursor: start > 0 ? Buffer.from(String(start), "utf8").toString("base64url") : undefined,
  };
}

function decodeHistoryCursor(cursor: string): number | undefined {
  try {
    const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
