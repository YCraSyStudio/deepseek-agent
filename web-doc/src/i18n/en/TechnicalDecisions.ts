import type { PageContent } from "../Types";

export const technicalDecisions: PageContent = {
  navTitle: "Technical decisions",
  title: "Technical decisions",
  seoTitle: "Architecture and layer decisions",
  description: "How the extension is layered, how generations are owned and recovered, and how streaming, tools, and persistence are designed.",
  lead: "The extension separates domain state, DeepSeek transport, VS Code capabilities, and React rendering so safety rules remain authoritative in the extension host.",
  sections: [
    {
      title: "Layer boundaries",
      items: [
        "contracts owns serializable DeepSeek, configuration, and protocol-v5 webview models without UI, VS Code, filesystem, or HTTP dependencies.",
        "application owns provider-independent conversation, context, generation, and tool rules through explicit ports.",
        "infrastructure owns DeepSeek chat, SSE, Files API, SearXNG search and page extraction, mutation review, and concrete built-in tools.",
        "platform/vscode owns secrets, workspace access, storage, terminal processes, confirmations, attachment upload/cache, host-webview routing, and native change diffs.",
        "ui owns the React webview and changes authoritative tool state only after host messages. Chat and Settings are grouped by feature with explicit internal imports.",
      ],
    },
    {
      title: "Chronological event model",
      items: [
        "Assistant presentation is persisted as typed reasoning, content, and tool-group events rather than control markers embedded in text.",
        "The same timeline contract renders live streams and restored history, preserving think -> tool -> think -> response order.",
        "Text deltas are grouped per animation frame and flushed before tool groups, completion, cancellation, or persistence.",
        "Message, event, conversation, and fallback tool-call IDs use crypto.randomUUID().",
        "Adjacent reasoning and tool events are grouped into collapsed Activity blocks for presentation without altering the persisted chronological event order.",
      ],
    },
    {
      title: "Generation ownership and recovery",
      items: [
        "A coordinator permits one active generation per conversation and bounded concurrency across conversations. The configurable limit defaults to 8 and is clamped from 1 to 16.",
        "Client request IDs, generation IDs, and conversation IDs bind queues, streams, tool approvals, cancellation, and snapshots to the correct run.",
        "Interrupt and guide queues the new instruction first, safely aborts the current transport, and records a verified source-generation link. The next request explicitly continues the original task under that guidance; ordinary sends remain independent queued turns.",
        "Atomic revisioned checkpoints preserve partial timelines, tool state, non-secret configuration, and queued prompts. Activation restores interrupted output and offers queued prompts as drafts.",
        "Explicit Stop persists the submitted prompt and partial timeline as cancelled; steering and lifecycle recovery remain interrupted. Every accepted run publishes exactly one terminal outcome after persistence.",
        "A bounded tool-free completion reviewer evaluates suspicious premature text stops once. A repeated incomplete result remains failed/incomplete instead of being converted into a false final answer.",
      ],
    },
    {
      title: "Tools and terminal",
      items: [
        "Tool state has one native lifecycle ending in completed, rejected, cancelled, or error; rejection is not encoded as an execution error.",
        "Calls within a tool round execute sequentially and duplicate name-and-argument calls are blocked until the workspace mutation epoch changes. No permission mode has an arbitrary round or per-block call limit. A tool-free reviewer receives compact cumulative activity after 20 rounds and every five thereafter; its recommendation guides the next normal round without disabling tools. Across concurrent generations, read-only tools may overlap while workspace mutations are serialized per workspace.",
        "VS Code hosts execute each command visibly in one dedicated integrated terminal through Shell Integration, reuse it for later commands, and close it only on timeout, cancellation, a working-directory mismatch, or extension shutdown, while retaining structured bounded output, cancellation, timeout, and exit status. Detached launchers are rejected and agent terminals disable .NET build-server reuse; non-VS Code hosts retain the headless executor as a compatibility fallback.",
        "Each conversation stores a revisioned logical-workspace binding. Every run captures its folders, aliases, capabilities, and active-editor root once; no operation falls back to the current editor or first folder.",
        "Path authorization accepts ./ workspace paths, rejects parent traversal, absolute paths and URIs, and resolves real paths and existing ancestors to prevent symlink or junction escapes.",
        "Explicit external attachments are temporary read-only snapshots. They are not persisted and never extend tool authorization beyond the bound workspace.",
        "One selector classifies files by binary signature. Images use DeepSeek Files API file IDs and a local preview cache that DeepSeek V4.1 Flash consumes directly; no built-in tool mediates vision.",
        "Confirmed file writes carry SHA-256 guards so edits and overwrites fail if disk content changes after preview.",
        "Automatic modes use a separate DeepSeek instance, without a local danger analyzer, to classify mutations as routine, elevated, or critical. It receives the original request, mechanical scope facts, and bounded previews of explicitly named non-sensitive workspace files; automatic decisions require medium-high confidence or above.",
        "Native change views reconstruct the before and after documents from the bounded diff recorded by that specific create, edit, or patch call, rather than from current disk or Git state.",
      ],
    },
    {
      title: "API, context, and persistence",
      items: [
        "SSE supports comments, CRLF, data fields with or without spaces, multiline events, decoder finalization, malformed JSON diagnostics, and reader cancellation.",
        "DeepSeek requests use normalized URLs, a 60-second per-attempt timeout, and at most three retries for transient failures while respecting Retry-After.",
        "Web search uses SearXNG. The default loopback endpoint is backed by a platform runtime whose version, size, and SHA-256 digest are pinned in the VSIX; compatible custom endpoints require HTTPS outside loopback and cannot contain credentials.",
        "Settings, schema-v2 conversation history, and schema-3 generation checkpoints live under ~/.deepseek-agent/. API credentials live separately in VS Code Secret Storage, keyed by normalized origin; only masked status reaches the webview. Checkpoints never contain a key, and incompatible history or checkpoint files are deleted without migration.",
        "DeepSeek requests reject credential-bearing URLs, require HTTPS outside loopback, preserve the selected origin across redirects, and redact sensitive values from surfaced errors.",
        "Registered DeepSeek V4.1 Flash capabilities use a 1M-token total context and 384K maximum output. The configured output allowance defaults to 384,000 and reduces the input budget alongside a safety margin.",
        "Context has aggregate budgets, binary detection, staged and unstaged Git data, bounded AGENTS.md sources, and explicit untrusted-data delimiters.",
      ],
    },
  ],
};
