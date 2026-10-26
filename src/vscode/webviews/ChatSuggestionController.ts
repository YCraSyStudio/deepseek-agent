import type * as vscode from "vscode";
import type { WebviewToHandlerMessage } from "@/contracts";
import type { CompletionService } from "@/vscode/completions/CompletionService";
import { logWarning } from "@/shared/logging/Logger";

type SuggestionMessage = Extract<WebviewToHandlerMessage, { type: "getChatSuggestion" | "cancelChatSuggestion" }>;

export class ChatSuggestionController {
  private active?: { requestId: string; controller: AbortController };

  constructor(private readonly service: CompletionService) {}

  handle(message: SuggestionMessage, view: vscode.WebviewView): void {
    if (message.type === "cancelChatSuggestion") {
      if (this.active?.requestId === message.requestId) {this.dispose();}
      return;
    }
    this.dispose();
    const active = { requestId: message.requestId, controller: new AbortController() };
    this.active = active;
    void (async () => {
      let text = "";
      try {text = await this.service.suggest("chat", message.prefix, "", active.controller.signal);}
      catch (error) {
        if (!active.controller.signal.aborted) {logWarning("[ChatCompletion] Suggestion unavailable", error);}
      }
      if (this.active !== active || active.controller.signal.aborted) {return;}
      this.active = undefined;
      await view.webview.postMessage({ type: "chatSuggestion", requestId: message.requestId, text });
    })().catch((error: unknown) => logWarning("[ChatCompletion] Could not deliver suggestion", error));
  }

  dispose(): void {
    this.active?.controller.abort();
    this.active = undefined;
  }
}
