import type { ConversationSummary } from "@/contracts";
import { t } from "@webview/i18n";

export type HistoryGroupOrder = "none" | "workspace";

export const ALL_WORKSPACES = "all";

export interface WorkspaceOption {
  uri: string;
  label: string;
  count: number;
}

export type HistoryListRow =
  | { kind: "group"; key: string; label: string; count: number }
  | { kind: "conversation"; conversation: ConversationSummary };

export function formatWorkspaceName(workspaceUri: string): string {
  if (workspaceUri === "workspace:unknown") {return t("history.unknownWorkspace");}
  if (/^[a-zA-Z]:[\\/]/.test(workspaceUri)) {return lastPathSegment(workspaceUri) || workspaceUri;}
  try {
    const url = new URL(workspaceUri);
    return lastPathSegment(decodeURIComponent(url.pathname)) || workspaceUri;
  } catch {
    return lastPathSegment(workspaceUri) || workspaceUri;
  }
}

function lastPathSegment(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").at(-1) ?? "";
}

export function collectWorkspaceOptions(
  conversations: ConversationSummary[],
  labelFor: (workspaceUri: string) => string = formatWorkspaceName,
): WorkspaceOption[] {
  const counts = new Map<string, number>();
  for (const conversation of conversations) {
    counts.set(conversation.workspaceUri, (counts.get(conversation.workspaceUri) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([uri, count]) => ({ uri, label: labelFor(uri), count }))
    .sort((a, b) => compareLabels(a.label, b.label) || a.uri.localeCompare(b.uri));
}

export function buildHistoryRows(
  conversations: ConversationSummary[],
  groupBy: HistoryGroupOrder,
  labelFor: (workspaceUri: string) => string = formatWorkspaceName,
): HistoryListRow[] {
  if (groupBy === "none") {
    return conversations.map((conversation) => ({ kind: "conversation", conversation }));
  }

  const groups = new Map<string, ConversationSummary[]>();
  for (const conversation of conversations) {
    const bucket = groups.get(conversation.workspaceUri);
    if (bucket) {bucket.push(conversation);} else {groups.set(conversation.workspaceUri, [conversation]);}
  }

  return [...groups.entries()]
    .sort(([a], [b]) => compareLabels(labelFor(a), labelFor(b)) || a.localeCompare(b))
    .flatMap(([uri, grouped]) => [
      { kind: "group" as const, key: uri, label: labelFor(uri), count: grouped.length },
      ...grouped.map((conversation) => ({ kind: "conversation" as const, conversation })),
    ]);
}

function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}
