import type { TranslationCatalog } from "../Types";

export const settings = {
  settings: {
    help: "Help: {setting}",
    tab: {
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
      description: "Enables Chat Prefix, FIM and strict tools. Off by default. Disabling blocks new beta requests and stops automatic suggestions.",
      editorSuggestions: "Editor suggestions",
      chatSuggestions: "Chat suggestions",
      suggestionsHelp: "After a short typing pause, sends nearby code or your chat draft to DeepSeek. API charges apply. Tab accepts; Escape dismisses. Requires beta features.",
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
      description: "Search and read pages using your DeepSeek API key. Search and Fetch cost extra beyond model tokens.",
      enabled: "Enable web search",
      region: "Search region",
      global: "Global (default)",
      auto: "Automatic (system)",
      custom: "Choose a country",
      countryCode: "Two-letter country code, such as ES or US",
      regionHint: "Global has no country preference. Automatic uses the local system country, without looking up or adding your IP as a parameter. Your chat instructions take priority; technical sources in other languages remain available.",
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
