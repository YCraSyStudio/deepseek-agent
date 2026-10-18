import type { TranslationCatalog } from "../Types";

export const settings = {
  settings: {
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
    webSearch: {
      title: "Web search",
      description: "Search and read web pages with DeepSeek using your configured API credential. Search and Fetch requests are billed separately from model tokens.",
      enabled: "Enable web search",
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
      retention: "History retention days (0 = unlimited)"
    },
    instructions: {
      globalAgents: "Use global AGENTS.md instructions"
    },
    beta: {
      enable: "Enable Beta Features"
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
      maxTokensDescription: "Output allowance per request. DeepSeek V4 has a 1M-token total context and supports up to 384K output; the conservative 8,192 default helps limit API usage and cost.",
      maxConcurrentGenerations: "Concurrent generations"
    }
  }
} satisfies TranslationCatalog;
