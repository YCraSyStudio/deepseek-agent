import type * as vscode from "vscode";
import type { SettingsRepository } from "@/application/ports";
import type { ChatDraftRequest } from "@/contracts/ChatDraft";
import { ChatDraftStore } from "@/infrastructure/persistence/ChatDraftStore";
import { redactSensitiveText } from "@/shared/security/Redaction";

export class ChatDraftHandler {
  private readonly store = new ChatDraftStore();
  constructor(private readonly settings: SettingsRepository) {}
  async handle(message: ChatDraftRequest, view: vscode.WebviewView): Promise<void> {
    try {
      if (!this.settings.load().historyEnabled && message.operation !== "delete") {
        throw new Error("Draft persistence is disabled in incognito mode.");
      }
      const result = await this.store.handle(message);
      await view.webview.postMessage({ type: "chatDraftResult", requestId: message.requestId, ...result });
    } catch (error) {
      await view.webview.postMessage({ type: "chatDraftResult", requestId: message.requestId, error: redactSensitiveText(error) });
    }
  }
}
