import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConversationSummary, HandlerToWebviewMessage } from "@/contracts";
import { HistoryListItem } from "@webview/components/historyView";
import { useVsCode } from "../chatView/contexts";
import "./HistoryView.css";
import { t } from "@webview/i18n";
import { beginNavigationRequest } from "@webview/NavigationRequests";
import {
  ALL_WORKSPACES,
  buildHistoryRows,
  collectWorkspaceOptions,
  formatWorkspaceName,
  type HistoryGroupOrder,
} from "./HistoryGrouping";

type SortOrder = "date_desc" | "date_asc" | "title_asc" | "title_desc";
const PAGE_SIZE = 25;

function HistoryView() {
  const vscode = useVsCode();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [query, setQuery] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState(ALL_WORKSPACES);
  const [sortBy, setSortBy] = useState<SortOrder>("date_desc");
  const [groupBy, setGroupBy] = useState<HistoryGroupOrder>("none");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyEnabled, setHistoryEnabled] = useState<boolean | undefined>(undefined);
  const [activity, setActivity] = useState<Record<string, "queued" | "running" | "cancelling">>({});

  const requestHistory = useCallback(() => {
    setIsLoading(true);
    setError(null);
    vscode?.postMessage({ type: "getHistory" });
  }, [vscode]);

  useEffect(() => {
    if (!vscode) {
      setIsLoading(false);
      setError(t("history.historyIsUnavailableOutsideVSCode"));
      return;
    }

    const handleMessage = (event: MessageEvent<HandlerToWebviewMessage>) => {
      const message = event.data;
      if (message.type === "history") {
        setConversations(message.conversations);
        setIsLoading(false);
        setError(null);
      } else if (message.type === "historyError") {
        setIsLoading(false);
        setError(message.error || t("history.historyCouldNotBeLoaded"));
      } else if (message.type === "conversationDeleted") {
        setConversations((current) => current.filter((conversation) => conversation.id !== message.id));
      } else if (message.type === "generationActivityChanged") {
        setActivity((current) => {
          const next = { ...current };
          if (message.status === "settled" && message.queuedMessages === 0) {
            delete next[message.conversationId];
          } else {
            next[message.conversationId] = message.status === "settled" ? "queued" : message.status;
          }
          return next;
        });
      } else if (message.type === "generationSnapshot") {
        setActivity(Object.fromEntries(message.generations.map((generation) => [
          generation.conversationId,
          generation.status === "cancelling" ? "cancelling" : "running",
        ])));
      } else if (message.type === "configLoaded" || message.type === "configUpdateResult") {
        if (message.config.historyEnabled !== undefined) {
          setHistoryEnabled(message.config.historyEnabled);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    requestHistory();
    vscode.postMessage({ type: "getConfig" });
    vscode.postMessage({ type: "getGenerationSnapshot" });
    return () => window.removeEventListener("message", handleMessage);
  }, [vscode, requestHistory]);

  const workspaceOptions = useMemo(() => collectWorkspaceOptions(conversations), [conversations]);

  useEffect(() => {
    if (workspaceFilter !== ALL_WORKSPACES && !workspaceOptions.some((option) => option.uri === workspaceFilter)) {
      setWorkspaceFilter(ALL_WORKSPACES);
    }
  }, [workspaceFilter, workspaceOptions]);

  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return conversations.filter((conversation) => {
      if (workspaceFilter !== ALL_WORKSPACES && conversation.workspaceUri !== workspaceFilter) {return false;}
      if (!normalizedQuery) {return true;}
      return conversation.title.toLocaleLowerCase().includes(normalizedQuery) ||
        conversation.workspaceUri.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [conversations, query, workspaceFilter]);

  const visibleRows = useMemo(() => {
    const sorted = [...visibleConversations].sort((a, b) => {
      switch (sortBy) {
        case "date_asc": return a.updatedAt - b.updatedAt;
        case "title_asc": return a.title.localeCompare(b.title);
        case "title_desc": return b.title.localeCompare(a.title);
        case "date_desc": return b.updatedAt - a.updatedAt;
      }
    });
    return buildHistoryRows(sorted, groupBy);
  }, [visibleConversations, sortBy, groupBy]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paginatedRows = visibleRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => setPage(1), [query, sortBy, workspaceFilter, groupBy]);
  useEffect(() => {
    if (page > pageCount) {setPage(pageCount);}
  }, [page, pageCount]);

  return (
    <div className="historyView">
      <div className="historyToolbar" aria-label={t("history.historyControls")} hidden={historyEnabled === false}>
        <div className="searchBar">
          <label className="srOnly" htmlFor="historySearch">{t("history.searchLabel")}</label>
          <input type="search" id="historySearch" placeholder={t("history.searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} />
          <span className="codicon codicon-search" aria-hidden="true" />
        </div>
        <button
          className="clearBtn"
          type="button"
          aria-label={t("history.deleteFilteredHistory")}
          data-tooltip={t("history.deleteFilteredHistory")}
          data-tooltip-align="end"
          disabled={visibleConversations.length === 0 || isLoading}
          onClick={() => vscode?.postMessage({ type: "deleteConversations", ids: visibleConversations.map((conversation) => conversation.id) })}
        >
          <span className="codicon codicon-trash" aria-hidden="true" />
        </button>
      </div>

      <div className="historyFilters" hidden={historyEnabled === false}>
        <label className="srOnly" htmlFor="historyWorkspaceFilter">{t("history.filterByWorkspace")}</label>
        <select
          className="workspaceFilter"
          id="historyWorkspaceFilter"
          data-tooltip={t("history.filterByWorkspace")}
          value={workspaceFilter}
          onChange={(event) => setWorkspaceFilter(event.target.value)}
        >
          <option value={ALL_WORKSPACES}>{t("history.allWorkspaces")}</option>
          {workspaceOptions.map((option) => (
            <option key={option.uri} value={option.uri} title={option.label}>{`${option.label} (${option.count})`}</option>
          ))}
        </select>
        <label className="srOnly" htmlFor="historySort">{t("history.sortHistory")}</label>
        <select
          className="sortBy"
          id="historySort"
          data-tooltip={t("history.sortHistory")}
          data-tooltip-align="end"
          value={sortBy}
          onChange={(event) => {
            const order = parseSortOrder(event.target.value);
            if (order) {setSortBy(order);}
          }}
        >
          <option value="date_desc">{t("history.dateNewest")}</option>
          <option value="date_asc">{t("history.dateOldest")}</option>
          <option value="title_asc">{t("history.titleAZ")}</option>
          <option value="title_desc">{t("history.titleZA")}</option>
        </select>
        <button
          className={`groupToggle${groupBy === "workspace" ? " active" : ""}`}
          type="button"
          aria-pressed={groupBy === "workspace"}
          data-tooltip={t("history.groupByWorkspace")}
          data-tooltip-position="bottom"
          data-tooltip-align="end"
          onClick={() => setGroupBy(groupBy === "workspace" ? "none" : "workspace")}
        >
          <span className={`codicon codicon-${groupBy === "workspace" ? "list-tree" : "list-flat"}`} aria-hidden="true" />
          <span className="groupToggleLabel">{t("history.groupByWorkspace")}</span>
        </button>
      </div>

      <div className="historyList" aria-busy={isLoading} aria-live="polite">
        {historyEnabled === false ? <div className="historyState">{t("history.incognitoActive")}</div> : null}
        {historyEnabled !== false && isLoading ? <div className="historyState" role="status">{t("history.loadingHistory")}</div> : null}
        {historyEnabled !== false && !isLoading && error ? (
          <div className="historyState historyError" role="alert">
            <span>{t("history.historyCouldNotBeLoaded")}</span>
            <small>{error}</small>
            <button type="button" className="btn-secondary" onClick={requestHistory}>{t("settings.retry")}</button>
          </div>
        ) : null}
        {historyEnabled !== false && !isLoading && !error && visibleRows.length === 0 ? (
          <div className="historyState">{query || workspaceFilter !== ALL_WORKSPACES ? t("history.noConversationsMatchYourSearch") : t("history.noHistoryYet")}</div>
        ) : null}
        {historyEnabled !== false && !isLoading && !error ? paginatedRows.map((row) => row.kind === "group" ? (
          <div className="historyGroup" key={`group:${row.key}`} role="presentation">
            <span className="historyGroupLabel" title={row.label}>{row.label}</span>
            <span className="historyGroupCount">{t("history.groupSummary", { count: row.count })}</span>
          </div>
        ) : (
          <HistoryListItem
            key={row.conversation.id}
            title={row.conversation.title}
            datetime={new Date(row.conversation.updatedAt)}
            messageCount={row.conversation.messageCount}
            workspace={groupBy === "none" ? formatWorkspaceName(row.conversation.workspaceUri) : undefined}
            activity={activity[row.conversation.id]}
            onClick={() => vscode?.postMessage({ type: "loadConversation", requestId: beginNavigationRequest(), id: row.conversation.id })}
            onDelete={() => vscode?.postMessage({ type: "deleteConversation", id: row.conversation.id })}
          />
        )) : null}
      </div>

      {historyEnabled !== false && !isLoading && !error && visibleRows.length > PAGE_SIZE ? (
        <nav className="historyPagination" aria-label={t("history.historyPages")}>
          <button type="button" className="btn-secondary" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t("history.previous")}</button>
          <span aria-live="polite">{t("history.pageSummary", { page: currentPage, pages: pageCount, count: visibleConversations.length })}</span>
          <button type="button" className="btn-secondary" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>{t("history.next")}</button>
        </nav>
      ) : null}
    </div>
  );
}

export default HistoryView;

function parseSortOrder(value: string): SortOrder | undefined {
  return value === "date_desc" || value === "date_asc" || value === "title_asc" || value === "title_desc" ? value : undefined;
}
