import type { AppConfig } from "../Config";
import type { ImageAttachment, ReferencedFile } from "./WebviewModels";

export type WebviewToHandlerMessage =
  | { type: "initializeProtocol"; protocolVersion: 5 }
  | { type: "getConfig" }
  | { type: "saveConfig"; requestId: string; config: Partial<AppConfig> }
  | { type: "resetConfig"; requestId: string }
  | { type: "resolveHistoryTransition"; requestId: string; decision: "stop" | "save" | "discard" | "cancel" }
  | { type: "deleteApiKey"; requestId: string }
  | { type: "testConnection"; apiKey?: string; baseUrl: string; model: string }
  | {
      type: "sendMessage";
      clientRequestId: string;
      text: string;
      modelId: string;
      reasoning: string;
      conversationId?: string;
      workspaceRevision?: string;
      referencedFiles?: ReferencedFile[];
      imageAttachments?: ImageAttachment[];
    }
  | {
      type: "steerGeneration";
      generationId: string;
      clientRequestId: string;
      text: string;
      modelId: string;
      reasoning: string;
      conversationId: string;
      workspaceRevision?: string;
      referencedFiles?: ReferencedFile[];
      imageAttachments?: ImageAttachment[];
    }
  | { type: "cancelGeneration"; requestId: string; generationId: string; conversationId: string }
  | { type: "getGenerationSnapshot" }
  | { type: "compactContext"; requestId: string; conversationId?: string }
  | { type: "consumeRecoveredDraft"; conversationId: string; clientRequestId: string }
  | { type: "copyCode"; code: string }
  | { type: "insertCode"; code: string; conversationId?: string; workspaceRevision?: string }
  | { type: "selectModel"; modelId: string }
  | { type: "newConversation"; requestId: string }
  | { type: "getHistory" }
  | { type: "loadConversation"; requestId: string; id: string }
  | { type: "loadConversationPage"; requestId: string; id: string; cursor: string }
  | { type: "deleteConversation"; id: string }
  | { type: "deleteConversations"; ids: string[] }
  | { type: "executeToolCall"; generationId: string; toolCallId: string; action: "execute" | "reject" }
  | { type: "getWorkspaceContext"; requestId: string; conversationId?: string }
  | { type: "rebindConversationWorkspace"; conversationId: string; workspaceRevision?: string }
  | { type: "openConversationWorkspace"; conversationId: string }
  | { type: "selectAttachments"; requestId: string; conversationId?: string }
  | { type: "getPathCompletions"; requestId: number; query: string; conversationId?: string; workspaceRevision?: string }
  | { type: "getAvailableTools" }
  | { type: "uploadClipboardImage"; requestId: string; name: string; mediaType: string; size: number; dataBase64: string }
  | { type: "deleteImageAttachment"; requestId: string; attachment: ImageAttachment }
  | { type: "openFile"; path: string; line?: number; conversationId?: string; workspaceRevision?: string }
  | { type: "openFileDiff"; path: string; diff?: string; beforeHash?: string; afterHash?: string; preview?: boolean; conversationId?: string; workspaceRevision?: string };
