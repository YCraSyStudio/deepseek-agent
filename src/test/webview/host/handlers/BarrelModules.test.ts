import assert from "node:assert/strict";
import * as contracts from "@/contracts";
import * as customization from "@/contracts/Customization";
import * as workspaceBarrel from "@/vscode/workspace";
import * as views from "@/ui/views";
import * as chatViewComponents from "@/ui/components/chatView";
import * as chatViewHooks from "@/ui/views/chatView/hooks";
import * as settingsSections from "@/ui/views/settingsView/sections";
import * as settingsComponents from "@/ui/components/settingsView";
import * as sharedComponents from "@/ui/components/shared";
import * as storageBarrel from "@/vscode/storage";
import * as chatHooks from "@/ui/hooks/chat";
import * as inputArea from "@/ui/views/chatView/sections/inputArea";
import * as settingsModel from "@/ui/views/settingsView/model";
import * as toolCallBarrel from "@/application/chat/toolCall";
import * as toolsBarrel from "@/application/tools";
import * as commandReview from "@/infrastructure/deepseek/security/commandReview";
import * as fileSelector from "@/ui/components/chatView/fileSelector";
import * as chatViewContexts from "@/ui/views/chatView/contexts";
import * as chatSections from "@/ui/views/chatView/sections";
import * as sharedConstants from "@/shared/constants";
import * as sharedUtils from "@/shared/utils";
import * as historyComponents from "@/ui/components/historyView";
import * as i18n from "@/ui/i18n";
import * as settingsTabs from "@/ui/views/settingsView/tabs";
import * as browserDiagnostics from "@/vscode/tools/browser";

suite("public module surfaces", () => {
  test("root contracts barrel exposes configuration and protocol runtime values", () => {
    assert.equal(contracts.DEFAULT_CONFIG.model.length > 0, true);
    assert.equal(contracts.isReasoningEffort(contracts.DEFAULT_REASONING_EFFORT), true);
    assert.equal(typeof contracts.WEBVIEW_PROTOCOL_VERSION, "number");
    assert.equal(contracts.DEEPSEEK_FLASH_MODEL_ID.length > 0, true);
  });

  test("customization re-exports instruction template identifiers", () => {
    assert.equal(Array.isArray(customization.INSTRUCTION_TEMPLATE_IDS), true);
  });

  test("workspace barrel exposes binding helpers", () => {
    assert.equal(typeof workspaceBarrel.captureCurrentWorkspaceBinding, "function");
    assert.equal(typeof workspaceBarrel.formatWorkspacePath, "function");
  });

  test("view and component barrels expose the mounted roots", () => {
    assert.ok(views.ChatView);
    assert.ok(views.SettingsView);
    assert.ok(views.HistoryView);
    assert.ok(chatViewComponents.ChatMessages);
    assert.equal(typeof chatViewComponents.FileSelector, "function");
    assert.ok(sharedComponents.Header);
    assert.ok(sharedComponents.TooltipLayer);
    assert.ok(historyComponents.HistoryListItem);
  });

  test("hook barrels expose chat, stream and controller hooks", () => {
    assert.equal(typeof chatViewHooks.useMessageHandler, "function");
    assert.equal(typeof chatViewHooks.useStreamHandler, "function");
    assert.equal(typeof chatHooks.useChatMessagesController, "function");
    assert.equal(typeof chatHooks.useToolCallController, "function");
  });

  test("settings barrels expose every section, tab and model helper", () => {
    assert.equal(typeof settingsSections.AdvancedSection, "function");
    assert.equal(typeof settingsSections.ApiSection, "function");
    assert.equal(typeof settingsSections.GeneralSection, "function");
    assert.equal(typeof settingsSections.CustomizationSection, "function");
    assert.equal(typeof settingsSections.ToolsSection, "function");
    assert.equal(typeof settingsComponents.SettingsSection, "function");
    assert.equal(typeof settingsTabs.ApiTab, "function");
    assert.equal(typeof settingsModel.DEFAULT_CONFIG, "object");
  });

  test("chat input and context barrels expose composer components", () => {
    assert.ok(inputArea.InputCtrls);
    assert.ok(inputArea.InputFooter);
    assert.ok(inputArea.RunningTasks);
    assert.ok(chatSections.MessagesSection);
    assert.equal(typeof chatViewContexts.VsCodeProvider, "function");
    assert.equal(typeof chatViewContexts.useVsCode, "function");
    assert.equal(typeof fileSelector.getPathToken, "function");
  });

  test("application barrels expose the tool executor and cycle", () => {
    assert.equal(typeof toolCallBarrel.runToolCallCycle, "function");
    assert.equal(typeof toolsBarrel.ToolRegistry, "function");
    assert.equal(typeof toolsBarrel.ToolExecutor, "function");
  });

  test("infrastructure command review barrel exposes safety helpers", () => {
    assert.equal(typeof commandReview.reviewCommandSafety, "function");
    assert.equal(typeof commandReview.collectCommandFileContext, "function");
  });

  test("storage and browser barrels expose host managers and diagnostics", () => {
    assert.equal(typeof storageBarrel.SettingsManager, "function");
    assert.equal(typeof storageBarrel.SecretsManager, "function");
    assert.equal(typeof storageBarrel.HistoryManager, "function");
    assert.equal(typeof storageBarrel.GenerationCheckpointStore, "function");
    assert.equal(typeof browserDiagnostics.getWebRuntimeDiagnostics, "function");
  });

  test("shared barrels expose constants, formatting and translations", () => {
    assert.equal(typeof sharedConstants.CONFIG_SECTION, "string");
    assert.equal(typeof sharedUtils.normalizeAssistantMarkdown, "function");
    assert.equal(typeof i18n.t, "function");
    assert.equal(typeof i18n.formatUiDate, "function");
  });
});
