import type { TranslationCatalog } from "../Types";

export const history = {
  history: {
    incognitoActive: "History is unavailable while incognito mode is active. Existing conversations remain stored and will return when you leave incognito mode.",
    historyControls: "History controls",
    searchLabel: "Search history",
    searchPlaceholder: "Search history…",
    sortHistory: "Sort history",
    filterByWorkspace: "Filter by workspace",
    allWorkspaces: "All workspaces",
    groupByWorkspace: "Group by workspace",
    groupSummary: "{count} conversations",
    dateNewest: "Date (Newest)",
    dateOldest: "Date (Oldest)",
    titleAZ: "Title (A-Z)",
    titleZA: "Title (Z-A)",
    deleteFilteredHistory: "Delete filtered history",
    loadingHistory: "Loading history…",
    historyCouldNotBeLoaded: "History could not be loaded.",
    historyIsUnavailableOutsideVSCode: "History is unavailable outside VS Code.",
    noConversationsMatchYourSearch: "No conversations match your search.",
    noHistoryYet: "No history yet.",
    unknownWorkspace: "Unknown workspace",
    historyPages: "History pages",
    previous: "Previous",
    next: "Next",
    pageSummary: "Page {page} of {pages} · {count} conversations",
    openTitle: "Open {title}",
    deleteTitle: "Delete {title}",
    countMessages: "{count} messages",
    workspaceMismatch: {
      title: "Open in this workspace?",
      description: "This conversation belongs to \"{workspace}\", which is not the workspace currently open. Open it here instead? Pending generations, queued messages and file references will be cleared.",
      confirm: "Open here",
      cancel: "Cancel",
    }
  }
} satisfies TranslationCatalog;
