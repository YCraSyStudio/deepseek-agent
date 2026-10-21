import { createHash } from "node:crypto";
import type { DeepSeekWebClient } from "@/infrastructure/deepseek/web/DeepSeekWebClient";
import type { WebAccessPolicy } from "./NetworkPolicy";

export interface RenderedPage {
  title: string;
  url: string;
  content: string;
  sections?: string[];
  outline: string[];
  links: Array<{ title: string; url: string; snippet?: string }>;
  contentHash: string;
  injectionRisk: "none" | "suspected";
}

/** Retains the web-tool lifecycle while delegating all page retrieval to DeepSeek Fetch. */
export class HeadlessWebRuntime {
  constructor(private readonly client: DeepSeekWebClient) {}

  async render(url: string, policy: WebAccessPolicy, signal?: AbortSignal): Promise<RenderedPage> {
    const authorized = policy.assertNavigationAllowed(url).toString();
    const page = await this.client.fetchPage(authorized, signal);
    return createRenderedPage(page.title, authorized, page.content);
  }

  getDiagnostics(): Record<string, unknown> {return this.client.getDiagnostics();}
  async dispose(): Promise<void> {this.client.dispose();}
}

export function createRenderedPage(title: string, url: string, rawContent: string): RenderedPage {
  const content = rawContent.replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").trim();
  if (!content) {throw new Error("The web page did not return readable text content");}
  return {
    title, url, content, sections: [content], outline: [], links: [],
    contentHash: createHash("sha256").update(content).digest("hex"),
    injectionRisk: detectPromptInjection(content) ? "suspected" : "none",
  };
}

export function detectPromptInjection(content: string): boolean {
  const normalized = content.normalize("NFKC").toLowerCase();
  return [
    /ignore (?:all |any )?(?:previous|prior|system) instructions/,
    /reveal (?:the )?(?:system prompt|developer message|secret|api key)/,
    /you are now (?:a|an|in) /,
    /(?:execute|run) (?:this|the following) (?:command|tool)/,
    /do not tell the user/,
    /(?:system|developer) (?:message|instruction|prompt)/,
    /(?:upload|send|exfiltrate) .{0,80}(?:secret|credential|token|key|file)/,
    /(?:call|invoke|use) .{0,40}(?:tool|function)/,
    /<\|(?:system|developer|assistant)\|>|\[inst\]/,
  ].some((pattern) => pattern.test(normalized));
}
