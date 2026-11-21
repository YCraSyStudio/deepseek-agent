import type { PathCompletionItem } from "@/contracts";

/** Headers are not selectable: keyboard indices follow the visible option order. */
export function orderPathCompletions(items: readonly PathCompletionItem[]): PathCompletionItem[] {
  return [
    ...items.filter((item) => item.type !== "instruction"),
    ...items.filter((item) => item.type === "instruction" && item.instructionScope === "workspace"),
    ...items.filter((item) => item.type === "instruction" && item.instructionScope === "global"),
  ];
}
