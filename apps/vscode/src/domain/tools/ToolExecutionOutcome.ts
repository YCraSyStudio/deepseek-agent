export type ToolExecutionOutcome =
  | { kind: "completed"; content: string }
  | { kind: "error"; content: string }
  | { kind: "rejected"; content: string }
  | { kind: "cancelled"; content: string }
  | { kind: "skipped"; content: string }
  | {
      kind: "confirmation_required";
      content: string;
      dangerLevel: "safe" | "caution" | "dangerous" | "destructive";
    };
