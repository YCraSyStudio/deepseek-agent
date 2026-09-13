import { logWarning } from "@/shared/logging/Logger";
import { takeUtf8Head, takeUtf8Tail } from "@/shared/utils/BoundedText";

const MAX_TOOL_RESULT_MODEL_BYTES = 128 * 1024;
const MAX_TOOL_RESULT_MODEL_TOKENS = 16_000;
const OMITTED_MIDDLE_MARKER = "\n...[tool result truncated for model context; middle omitted]...\n";

/** Uses the same conservative UTF-8 / 3 estimate as ContextBudget, including JSON escaping. */
export function estimateToolResultTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 3);
}

/**
 * Returns the largest representation of a tool result that fits the model budget.
 * Total function: never throws, even when terminal metadata alone overflows the budget.
 */
export function fitToolResultForModel(value: string, maxBytes = MAX_TOOL_RESULT_MODEL_BYTES, maxTokens = MAX_TOOL_RESULT_MODEL_TOKENS): string {
  if (!Number.isFinite(maxBytes) || !Number.isFinite(maxTokens) || maxBytes < 2 || maxTokens < 1) {return "";}
  const fits = (text: string) => Buffer.byteLength(text, "utf8") <= maxBytes && estimateToolResultTokens(text) <= maxTokens;
  if (fits(value)) {return value;}
  const minimalCommand = compactCommandResult(value, 0);
  const metadataOverflowsBudget = minimalCommand !== undefined && !fits(minimalCommand);
  let result = metadataOverflowsBudget ? undefined : minimalCommand;
  let low = 0;
  let high = Math.min(Buffer.byteLength(value, "utf8"), Math.floor(maxBytes));
  while (low <= high) {
    const budget = Math.floor((low + high) / 2);
    const candidate = compactCommandResult(value, budget) ?? boundText(value, budget);
    if (fits(candidate)) {
      result = candidate;
      low = budget + 1;
    } else {high = budget - 1;}
  }
  if (result === undefined || !fits(result)) {
    result = shrinkToFit(boundText(minimalCommand ?? value, Math.floor(maxBytes)), fits);
  }
  if (metadataOverflowsBudget) {
    logWarning("Terminal result metadata exceeded the tool-result budget and was truncated.");
  }
  return result;
}

function shrinkToFit(value: string, fits: (text: string) => boolean): string {
  let candidate = value;
  let budget = Math.floor(Buffer.byteLength(candidate, "utf8") / 2);
  while (!fits(candidate) && budget > 0) {
    candidate = boundText(candidate, budget);
    budget = Math.floor(budget / 2);
  }
  return fits(candidate) ? candidate : "";
}

function compactCommandResult(value: string, budget: number): string | undefined {
  let parsed;
  try {parsed = JSON.parse(value);} catch {return undefined;}
  if (!parsed || parsed.kind !== "command_result" || typeof parsed.stdout !== "string" || typeof parsed.stderr !== "string") {return undefined;}
  const compact = {
    kind: "command_result",
    exitCode: parsed.exitCode ?? null,
    signal: parsed.signal ?? null,
    timedOut: parsed.timedOut === true,
    cancelled: parsed.cancelled === true,
    durationMs: parsed.durationMs,
    terminationConfirmed: parsed.terminationConfirmed,
    metadataOmitted: true,
    stdout: compactLog(parsed.stdout, Math.floor(budget / 2)),
    stderr: compactLog(parsed.stderr, Math.floor(budget / 2)),
    truncated: {
      stdout: parsed.truncated?.stdout === true || Buffer.byteLength(parsed.stdout, "utf8") > Math.floor(budget / 2),
      stderr: parsed.truncated?.stderr === true || Buffer.byteLength(parsed.stderr, "utf8") > Math.floor(budget / 2),
    },
  };
  return JSON.stringify(compact);
}

function compactLog(value: string, budget: number): string {
  if (Buffer.byteLength(value, "utf8") <= budget) {return value;}
  const diagnostics = value.split(/\r?\n/).filter((line) => /\b(error|failed|failure|exception|fatal)\b|\bTS\d{4}\b/i.test(line));
  if (!diagnostics.length) {return boundText(value, budget);}
  const evidence = boundText(diagnostics.join("\n"), Math.floor(budget / 2));
  return evidence + "\n" + boundText(value, Math.max(0, budget - Buffer.byteLength(evidence, "utf8") - 1));
}

function boundText(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {return value;}
  const markerBytes = Buffer.byteLength(OMITTED_MIDDLE_MARKER, "utf8");
  if (markerBytes > maxBytes) {return takeUtf8Head(value, maxBytes);}
  const sideBudget = Math.max(0, Math.floor((maxBytes - markerBytes) / 2));
  const head = takeUtf8Head(value, sideBudget);
  const tail = takeUtf8Tail(value.slice(head.length), sideBudget);
  return `${head}${OMITTED_MIDDLE_MARKER}${tail}`;
}
