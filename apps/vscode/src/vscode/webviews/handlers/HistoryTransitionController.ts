import * as vscode from "vscode";
import type { AppConfig } from "@/contracts";
import type { SettingsRepository } from "@/application/ports";
import { toWebviewConfig } from "@/vscode/webviews/WebviewConfig";
import { redactSensitiveText } from "@/shared/security/Redaction";
import type { ChatHandler } from "./chat/ChatHandler";

type HistoryTransitionOperation = "save" | "reset";
type HistoryTransitionDecision = "stop" | "save" | "discard" | "cancel";

interface PendingHistoryTransition {
  requestId: string;
  operation: HistoryTransitionOperation;
  targetEnabled: boolean;
  phase: "stop-work" | "exit-incognito";
  config?: Partial<AppConfig>;
  webviewView: vscode.WebviewView;
  resolving?: boolean;
}

export interface HistoryTransitionRequest {
  requestId: string;
  operation: HistoryTransitionOperation;
  targetEnabled: boolean;
  config?: Partial<AppConfig>;
  webviewView: vscode.WebviewView;
}

interface HistoryTransitionControllerDependencies {
  chatHandler: ChatHandler;
  settings: SettingsRepository;
  postUpdateResult: (
    webviewView: vscode.WebviewView,
    requestId: string,
    operation: HistoryTransitionOperation,
    status: "success" | "error" | "cancelled",
    error?: string,
  ) => Promise<void>;
}

export class HistoryTransitionController {
  private pending?: PendingHistoryTransition;

  constructor(private readonly dependencies: HistoryTransitionControllerDependencies) {}

  handleWebviewRecreation(): void {
    if (!this.pending) {
      return;
    }
    this.dependencies.chatHandler.cancelHistoryTransition(this.pending.requestId);
    this.pending = undefined;
  }

  async request(request: HistoryTransitionRequest): Promise<void> {
    const pending: PendingHistoryTransition = { ...request, phase: "stop-work" };
    const counts = this.dependencies.chatHandler.beginHistoryTransition(
      pending.requestId,
      pending.targetEnabled ? "exit-incognito" : "enter-incognito",
    );
    if (!counts) {
      await this.postResult(pending, "error", "Another incognito-mode change is already pending.");
      return;
    }
    this.pending = pending;
    if (counts.activeGenerations > 0 || counts.queuedMessages > 0) {
      await this.postTransitionRequired(pending, counts);
      return;
    }
    await this.continueWithoutWork(pending);
  }

  async resolve(
    requestId: string,
    decision: HistoryTransitionDecision,
    webviewView: vscode.WebviewView,
  ): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.requestId !== requestId || pending.webviewView !== webviewView) {
      return;
    }
    if (pending.resolving) {
      return;
    }
    pending.resolving = true;

    if (decision === "cancel") {
      this.pending = undefined;
      this.dependencies.chatHandler.cancelHistoryTransition(requestId);
      await this.postResult(pending, "cancelled");
      return;
    }
    if (pending.phase === "stop-work") {
      if (decision !== "stop") {
        pending.resolving = false;
        return;
      }
      if (!pending.targetEnabled) {
        await this.commitEnterIncognito(pending);
        return;
      }
      await this.dependencies.chatHandler.stopPendingWork();
      await this.continueWithoutWork(pending);
      return;
    }
    if (decision === "save" || decision === "discard") {
      await this.commitExitIncognito(pending, decision);
    } else {
      pending.resolving = false;
    }
  }

  private async continueWithoutWork(pending: PendingHistoryTransition): Promise<void> {
    if (!pending.targetEnabled) {
      await this.commitEnterIncognito(pending);
      return;
    }
    if (this.dependencies.chatHandler.hasIncognitoMessages()) {
      pending.phase = "exit-incognito";
      pending.resolving = false;
      this.dependencies.chatHandler.setHistoryTransitionPhase("exit-incognito");
      await this.postTransitionRequired(pending, { activeGenerations: 0, queuedMessages: 0 });
      return;
    }
    await this.commitExitIncognito(pending, "discard");
  }

  private async commitEnterIncognito(pending: PendingHistoryTransition): Promise<void> {
    try {
      await this.persist(pending);
      await pending.webviewView.webview.postMessage({
        type: "configLoaded",
        revision: this.dependencies.settings.getRevision(),
        config: toWebviewConfig(this.dependencies.settings.load()),
      });
      await this.dependencies.chatHandler.enterIncognito(pending.requestId);
      this.pending = undefined;
      await this.postResult(pending, "success");
    } catch (error: unknown) {
      this.pending = undefined;
      this.dependencies.chatHandler.cancelHistoryTransition(pending.requestId);
      await this.postResult(pending, "error", redactSensitiveText(error));
    }
  }

  private async commitExitIncognito(
    pending: PendingHistoryTransition,
    decision: "save" | "discard",
  ): Promise<void> {
    try {
      await this.persist(pending);
      if (decision === "save") {
        await this.dependencies.chatHandler.promoteIncognito(pending.requestId);
      } else {
        this.dependencies.chatHandler.discardIncognito(pending.requestId);
      }
      this.pending = undefined;
      await this.postResult(pending, "success");
    } catch (error: unknown) {
      await this.dependencies.settings.save({ historyEnabled: false }).catch(() => undefined);
      this.pending = undefined;
      this.dependencies.chatHandler.cancelHistoryTransition(pending.requestId);
      await this.postResult(pending, "error", redactSensitiveText(error));
    }
  }

  private async persist(pending: PendingHistoryTransition): Promise<void> {
    if (pending.operation === "reset") {
      await this.dependencies.settings.reset();
      return;
    }
    await this.dependencies.settings.save({ ...pending.config, apiKey: undefined });
  }

  private async postTransitionRequired(
    pending: PendingHistoryTransition,
    counts: { activeGenerations: number; queuedMessages: number },
  ): Promise<void> {
    await pending.webviewView.webview.postMessage({
      type: "historyTransitionRequired",
      requestId: pending.requestId,
      phase: pending.phase,
      direction: pending.targetEnabled ? "exit-incognito" : "enter-incognito",
      ...counts,
    });
  }

  private postResult(
    pending: PendingHistoryTransition,
    status: "success" | "error" | "cancelled",
    error?: string,
  ): Promise<void> {
    return this.dependencies.postUpdateResult(
      pending.webviewView,
      pending.requestId,
      pending.operation,
      status,
      error,
    );
  }
}
