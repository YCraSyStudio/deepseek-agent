import type { ImageAttachment, ReferencedFile } from "@/contracts";
import type { SteeringContinuation } from "@/application/chat/SteeringContinuation";

export interface HistoryTransitionState {
  requestId: string;
  direction: "enter-incognito" | "exit-incognito";
  phase: "stop-work" | "exit-incognito";
}

export interface SendMessagePayload {
  clientRequestId: string;
  text: string;
  modelId: string;
  reasoning: string;
  conversationId?: string;
  workspaceRevision?: string;
  referencedFiles?: ReferencedFile[];
  imageAttachments?: ImageAttachment[];
  steering?: SteeringContinuation;
}
