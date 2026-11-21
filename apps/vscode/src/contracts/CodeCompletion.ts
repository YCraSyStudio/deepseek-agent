export interface CodeCompletionRequest {
  mode: "prefix" | "fim";
  prefix: string;
  instruction?: string;
  suffix?: string;
  reasoningPrefix?: string;
  maxTokens?: number;
  stop?: string[];
}
