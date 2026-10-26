import type { TranslationCatalog } from "../Types";
export const settings = {
  settings: {
    number: { increase: "Increase value", decrease: "Decrease value" },
    help: "Help: {setting}",
    snapshots: { storageLimit: "Snapshot storage limit (MiB)", storageHint: "Total limit for all chat recovery copies. If space is insufficient, the message continues with a warning and cannot be reverted." },
    tab: {
      customization: "Customization",
      api: "API",
      tools: "Tools",
      general: "General"
    },
    section: {
      extension: "Extension"
    },
    tabs: {
      label: "Settings sections"
    },
    loading: "Loading settings…",
    storage: {
      title: "Storage",
      directory: "Data folder",
      browse: "Select folder",
      default: "Default",
      reload: "Reload VS Code",
      reloadHint: "Applies after reload. Existing data stays in its original folder.",
      error: "Could not save the path.",
    },
    retry: "Retry",
    reset: {
      label: "Reset to Defaults",
      success: "Settings reset to defaults. API key preserved."
    },
    notification: {
      dismiss: "Dismiss notification"
    },
    unavailable: "Settings are unavailable outside VS Code.",
    save: {
      error: "Settings could not be saved. Try again."
    },
    load: {
      error: "Settings could not be loaded."
    },
    api: {
      title: "API Configuration",
      key: "API Key",
      keyVisibility: {
        label: "Show or hide API key",
        tooltip: "Show/Hide API Key"
      },
      testConnection: "Test Connection",
      removeCredential: "Remove API key",
      removingCredential: "Removing API key...",
      removeCredentialFailed: "API key could not be removed.",
      testing: "Testing...",
      notConfigured: "Not configured",
      connection: {
        ok: "Connection OK",
        failed: "Connection failed"
      },
      configured: "Configured",
      httpWarning: "Warning: HTTP sends API credentials without transport encryption.",
      customHostWarning: "Custom API host: verify that you trust its operator.",
      baseUrl: "Base URL"
    },
    reasoning: {
      mode: "Thinking Mode",
      effort: "Reasoning Effort"
    },
    advanced: {
      title: "Advanced"
    },
    beta: {
      title: "Beta features",
      enabled: "Enable beta features",
      description: "Enables DeepSeek API beta features: Chat Prefix, FIM and strict tools. Off by default. Disabling blocks new beta requests and stops automatic suggestions.",
      editorSuggestions: "Editor suggestions",
      chatSuggestions: "Chat suggestions",
      editorSuggestionsHelp: "After an 800 ms typing pause, sends nearby code to DeepSeek for completion. API charges apply. Tab accepts; Escape dismisses. Requires beta features and a trusted workspace.",
      chatSuggestionsHelp: "Click Suggest message beside the context indicator to generate a prompt or continue your draft using a brief project summary. Typing never requests suggestions. No source contents or chat history are sent. API charges apply. Tab accepts; Escape dismisses. Requires beta features, a configured API key and a trusted workspace.",
    },
    privacy: {
      title: "Privacy",
      minimize: "Minimize metadata",
      description: "Omits absolute paths from automatic context, image filenames and optional identifiers. Uses UTC timestamps without your time-zone name.",
      limits: "Best effort: messages, code, tool output, images and history are unchanged. Anonymity is not guaranteed; the provider still sees the connection IP.",
    },
    browser: {
      access: "Capture permission",
      ask: "Ask per site",
      always: "Always",
      never: "Never",
      automatic: "Automatic captures",
      automaticHelp: "Captures after UI changes using the last explicitly captured target. Captures stay local until analyzed.",
      limit: "Max captures per conversation",
    },
    webSearch: {
      title: "Web search",
      description: "Search with your DeepSeek API key and read pages locally in Chromium. Search costs extra beyond model tokens; local page reads do not use DeepSeek Fetch.",
      enabled: "Enable web search",
      region: "Search region",
      global: "Global (default)",
      auto: "Automatic (system)",
      custom: "Choose a country",
      countryCode: "Two-letter country code, such as ES or US",
      regionHint: "Global has no country preference. Automatic uses the local system country, without looking up or adding your IP as a parameter. Your chat instructions take priority; technical sources in other languages remain available.",
    },
    toolCatalog: {
      label: "Tool list",
      loading: "Loading tools…",
      empty: "No tools registered",
      noDescription: "No description available.",
      searchDisabled: "Unavailable while web search is disabled.",
    },
    sampling: {
      temperature: "Temperature",
      topP: "Top P"
    },
    history: {
      incognito: "Incognito mode",
      incognitoDescription: "Chats are kept only in memory and are lost when the extension or VS Code reloads.",
      transition: {
        workTitle: "Enter incognito mode?",
        workDescription: "There are {generations} active generations and {queued} queued messages.",
        workFinished: "The pending work has finished. You can now enter incognito mode.",
        exitWorkTitle: "Stop incognito work before leaving?",
        exitWorkFinished: "The pending incognito work has finished. You can continue leaving incognito mode.",
        stopAndEnter: "Stop generations and enter incognito",
        stopAndContinue: "Stop generations and continue",
        enter: "Enter incognito",
        continueExit: "Continue",
        cancelAndWait: "Cancel and wait",
        exitTitle: "Leave incognito mode?",
        exitDescription: "Choose whether to save this incognito chat as a new conversation or discard it.",
        saveAndExit: "Save and leave",
        discardAndExit: "Discard and leave",
        cancel: "Cancel"
      },
      store: "Store chat history",
      retention: "Keep history (days)",
      retentionHelp: "Use 0 to keep history indefinitely.",
    },
    reusable: {
      title: "Instructions",
      template: "Template",
      templateHelp: "Blank.md starts an empty instruction; git.md provides a Git workflow; commit.md includes commit message conventions and checks. Choose one, adjust the name and activation description, then edit its contents in VS Code.",
      create: "Create instruction",
      help: "Names and descriptions are listed for DeepSeek. The full file is read only when relevant to the current task, for example commit conventions. Global instructions apply to every project; workspace instructions apply only to that project.",
      scope: "Save in",
      global: "Global",
      workspace: "Workspace",
      name: "File name",
      nameHelp: "Enter a base name, for example commit. The .md extension is fixed and added automatically. Other extensions are part of the name: commit.txt becomes commit.txt.md. Letters, numbers, dots, hyphens and underscores are supported. Existing files are opened without overwriting.",
      description: "When to use it",
      descriptionPlaceholder: "When creating or reviewing a Git commit",
      createAndEdit: "Create and edit",
      cancel: "Cancel",
      loading: "Loading instructions…",
      empty: "No instructions yet.",
      edit: "Edit",
    },
    customization: {
      workspaceTitle: "Workspace instructions",
      generateWorkspaceAgents: "Generate AGENTS.md",
      editWorkspaceAgents: "Edit AGENTS.md",
      workspaceFolder: "Workspace folder",
      workspaceLoading: "Loading workspace instructions…",
      workspaceUnavailable: "Open a local workspace folder to create its instructions.",
      workspaceOpenError: "Could not open the workspace AGENTS.md.",

      openGlobalAgents: "Open global AGENTS.md",
      globalAgentsHelp: "Apply your personal instructions to every workspace. Save the file in VS Code; saved changes are loaded before each message.",
      openError: "Could not open the global AGENTS.md.",
    },
    instructions: {
      globalAgents: "Use global AGENTS.md instructions"
    },
    language: {
      label: "Interface language",
      auto: "Auto"
    },
    model: {
      label: "Model"
    },
    usage: {
      title: "Usage & cost",
      breakdown: "Show token usage under responses",
      currency: "Cost currency",
      currencyUsd: "US dollar (USD)",
      currencyCny: "Chinese yuan (CNY)"
    },
    limits: {
      maxTokens: "Max output tokens",
      maxTokensDescription: "Output limit per request. The default (8,192 tokens) helps control API usage and cost.",
      maxConcurrentGenerations: "Concurrent generations"
    }
  }
} satisfies TranslationCatalog;
