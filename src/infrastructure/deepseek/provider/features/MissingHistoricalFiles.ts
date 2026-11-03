import type { ChatCompletionRequest, ChatMessage } from "@/contracts";
import { DeepSeekApiError } from "@/infrastructure/deepseek/errors/DeepSeekApiError";

/** A generation remembers rejected historical IDs, never current attachments or new captures. */
export class HistoricalFileRecovery {
  private historical?: Set<string>;
  private readonly rejected = new Set<string>();

  constructor(initialMessages?: ChatMessage[]) {
    if (initialMessages) {this.historical = historicalFileIds(initialMessages);}
  }

  prepare<T extends Partial<ChatCompletionRequest>>(request: T): T {
    this.historical ??= historicalFileIds(request.messages ?? []);
    return replaceUnavailableFiles(request, this.rejected) ?? request;
  }

  recover<T extends Partial<ChatCompletionRequest>>(request: T, error: unknown): T | undefined {
    if (!(error instanceof DeepSeekApiError) || error.status !== 400 || !request.messages) {return;}
    const match = /the following file_ids do not exist or are not created under your account:\s*([^\r\n]*)/i.exec(error.message);
    if (!match) {return;}
    this.historical ??= historicalFileIds(request.messages);
    const missing = new Set(match[1].match(/\bfile-[a-zA-Z0-9_-]+\b/g) ?? []);
    // If a current attachment or new capture is missing, do not silently remove it.
    const referenced = fileIds(request.messages);
    if ([...missing].some(id => referenced.has(id) && !this.historical!.has(id))) {return;}
    const recoverable = new Set([...missing].filter(id => this.historical!.has(id)));
    const recovered = replaceUnavailableFiles(request, recoverable);
    if (!recovered) {return;}
    for (const id of recoverable) {this.rejected.add(id);}
    return recovered;
  }
}

export function recoverMissingHistoricalFiles<T extends Partial<ChatCompletionRequest>>(request: T, error: unknown): T | undefined {
  return new HistoricalFileRecovery(request.messages).recover(request, error);
}

function historicalFileIds(messages: ChatMessage[]): Set<string> {
  let currentTurn = -1;
  messages.forEach((message, index) => {if (message.role === "user") {currentTurn = index;}});
  if (currentTurn < 0) {return new Set();}
  const historical = fileIds(messages.slice(0, currentTurn));
  for (const id of fileIds(messages.slice(currentTurn))) {historical.delete(id);}
  return historical;
}

function fileIds(messages: ChatMessage[]): Set<string> {
  return new Set(messages.flatMap(message => Array.isArray(message.content)
    ? message.content.flatMap(part => part.type === "file" ? [part.file_id] : []) : []));
}

function replaceUnavailableFiles<T extends Partial<ChatCompletionRequest>>(request: T, missing: ReadonlySet<string>): T | undefined {
  if (!missing.size || !request.messages) {return;}
  let changed = false;
  const messages = request.messages.map(message => {
    if (!Array.isArray(message.content)) {return message;}
    const content = message.content.map(part => {
      if (part.type !== "file" || !missing.has(part.file_id)) {return part;}
      changed = true;
      return { type: "text" as const, text: "[A historical image is no longer available from the provider. Its visual contents are unavailable in this context. Reopen its saved conversation image using view_image (native vision) or analyze_images (delegated vision). Provider unavailability does not mean the local copy is missing. If retrieval fails, ask the user to attach it again only if needed. Do not infer them.]" };
    });
    return { ...message, content };
  });
  return changed ? { ...request, messages } : undefined;
}
