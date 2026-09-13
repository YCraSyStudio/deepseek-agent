import { REASONING_EFFORT_VALUES, type ReasoningEffort } from "@/contracts";

export { DEFAULT_CONFIG } from "@/contracts/Config";
export { MODEL_OPTIONS } from "@/contracts/deepseek/Models";

const REASONING_EFFORT_LABELS = {
  low: "chat.low",
  high: "chat.high",
  max: "chat.max",
} as const satisfies Record<ReasoningEffort, string>;

export const REASONING_EFFORT_OPTIONS = REASONING_EFFORT_VALUES.map((value) => ({
  value,
  label: REASONING_EFFORT_LABELS[value],
}));
