import { openCustomizationFile, watchCustomizationFiles } from "@/vscode/configuration/CustomizationFiles";
import * as vscode from "vscode";
import type { WebviewToHandlerMessage } from "@/contracts";
import { createReusableInstruction, listReusableInstructions, openReusableInstruction } from "@/infrastructure/persistence/ReusableInstructions";
import { reusableInstructionRoots } from "@/vscode/configuration/ReusableInstructions";
import { redactSensitiveText } from "@/shared/security/Redaction";
import type { SettingsRepository } from "@/application/ports";

type InstructionMessage = Extract<WebviewToHandlerMessage, { type: "getReusableInstructions" | "createReusableInstruction" | "openReusableInstruction" }>;

export class ReusableInstructionsHandler {
  private revision = 0;
  constructor(private readonly settings: SettingsRepository) {}

  async handle(message: InstructionMessage, view: vscode.WebviewView): Promise<void> {
    if (message.type === "getReusableInstructions") {await this.postCatalog(view);return;}
    try {
      const roots = reusableInstructionRoots();
      let file: string;
      if (message.type === "createReusableInstruction") {
        const root = roots.find((item) => message.scope === "global" ? item.scope === "global" : item.scope === "workspace" && item.rootUri === message.rootUri);
        if (!root) {throw new Error("Select a currently open local workspace folder.");}
        const language = this.settings.load().interfaceLanguage;
        file = await createReusableInstruction(root, message.name, message.description, language === "auto" ? vscode.env.language : language, message.template);
      } else {
        file = (await openReusableInstruction(roots, message.id)).file;
      }
      await openCustomizationFile(file);
      await this.postCatalog(view);
      await view.webview.postMessage({ type: "reusableInstructionResult", requestId: message.requestId, success: true });
    } catch (error) {
      await this.postCatalog(view);
      await view.webview.postMessage({ type: "reusableInstructionResult", requestId: message.requestId, success: false, error: redactSensitiveText(error) });
    }
  }

  watch(view: vscode.WebviewView): vscode.Disposable {
    const refresh = () => {void this.postCatalog(view);};
    return watchCustomizationFiles(view, () => reusableInstructionRoots().map((root) => {
      const boundary = vscode.Uri.file(root.boundary);
      return { directory: vscode.Uri.joinPath(boundary, root.relativeDirectory), pattern: "*.md",
        parent: { directory: boundary, name: root.relativeDirectory } };
    }), refresh);
  }

  private async postCatalog(view: vscode.WebviewView): Promise<void> {
    const revision = ++this.revision;
    try {
      const entries = await listReusableInstructions(reusableInstructionRoots());
      if (revision === this.revision) {await view.webview.postMessage({ type: "reusableInstructions", entries });}
    } catch (error) {
      if (revision === this.revision) {await view.webview.postMessage({ type: "reusableInstructions", entries: [], error: redactSensitiveText(error) });}
    }
  }
}
