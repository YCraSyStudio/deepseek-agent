import * as vscode from "vscode";
import type { AppConfig, ToolDefinition, WorkspaceBinding } from "@/contracts";
import { GOAL_STORAGE_KEY } from "@/shared/constants";
import { ConversationState } from "@/application/chat/ConversationState";
import { captureWorkspaceRunSnapshot, type WorkspaceRunSnapshot } from "@/vscode/workspace";
import { loadProjectInstructions } from "@/vscode/configuration/ProjectInstructions";
import type { SecretStore, SettingsRepository } from "@/application/ports";
import { toWebviewConfig } from "../../../WebviewConfig";
import { buildGitReviewContext } from "../prompt/FileContext";
import type { SendMessagePayload } from "../Types";
import type { ToolRegistry } from "@/application/tools";
import {
  isPermissionMode,
  parseSlashCommand,
} from "./SlashCommandParsing";

export interface SlashCommandServiceOptions {
  context: vscode.ExtensionContext;
  conversationState: ConversationState;
  toolRegistry: ToolRegistry;
  getWorkspaceBinding: (conversationId?: string) => Promise<WorkspaceBinding>;
  getSelectedConversationId: () => string | undefined;
  settings: SettingsRepository;
  secrets: SecretStore;
}

export class SlashCommandService {
  constructor(private readonly options: SlashCommandServiceOptions) {}

  async handle(payload: SendMessagePayload, config: AppConfig, webviewView: vscode.WebviewView): Promise<boolean> {
    const command = parseSlashCommand(payload.text);
    if (!command) {
      return false;
    }

    switch (command.name) {
      case "status":
        this.postTurn(webviewView, payload.text, await this.buildStatus(config));
        return true;
      case "tools":
        this.postTurn(webviewView, payload.text, this.buildTools(config));
        return true;
      case "mode":
        await this.handleMode(command.args, payload.text, webviewView);
        return true;
      case "auto-context":
        await this.handleAutoContext(command.args, payload.text, webviewView);
        return true;
      case "review":
        this.postTurn(webviewView, payload.text, await buildGitReviewContext(await this.getWorkspaceSnapshot(payload)));
        return true;
      case "goal":
        await this.handleGoal(command.args, payload.text, webviewView);
        return true;
      case "summarize":
        this.postTurn(webviewView, payload.text, this.buildConversationSummary());
        return true;
      case "context":
        this.postTurn(webviewView, payload.text, await this.buildContextOverview(payload, config));
        return true;
      case "clear-context":
        this.options.conversationState.reset();
        void webviewView.webview.postMessage({ type: "clearChat" });
        this.postTurn(webviewView, payload.text, "Conversation context cleared.");
        return true;
      default:
        this.postTurn(
          webviewView,
          payload.text,
          `Unknown command: /${command.name}\n\nAvailable commands: /status, /context, /review, /goal [text], /tools, /mode default|auto-approve|full-access, /auto-context on|off, /clear-context, /summarize.`,
        );
        return true;
    }
  }

  private async buildStatus(config: AppConfig): Promise<string> {
    const apiKey = await this.options.secrets.getApiKey(config.baseUrl);
    const tools = this.getEnabledTools(config);
    return [
      "Status",
      `- API key: ${apiKey ? "configured" : "missing"}`,
      `- Model: ${config.model}`,
      `- Thinking mode: ${config.thinkingMode ? "on" : "off"}`,
      `- Permission mode: ${config.permissionMode}`,
      `- Auto context: ${config.autoContext ? "on" : "off"}`,
      `- Tools available: ${tools.length}`,
    ].join("\n");
  }

  private buildTools(config: AppConfig): string {
    const allTools = this.options.toolRegistry.getDefinitionsForAPI();
    const enabledTools = new Set(this.getEnabledTools(config).map((tool) => tool.function.name));
    const lines = allTools.map((tool) => {
      const name = tool.function.name;
      const availability = enabledTools.has(name) ? "available" : "unavailable";
      return `- ${name}: ${availability}`;
    });
    return [`Tools for mode '${config.permissionMode}'`, ...lines].join("\n");
  }

  private async handleMode(args: string[], rawText: string, webviewView: vscode.WebviewView): Promise<void> {
    const mode = args[0];
    if (!isPermissionMode(mode)) {
      this.postTurn(webviewView, rawText, "Usage: /mode default|auto-approve|full-access");
      return;
    }
    if (mode === "full-access") {
      const accepted = await vscode.window.showWarningMessage(
        "Enable global full access?",
        {
          modal: true,
          detail: "Routine and elevated operations may run anywhere. Critical actions that could make the computer unusable or cause broad irreversible loss still require confirmation.",
        },
        "Enable full access",
      );
      if (accepted !== "Enable full access") {
        this.postTurn(webviewView, rawText, "Permission mode was not changed.");
        return;
      }
    }
    await this.options.settings.save({ permissionMode: mode });
    await this.postConfig(webviewView);
    this.postTurn(webviewView, rawText, `Permission mode set to '${mode}'.`);
  }

  private async handleAutoContext(args: string[], rawText: string, webviewView: vscode.WebviewView): Promise<void> {
    const value = args[0];
    if (value !== "on" && value !== "off") {
      this.postTurn(webviewView, rawText, "Usage: /auto-context on|off");
      return;
    }
    const enabled = value === "on";
    await this.options.settings.save({ autoContext: enabled });
    await this.postConfig(webviewView);
    this.postTurn(webviewView, rawText, `Auto context ${enabled ? "enabled" : "disabled"}.`);
  }

  private async handleGoal(args: string[], rawText: string, webviewView: vscode.WebviewView): Promise<void> {
    const goal = args.join(" ").trim();
    if (goal.length > 0) {
      await this.options.context.workspaceState.update(GOAL_STORAGE_KEY, goal);
      this.postTurn(webviewView, rawText, `Goal set:\n${goal}`);
      return;
    }
    const currentGoal = this.options.context.workspaceState.get<string>(GOAL_STORAGE_KEY);
    this.postTurn(webviewView, rawText, currentGoal ? `Current goal:\n${currentGoal}` : "No goal is set.");
  }

  private buildConversationSummary(): string {
    const messages = this.options.conversationState.getApiMessages().filter((message) => message.role !== "system");
    if (messages.length === 0) {
      return "No conversation context to summarize.";
    }
    const recent = messages.slice(-6).map((message) => {
      const content = typeof message.content === "string" ? message.content.replace(/\s+/g, " ").trim() : "";
      return `- ${message.role}: ${content.slice(0, 220)}${content.length > 220 ? "..." : ""}`;
    });
    return [`Conversation summary (${messages.length} context messages):`, ...recent].join("\n");
  }

  private async buildContextOverview(payload: SendMessagePayload, config: AppConfig): Promise<string> {
    const instructions = await loadProjectInstructions(
      await this.getWorkspaceSnapshot(payload),
      config.includeHomeAgents,
    );
    const files = payload.referencedFiles?.map((file) => `- ${file.path}${file.content === undefined ? " (content omitted)" : ""}`) ?? [];
    return [
      "Context that would be sent with a normal request:",
      `- Prior API messages after pruning: ${this.options.conversationState.getApiMessages().length}`,
      `- Auto context: ${config.autoContext ? "active editor plus staged/unstaged Git changes" : "disabled"}`,
      `- Project instructions: ${instructions.sources.length > 0 ? instructions.sources.map((source) => source.path).join(", ") : "none"}`,
      `- Explicit references: ${files.length}`,
      ...files,
    ].join("\n");
  }

  private async getWorkspaceSnapshot(payload: SendMessagePayload): Promise<WorkspaceRunSnapshot> {
    const binding = await this.options.getWorkspaceBinding(payload.conversationId ?? this.options.getSelectedConversationId());
    if (payload.workspaceRevision && payload.workspaceRevision !== binding.revision) {
      throw new Error("The workspace changed. Refresh the workspace context and try again.");
    }
    return captureWorkspaceRunSnapshot(binding);
  }

  private getEnabledTools(config: AppConfig): ToolDefinition[] {
    const allTools = this.options.toolRegistry.getDefinitionsForAPI();
    return allTools.filter((tool) =>
      config.webSearchEnabled || (tool.function.name !== "search_web" && tool.function.name !== "read_web")
    );
  }

  private async postConfig(webviewView: vscode.WebviewView): Promise<void> {
    const freshConfig = this.options.settings.load();
    await webviewView.webview.postMessage({
      type: "configLoaded",
      revision: this.options.settings.getRevision(),
      config: toWebviewConfig(freshConfig),
    });
  }

  private postTurn(webviewView: vscode.WebviewView, userText: string, assistantText: string): void {
    void webviewView.webview.postMessage({ type: "addMessage", message: { role: "user", content: userText } });
    void webviewView.webview.postMessage({
      type: "addMessage",
      message: {
        role: "assistant",
        content: assistantText,
        timeline: [{ id: `command-${Date.now()}`, type: "content", content: assistantText }],
      },
    });
  }
}
