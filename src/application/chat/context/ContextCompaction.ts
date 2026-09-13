import type { ChatCompletionRequest, ChatCompletionResponse, ReferencedFile } from "@/contracts";
import { createHash } from "crypto";
import { randomUUID } from "crypto";
import type { ApiContextUnit } from "@/application/chat/ConversationState";
import type { ConversationContextSummary } from "@/application/chat/ProviderTranscript";
import type { ProviderUsage, UsagePhase } from "@/shared/usage/Usage";
import { takeUtf8Head, takeUtf8Tail } from "@/shared/utils/BoundedText";
import { assessRequestBudget } from "./ContextBudget";
import { getTextContent } from "@/contracts/deepseek/Chat";

const SUMMARY_MAX_TOKENS = 2_048;
const RANGE_SELECTION_MAX_TOKENS = 512;
const MAX_RANGE_COUNT = 12;
const MAX_SUMMARY_BYTES = 24_000;
const MAX_AUXILIARY_SOURCE_BYTES = 192 * 1024;
const MAX_COMPACTED_FILE_BYTES = 96 * 1024;

export interface ContextCompactionProvider {
  chatCompletion(request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResponse>;
}

export class ContextCompactor {
  private calls = 0;

  constructor(
    private readonly provider: ContextCompactionProvider,
    private readonly model: string,
    private readonly signal: AbortSignal,
    private readonly maxCalls = 4,
    private readonly onUsage?: (phase: UsagePhase, usage: ProviderUsage | undefined, model: string) => void,
    private readonly onPromptUsage?: (messages: ChatCompletionRequest["messages"], usage?: ProviderUsage) => void,
  ) {}

  async summarize(
    units: ApiContextUnit[],
    previousSummary?: ConversationContextSummary,
  ): Promise<ConversationContextSummary> {
    const sourceParts = [
      previousSummary?.content ? `Previous summary:\n${previousSummary.content}` : "",
      ...units.map((unit) => `<generation id="${unit.generationId}">\n${unit.visibleText}\n</generation>`),
    ].filter(Boolean);
    const source = sourceParts.join("\n\n");
    const newlyCoveredGenerationIds = units.map((unit) => unit.generationId);
    const coveredGenerationIds = [
      ...(previousSummary?.coveredGenerationIds ?? []),
      ...newlyCoveredGenerationIds,
    ].filter((id, index, all) => all.indexOf(id) === index);

    try {
      const chunks = chunkStringsByUtf8(sourceParts, MAX_AUXILIARY_SOURCE_BYTES);
      const partials: string[] = [];
      for (const chunk of chunks) {
        if (this.calls >= this.maxCalls - (chunks.length > 1 ? 1 : 0)) {
          partials.push(truncateUtf8(chunk, MAX_SUMMARY_BYTES));
          continue;
        }
        partials.push(await this.complete("context_summary", summaryMessages(chunk), SUMMARY_MAX_TOKENS));
      }
      const combined = partials.join("\n\n");
      const content = partials.length > 1 && this.calls < this.maxCalls
        ? await this.complete("context_summary", summaryMessages(combined), SUMMARY_MAX_TOKENS)
        : combined;
      if (!content.trim()) {
        throw new Error("Empty compaction response");
      }
      return createSummary("deepseek", truncateUtf8(content.trim(), MAX_SUMMARY_BYTES), coveredGenerationIds, newlyCoveredGenerationIds, source, previousSummary);
    } catch (error) {
      if (this.signal.aborted) {
        throw createAbortError();
      }
      return createSummary("local", buildLocalSummary(units, previousSummary), coveredGenerationIds, newlyCoveredGenerationIds, source, previousSummary);
    }
  }

  async compactFiles(files: ReferencedFile[], prompt: string): Promise<ReferencedFile[]> {
    const compacted: ReferencedFile[] = [];
    for (const file of files) {
      if (!referencedFileNeedsCompaction(file)) {
        compacted.push(file);
        continue;
      }
      const lines = file.content.split(/\r?\n/);
      const ranges = await this.selectRanges("file_compaction", file.path, lines, prompt);
      compacted.push({
        ...file,
        content: truncateUtf8(extractLiteralRanges(lines, ranges), MAX_COMPACTED_FILE_BYTES),
      });
    }
    return compacted;
  }

  private async selectRanges(phase: UsagePhase, path: string, lines: string[], prompt: string): Promise<LineRange[]> {
    const estimatedNumberedBytes = lines.reduce(
      (total, line, index) => total + Buffer.byteLength(line, "utf8") + String(index + 1).length + 3,
      0,
    );
    if (estimatedNumberedBytes > MAX_AUXILIARY_SOURCE_BYTES) {
      return selectLocalRanges(lines, prompt);
    }
    const numbered = lines.map((line, index) => `${index + 1}: ${line}`).join("\n");
    try {
      const raw = await this.complete(phase, [
        {
          role: "system",
          content: `Select only line ranges relevant to the user's coding request. Return strict JSON as {"ranges":[{"start":1,"end":20}]}. Use 1-based inclusive lines, at most ${MAX_RANGE_COUNT} ranges. Do not reproduce or rewrite source code.`,
        },
        {
          role: "user",
          content: `Request:\n${prompt}\n\nFile: ${path}\n\n${numbered}`,
        },
      ], RANGE_SELECTION_MAX_TOKENS);
      return parseRanges(raw, lines.length);
    } catch (error) {
      if (this.signal.aborted) {
        throw createAbortError();
      }
      return selectLocalRanges(lines, prompt);
    }
  }

  private async complete(
    phase: UsagePhase,
    messages: ChatCompletionRequest["messages"],
    maxTokens: number,
  ): Promise<string> {
    if (this.calls >= this.maxCalls) {
      throw new Error("Auxiliary compaction call limit reached");
    }
    if (this.signal.aborted) {
      throw createAbortError();
    }
    this.calls += 1;
    const assessment = assessRequestBudget(messages, [], this.model, maxTokens);
    if (assessment.status !== "within_budget") {
      throw new Error("Auxiliary compaction request exceeded its preventive context budget");
    }
    let usage: ProviderUsage | undefined;
    try {
      const response = await this.provider.chatCompletion({
        model: this.model,
        messages,
        thinking: { type: "disabled" },
        tool_choice: "none",
        max_tokens: maxTokens,
      }, this.signal);
      usage = response.usage;
      if (this.signal.aborted) {
        throw createAbortError();
      }
      return getTextContent(response.choices[0]?.message.content);
    } finally {
      this.onPromptUsage?.(messages, usage);
      this.onUsage?.(phase, usage, this.model);
    }
  }
}

export function referencedFileNeedsCompaction(file: ReferencedFile): file is ReferencedFile & { content: string } {
  if (!file.content || file.type === "directory") {return false;}
  return file.content.split(/\r?\n/).length > 400 ||
    Buffer.byteLength(file.content, "utf8") > MAX_COMPACTED_FILE_BYTES;
}

function createAbortError(): Error {
  const error = new Error("Context compaction cancelled");
  error.name = "AbortError";
  return error;
}

interface LineRange {
  start: number;
  end: number;
}

function parseRanges(raw: string, lineCount: number): LineRange[] {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(json) as { ranges?: unknown };
  if (!Array.isArray(parsed.ranges)) {
    throw new Error("Invalid line range response");
  }
  const ranges = parsed.ranges.slice(0, MAX_RANGE_COUNT).map((value) => {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid line range");
    }
    const start = Math.trunc(Number((value as { start?: unknown }).start));
    const end = Math.trunc(Number((value as { end?: unknown }).end));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > lineCount) {
      throw new Error("Line range outside source");
    }
    return { start, end };
  });
  if (ranges.length === 0) {
    throw new Error("No relevant ranges returned");
  }
  return normalizeLineRanges(ranges);
}

function normalizeLineRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const normalized: LineRange[] = [];
  for (const range of sorted) {
    const previous = normalized.at(-1);
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      normalized.push({ ...range });
    }
  }
  return normalized;
}

function extractLiteralRanges(lines: string[], ranges: LineRange[]): string {
  return ranges
    .map(({ start, end }) => `/* lines ${start}-${end}; omitted regions are unchanged */\n${lines.slice(start - 1, end).join("\n")}`)
    .join("\n\n/* … omitted … */\n\n");
}

function selectLocalRanges(lines: string[], prompt: string): LineRange[] {
  const terms = new Set(
    prompt.toLowerCase().match(/[a-z_][a-z0-9_.-]{2,}/g)?.slice(0, 40) ?? [],
  );
  const hits = lines
    .map((line, index) => ({ index, score: [...terms].filter((term) => line.toLowerCase().includes(term)).length }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RANGE_COUNT);
  const centers = hits.length > 0 ? hits.map(({ index }) => index) : [0, Math.max(0, lines.length - 1)];
  return normalizeLineRanges(
    centers.map((index) => ({ start: Math.max(1, index - 20), end: Math.min(lines.length, index + 21) })),
  );
}

function buildLocalSummary(
  units: ApiContextUnit[],
  previousSummary?: ConversationContextSummary,
): string {
  const sections = [
    previousSummary?.content ? `Earlier context:\n${previousSummary.content}` : "",
    ...units.map((unit) => unit.visibleText),
  ].filter(Boolean);
  const combined = sections.join("\n\n");
  if (Buffer.byteLength(combined, "utf8") <= MAX_SUMMARY_BYTES) {return combined;}
  const marker = "\n\n[older detail compacted locally]\n\n";
  const sideBytes = Math.max(0, Math.floor((MAX_SUMMARY_BYTES - Buffer.byteLength(marker, "utf8")) / 2));
  return `${takeUtf8Head(combined, sideBytes)}${marker}${takeUtf8Tail(combined, sideBytes)}`;
}

function summaryMessages(source: string): ChatCompletionRequest["messages"] {
  return [
    {
      role: "system",
      content: "Summarize coding conversation context faithfully and compactly. Preserve decisions, constraints, unresolved work, errors, file names, symbols and exact user requirements. Never invent facts. Return only the summary.",
    },
    { role: "user", content: source },
  ];
}

function chunkStringsByUtf8(parts: string[], maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const rawPart of parts) {
    let part = rawPart;
    while (Buffer.byteLength(part, "utf8") > maxBytes) {
      if (current) {chunks.push(current); current = "";}
      const head = truncateUtf8(part, maxBytes);
      chunks.push(head);
      part = part.slice(head.length);
    }
    const candidate = current ? `${current}\n\n${part}` : part;
    if (Buffer.byteLength(candidate, "utf8") > maxBytes) {
      if (current) {chunks.push(current);}
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) {chunks.push(current);}
  return chunks.length > 0 ? chunks : [""];
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {return value;}
  return takeUtf8Head(value, maxBytes);
}

function createSummary(
  provider: ConversationContextSummary["provider"],
  content: string,
  coveredGenerationIds: string[],
  newlyCoveredGenerationIds: string[],
  source: string,
  previousSummary?: ConversationContextSummary,
): ConversationContextSummary {
  const sourceDigest = createHash("sha256").update(source).digest("hex");
  const now = Date.now();
  return {
    schemaVersion: 2,
    provider,
    content,
    coveredGenerationIds,
    sourceDigest,
    updatedAt: now,
    boundaries: [
      ...(previousSummary?.boundaries ?? []),
      {
        id: randomUUID(),
        createdAt: now,
        reason: "input_soft_limit" as const,
        estimatedTokensBefore: Math.ceil(Buffer.byteLength(source, "utf8") / 3),
        estimatedTokensAfter: Math.ceil(Buffer.byteLength(content, "utf8") / 3),
        coveredGenerationIds: [...new Set(newlyCoveredGenerationIds)],
        sourceDigest,
      },
    ].slice(-1_000),
  };
}
