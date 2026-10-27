import type { ChatCompletionRequest } from "@/contracts";
import { DeepSeekApiError } from "@/infrastructure/deepseek/errors/DeepSeekApiError";

export function recoverMissingHistoricalFiles<T extends Partial<ChatCompletionRequest>>(request: T, error: unknown): T | undefined {
  if (!(error instanceof DeepSeekApiError) || error.status !== 400) {return;}
  const match = /the following file_ids do not exist or are not created under your account:\s*([\s\S]+)/i.exec(error.message);
  if (!match || !request.messages) {return;}
  const missing = new Set(match[1].match(/\bfile-[a-zA-Z0-9-]+\b/g) ?? []);
  let currentTurn = -1;
  request.messages.forEach((message, index) => {if (message.role === "user") {currentTurn = index;}});
  if (request.messages.slice(currentTurn).some(message => Array.isArray(message.content) &&
    message.content.some(part => part.type === "file" && missing.has(part.file_id)))) {return;}
  let changed = false;
  const messages = request.messages.map((message, index) => {
    if (index >= currentTurn || !Array.isArray(message.content)) {return message;}
    const content = message.content.map(part => {
      if (part.type !== "file" || !missing.has(part.file_id)) {return part;}
      changed = true;
      return { type: "text" as const, text: "[A historical image is no longer available from the provider. Its visual contents are unavailable; ask the user to attach it again if needed. Do not infer them.]" };
    });
    return { ...message, content };
  });
  return changed ? { ...request, messages } : undefined;
}
