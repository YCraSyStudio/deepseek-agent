import * as assert from "node:assert";
import type { ConversationSummary } from "@/contracts";
import {
  buildHistoryRows,
  collectWorkspaceOptions,
  formatWorkspaceName,
} from "@webview/views/historyView/HistoryGrouping";

const projectA = "file:///home/dev/projects/alpha";
const projectB = "file:///home/dev/projects/beta";

suite("history workspace grouping", () => {
  test("keeps the incoming conversation order when grouping is disabled", () => {
    const conversations = [summary("1", "First", projectB), summary("2", "Second", projectA)];

    const rows = buildHistoryRows(conversations, "none", labelFor);

    assert.deepStrictEqual(
      rows.map((row) => row.kind === "conversation" ? row.conversation.id : row.key),
      ["1", "2"],
    );
  });

  test("groups conversations under workspace headers sorted by label", () => {
    const conversations = [
      summary("1", "Beta two", projectB),
      summary("2", "Alpha one", projectA),
      summary("3", "Beta one", projectB),
    ];

    const rows = buildHistoryRows(conversations, "workspace", labelFor);

    assert.deepStrictEqual(rows.map((row) => row.kind), ["group", "conversation", "group", "conversation", "conversation"]);
    assert.deepStrictEqual(rows.map((row) => row.kind === "group" ? row.label : row.conversation.id), [
      "alpha", "2", "beta", "1", "3",
    ]);
    assert.strictEqual(rows[0]?.kind === "group" && rows[0].count, 1);
    assert.strictEqual(rows[2]?.kind === "group" && rows[2].count, 2);
  });

  test("collects workspace options with conversation counts", () => {
    const conversations = [
      summary("1", "Alpha one", projectA),
      summary("2", "Beta one", projectB),
      summary("3", "Alpha two", projectA),
    ];

    const options = collectWorkspaceOptions(conversations, labelFor);

    assert.deepStrictEqual(options, [
      { uri: projectA, label: "alpha", count: 2 },
      { uri: projectB, label: "beta", count: 1 },
    ]);
  });

  test("derives a readable workspace name from its URI", () => {
    assert.strictEqual(formatWorkspaceName(projectA), "alpha");
    assert.strictEqual(formatWorkspaceName("file:///home/dev/projects/alpha/"), "alpha");
    assert.strictEqual(formatWorkspaceName("C:\\Users\\dev\\projects\\alpha"), "alpha");
  });
});

function labelFor(workspaceUri: string): string {
  return workspaceUri.slice(workspaceUri.lastIndexOf("/") + 1);
}

function summary(id: string, title: string, workspaceUri: string): ConversationSummary {
  return {
    id,
    title,
    createdAt: 0,
    updatedAt: 0,
    model: "deepseek-chat",
    messageCount: 1,
    sizeBytes: 1,
    workspaceUri,
  };
}
