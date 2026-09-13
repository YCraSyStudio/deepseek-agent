import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  GenerationSnapshot,
  ImageAttachment,
  QueuedGenerationMessage,
  ReferencedFile,
  WorkspaceContextStatus,
} from "@/contracts";
import type { ChatMessage } from "../ChatViewTypes";

type ChatCommandMessage =
  | { type: "addReferencedFiles"; files: ReferencedFile[] }
  | { type: "clearChat" }
  | { type: "setDraft"; text: string }
  | { type: "generationAccepted"; generationId: string; conversationId: string; clientRequestId: string }
  | { type: "messageQueued"; conversationId: string; clientRequestId: string; position: number }
  | { type: "requestRejected"; requestId?: string; action?: string; error: string }
  | { type: "protocolError"; supportedVersion: number; error: string }
  | { type: "streamDone"; generationId?: string; conversationId?: string; status: "completed" | "cancelled" | "interrupted" }
  | { type: "streamError"; generationId?: string; conversationId?: string }
  | { type: "workspaceContextChanged"; requestId?: string; conversationId?: string; context: WorkspaceContextStatus }
  | { type: "contextFilesSelected"; files: ReferencedFile[] }
  | { type: "imageAttachmentsSelected"; requestId: string; attachments: ImageAttachment[]; error?: string }
  | { type: "imageAttachmentDeleted"; requestId: string; fileId: string; success: boolean; error?: string }
  | { type: "generationSnapshot"; generations: GenerationSnapshot[]; recoveredDrafts: Array<{ conversationId: string; messages: QueuedGenerationMessage[] }> };

export interface PendingChatRequest {
  text: string;
  referenceIds: string[];
  imageIds: string[];
}

interface ChatCommandRefs {
  activeGenerationId: MutableRefObject<string | undefined>;
  conversationId: MutableRefObject<string | undefined>;
  draft: MutableRefObject<string>;
  imageAttachments: MutableRefObject<ImageAttachment[]>;
  pendingRequests: MutableRefObject<Map<string, PendingChatRequest>>;
  referencedFiles: MutableRefObject<ReferencedFile[]>;
  workspaceRequestId: MutableRefObject<string | undefined>;
}

interface ChatCommandSetters {
  setActiveGenerationId: Dispatch<SetStateAction<string | undefined>>;
  setConversationId: Dispatch<SetStateAction<string | undefined>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setImageAttachments: Dispatch<SetStateAction<ImageAttachment[]>>;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setRecoveredDrafts: Dispatch<SetStateAction<QueuedGenerationMessage[]>>;
  setReferencedFiles: Dispatch<SetStateAction<ReferencedFile[]>>;
  setRequestError: Dispatch<SetStateAction<string | undefined>>;
  setWorkspaceContext: Dispatch<SetStateAction<WorkspaceContextStatus | undefined>>;
}

interface UseChatCommandMessagesOptions {
  appendReferencedFiles: (files: ReferencedFile[]) => void;
  focusInput: () => void;
  refs: ChatCommandRefs;
  setters: ChatCommandSetters;
}

export function useChatCommandMessages({
  appendReferencedFiles,
  focusInput,
  refs,
  setters,
}: UseChatCommandMessagesOptions): void {
  useEffect(() => {
    const handleMessage = (event: MessageEvent<ChatCommandMessage>) => {
      const message = event.data;
      if (message.type === "addReferencedFiles" || message.type === "contextFilesSelected") {
        appendReferencedFiles(message.files);
      }
      if (message.type === "imageAttachmentsSelected") {
        if (message.error) {
          setters.setRequestError(message.error);
        }
        if (message.attachments.length > 0) {
          setters.setImageAttachments((current) => [...current, ...message.attachments].slice(0, 8));
          requestAnimationFrame(focusInput);
        }
      }
      if (message.type === "imageAttachmentDeleted" && !message.success && message.error) {
        setters.setRequestError(message.error);
      }
      if (message.type === "setDraft") {
        setters.setDraft(message.text);
        requestAnimationFrame(focusInput);
      }
      if (message.type === "clearChat") {
        clearChatState(refs, setters);
      }
      if (message.type === "workspaceContextChanged") {
        applyWorkspaceContext(message, refs, setters);
      }
      if (message.type === "generationAccepted") {
        applyGenerationAccepted(message, refs, setters);
      }
      if (message.type === "messageQueued") {
        const submitted = refs.pendingRequests.current.get(message.clientRequestId);
        if (submitted && (!refs.conversationId.current || refs.conversationId.current === message.conversationId)) {
          refs.conversationId.current = message.conversationId;
          setters.setConversationId(message.conversationId);
        }
      }
      if (message.type === "requestRejected") {
        if (message.requestId) {
          refs.pendingRequests.current.delete(message.requestId);
        }
        setters.setRequestError(message.error);
      }
      if (message.type === "protocolError") {
        setters.setRequestError(message.error);
      }
      if (
        (message.type === "streamDone" || message.type === "streamError") &&
        message.generationId === refs.activeGenerationId.current
      ) {
        refs.activeGenerationId.current = undefined;
        setters.setActiveGenerationId(undefined);
      }
      if (message.type === "generationSnapshot") {
        applyGenerationSnapshot(message, refs, setters);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [appendReferencedFiles, focusInput]);
}

function clearChatState(refs: ChatCommandRefs, setters: ChatCommandSetters): void {
  refs.conversationId.current = undefined;
  refs.activeGenerationId.current = undefined;
  refs.pendingRequests.current.clear();
  setters.setConversationId(undefined);
  setters.setActiveGenerationId(undefined);
  setters.setMessages([]);
  setters.setIsProcessing(false);
  setters.setReferencedFiles([]);
  setters.setImageAttachments([]);
  setters.setDraft("");
  setters.setRecoveredDrafts([]);
}

function applyWorkspaceContext(
  message: Extract<ChatCommandMessage, { type: "workspaceContextChanged" }>,
  refs: ChatCommandRefs,
  setters: ChatCommandSetters,
): void {
  if (message.requestId && message.requestId !== refs.workspaceRequestId.current) {
    return;
  }
  if (message.conversationId !== undefined && message.conversationId !== refs.conversationId.current) {
    return;
  }
  setters.setWorkspaceContext((previous) => {
    if (previous?.binding.revision && previous.binding.revision !== message.context.binding.revision) {
      setters.setReferencedFiles((files) => files.filter((file) => file.scope === "external-snapshot"));
    }
    return message.context;
  });
}

function applyGenerationAccepted(
  message: Extract<ChatCommandMessage, { type: "generationAccepted" }>,
  refs: ChatCommandRefs,
  setters: ChatCommandSetters,
): void {
  const submitted = refs.pendingRequests.current.get(message.clientRequestId);
  refs.pendingRequests.current.delete(message.clientRequestId);
  if (submitted && refs.draft.current.trim() === submitted.text) {
    refs.draft.current = "";
    setters.setDraft("");
  }
  if (submitted && sameReferenceSet(refs.referencedFiles.current, submitted.referenceIds)) {
    refs.referencedFiles.current = [];
    setters.setReferencedFiles([]);
  }
  if (submitted && sameImageSet(refs.imageAttachments.current, submitted.imageIds)) {
    refs.imageAttachments.current = [];
    setters.setImageAttachments([]);
  }
  if (submitted || message.conversationId === refs.conversationId.current) {
    refs.conversationId.current = message.conversationId;
    refs.activeGenerationId.current = message.generationId;
    setters.setConversationId(message.conversationId);
    setters.setActiveGenerationId(message.generationId);
    setters.setIsProcessing(true);
  }
}

function applyGenerationSnapshot(
  message: Extract<ChatCommandMessage, { type: "generationSnapshot" }>,
  refs: ChatCommandRefs,
  setters: ChatCommandSetters,
): void {
  const currentConversationId = refs.conversationId.current;
  const active = currentConversationId
    ? message.generations.find((generation) => generation.conversationId === currentConversationId)
    : undefined;
  if (active) {
    refs.activeGenerationId.current = active.generationId;
    setters.setActiveGenerationId(active.generationId);
    setters.setIsProcessing(true);
    setters.setMessages((current) => {
      const withoutPriorSnapshot = current.filter(
        (item) => item.generationId !== active.generationId || item.role === "user",
      );
      if (!active.content && active.timeline.length === 0 && active.toolCalls.length === 0) {
        return withoutPriorSnapshot;
      }
      return [...withoutPriorSnapshot, {
        id: `active-${active.generationId}`,
        role: "assistant",
        content: active.content,
        timeline: active.timeline,
        toolCalls: active.toolCalls,
        generationId: active.generationId,
      }];
    });
  }
  const recovered = currentConversationId
    ? message.recoveredDrafts.find((entry) => entry.conversationId === currentConversationId)
    : undefined;
  if (recovered?.messages.length) {
    setters.setRecoveredDrafts(recovered.messages);
  }
}

function sameReferenceSet(files: ReferencedFile[], expected: string[]): boolean {
  return files.length === expected.length && files.every((file, index) => referenceIdentity(file) === expected[index]);
}

function sameImageSet(images: ImageAttachment[], expected: string[]): boolean {
  return images.length === expected.length && images.every((image, index) => image.id === expected[index]);
}

function referenceIdentity(file: ReferencedFile): string {
  return file.referenceId ?? `${file.scope ?? "workspace"}:${file.path}`;
}
