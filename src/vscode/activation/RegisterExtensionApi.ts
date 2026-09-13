import * as vscode from "vscode";
import { SIDEBAR_VIEW_ID } from "@/shared/constants";
import { registerChatCommands } from "@/vscode/commands/ChatCommands";
import { WebviewProvider } from "@/vscode/webviews/WebviewProvider";
import { clearDiagnostics, createSanitizedSupportReport, showDiagnostics } from "@/shared/logging/Logger";
import { getWebRuntimeDiagnostics } from "@/vscode/tools/browser";
import type { SettingsRepository } from "@/application/ports";

export function registerExtensionApi(
  context: vscode.ExtensionContext,
  provider: WebviewProvider,
  settings: SettingsRepository,
): void {
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseek-agent.openChat", () =>
      vscode.commands.executeCommand(SIDEBAR_VIEW_ID),
    ),
  );

  registerChatCommands(context, provider);

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseek-agent.showDiagnostics", async () => {
      showDiagnostics();
      const action = await vscode.window.showInformationMessage(
        "YCraSy DeepSeek Agent diagnostics are sanitized and exclude prompts, file contents, tool output, and reasoning.",
        "Copy sanitized report",
        "Clear diagnostics",
      );
      if (action === "Copy sanitized report") {
        const config = settings.load();
        const report = createSanitizedSupportReport({
          extensionVersion: context.extension.packageJSON.version,
          vscodeVersion: vscode.version,
          platform: process.platform,
          architecture: process.arch,
          model: config.model,
          permissionMode: config.permissionMode,
          features: {
            thinkingMode: config.thinkingMode,
            autoContext: config.autoContext,
            historyEnabled: config.historyEnabled,
            includeHomeAgents: config.includeHomeAgents,
          },
          webRuntime: getWebRuntimeDiagnostics(),
        });
        await vscode.env.clipboard.writeText(report);
        await vscode.window.showInformationMessage("Sanitized diagnostics copied.");
      } else if (action === "Clear diagnostics") {
        clearDiagnostics();
      }
    }),
    vscode.commands.registerCommand("deepseek-agent.clearDiagnostics", () => clearDiagnostics()),
  );
}
