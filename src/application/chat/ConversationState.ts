import type { ChatMessage, ChatPersistenceMode, ConversationMessage, WorkspaceBinding } from "@/contracts";
import { randomUUID } from "crypto";
import { createConversationTitle } from "./ConversationTitle";
import type {
  ConversationContextSummary,
  StoredConversation,
  StoredConversationMessage,
} from "./ProviderTranscript";
import { getFinalAssistantContent } from "./ProviderTranscript";

export interface ApiContextUnit {
  generationId: string;
  messages: ChatMessage[];
  visibleText: string;
}

export interface ConversationStore {
  save(conversation: StoredConversation): Promise<void>;
  getWorkspaceUri?(): string;
  getWorkspaceBinding?(): WorkspaceBinding;
}

export interface SaveConversationTurnOptions {
  userMessage: StoredConversationMessage;
  assistantMessage: StoredConversationMessage;
  model: string;
}

export interface SaveConversationMessagesOptions {
  messages: StoredConversationMessage[];
  model: string;
}

export class ConversationState {
  private activeConversation: StoredConversation | null = null;

  constructor(
    private readonly conversationStore: ConversationStore,
    private persistenceMode: ChatPersistenceMode = "persistent",
  ) {}

  load(conversation: StoredConversation): void {
    this.activeConversation = compactCompletedConversation(conversation);
  }

  reset(mode: ChatPersistenceMode = this.persistenceMode): void {
    this.activeConversation = null;
    this.persistenceMode = mode;
  }

  getPersistenceMode(): ChatPersistenceMode {
    return this.persistenceMode;
  }

  isIncognito(): boolean {
    return this.persistenceMode === "incognito";
  }

  hasMessages(): boolean {
    return (this.activeConversation?.messages.length ?? 0) > 0;
  }

  async promoteIncognito(): Promise<void> {
    if (this.persistenceMode !== "incognito" || !this.activeConversation) {
      return;
    }
    await this.conversationStore.save(structuredClone(this.activeConversation));
    this.persistenceMode = "persistent";
  }

  forget(id: string): boolean {
    if (this.activeConversation?.id === id) {
      this.reset();
      return true;
    }
    return false;
  }

  getActiveConversationId(): string | undefined {
    return this.activeConversation?.id;
  }

  getConversation(): StoredConversation | undefined {
    return this.activeConversation ? structuredClone(this.activeConversation) : undefined;
  }

  getApiMessages(): ChatMessage[] {
    return this.getApiContextUnits().flatMap((unit) => unit.messages);
  }

  getApiContextUnits(): ApiContextUnit[] {
    const conversation = this.activeConversation;
    if (!conversation) {
      return [];
    }

    const coveredGenerationIds = new Set(
      conversation.contextSummary?.coveredGenerationIds ?? [],
    );
    const grouped = new Map<string, StoredConversationMessage[]>();
    for (const message of conversation.messages) {
      const generationId = message.generationId ?? `message:${message.id}`;
      if (coveredGenerationIds.has(generationId)) {
        continue;
      }
      const existing = grouped.get(generationId);
      if (existing) {
        existing.push(message);
      } else {
        grouped.set(generationId, [message]);
      }
    }

    return [...grouped.entries()]
      .map(([generationId, messages]) => ({
        generationId,
        messages: toApiMessages(messages),
        visibleText: toVisibleContextText(messages),
      }))
      .filter((unit) => unit.messages.length > 0);
  }

  createMessage(
    role: ConversationMessage["role"],
    content: string,
    extra: Pick<StoredConversationMessage, "timeline" | "toolCalls" | "generationId" | "generationStatus" | "generationStopReason" | "providerTranscript" | "contextContent" | "usage" | "imageAttachments"> = {},
  ): StoredConversationMessage {
    return {
      id: randomUUID(),
      role,
      content,
      createdAt: Date.now(),
      ...extra,
    };
  }

  async saveTurn(options: SaveConversationTurnOptions): Promise<void> {
    await this.saveMessages({
      messages: [options.userMessage, options.assistantMessage],
      model: options.model,
    });
  }

  async saveMessages(options: SaveConversationMessagesOptions): Promise<void> {
    if (options.messages.length === 0) {
      return;
    }

    const existing = this.activeConversation;
    const now = nextUpdatedAt(existing?.updatedAt);
    const nextMessages = [...(existing?.messages ?? []), ...options.messages].map(compactCompletedMessage);
    const workspaceBinding = existing?.workspaceBinding ?? this.conversationStore.getWorkspaceBinding?.() ?? createUnknownWorkspaceBinding();
    const conversation: StoredConversation = {
      schemaVersion: 2,
      id: existing?.id ?? randomUUID(),
      title: createConversationTitle(nextMessages, existing?.title),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      model: options.model,
      workspaceUri: existing?.workspaceUri ?? workspaceBinding.uri,
      workspaceBinding,
      workspaceRebindings: existing?.workspaceRebindings,
      contextSummary: existing?.contextSummary,
      messages: nextMessages,
    };

    this.activeConversation = conversation;
    if (this.persistenceMode === "persistent") {
      await this.conversationStore.save(conversation);
    }
  }

  async updateMessageAttachments(messageId: string, attachments: NonNullable<StoredConversationMessage["imageAttachments"]>): Promise<void> {
    if (!this.activeConversation) {throw new Error("No active conversation");}
    const message = this.activeConversation.messages.find((item) => item.id === messageId);
    if (!message) {throw new Error("Conversation message not found");}
    message.imageAttachments = structuredClone(attachments);
    if (this.persistenceMode === "persistent") {await this.conversationStore.save(this.activeConversation);}
  }

  async saveContextSummary(summary: ConversationContextSummary): Promise<void> {
    if (!this.activeConversation) {
      throw new Error("Cannot save context summary without an active conversation");
    }
    this.activeConversation = {
      ...this.activeConversation,
      contextSummary: structuredClone(summary),
      updatedAt: nextUpdatedAt(this.activeConversation.updatedAt),
    };
    if (this.persistenceMode === "persistent") {
      await this.conversationStore.save(this.activeConversation);
    }
  }
}

function nextUpdatedAt(previous?: number): number {
  return Math.max(Date.now(), (previous ?? 0) + 1);
}

function createUnknownWorkspaceBinding(): WorkspaceBinding {
  return {
    schemaVersion: 1,
    uri: "workspace:unknown",
    name: "Unknown workspace",
    revision: "unknown",
    folders: [],
    capabilities: { files: false, search: false, git: false, terminal: false },
  };
}

function toVisibleContextText(messages: StoredConversationMessage[]): string {
  return messages
    .flatMap((message) => {
      if (message.role === "user") {
        return [`User: ${message.content}`];
      }
      if (message.role === "assistant") {
        const content = message.contextContent ?? message.content;
        return content.trim() ? [`Assistant: ${content}`] : [];
      }
      return [];
    })
    .join("\n\n");
}

function toApiMessages(messages: StoredConversationMessage[]): ChatMessage[] {
  return messages.flatMap((message): ChatMessage[] => {
    if (message.role === "error" || message.role === "tool" || message.role === "context") {
      return [];
    }

    if (message.role === "user") {
      const validAttachments = message.imageAttachments?.filter((attachment) => attachment.expiresAt > Date.now()) ?? [];
      return [{
        role: "user" as const,
        content: validAttachments.length > 0
          ? [
              { type: "text" as const, text: message.content || "Describe the attached image." },
              ...validAttachments.map((attachment) => ({ type: "file" as const, file_id: attachment.fileId })),
            ]
          : message.content,
      }];
    }

    if (message.generationStatus === "interrupted" || message.generationStatus === "cancelled") {
      const interruptedContent = message.contextContent ?? message.content;
      return interruptedContent.trim() ? [{ role: "assistant" as const, content: interruptedContent }] : [];
    }

    const content = message.contextContent ?? message.content;
    return content.trim() ? [{ role: "assistant" as const, content }] : [];
  });
}

function compactCompletedConversation(conversation: StoredConversation): StoredConversation {
  return {
    ...structuredClone(conversation),
    messages: conversation.messages.map(compactCompletedMessage),
  };
}

function compactCompletedMessage(message: StoredConversationMessage): StoredConversationMessage {
  if (message.role !== "assistant" || message.providerTranscript?.status !== "complete") {
    return structuredClone(message);
  }
  const {
    providerTranscript,
    ...rest
  } = message;
  return {
    ...structuredClone(rest),
    contextContent: message.contextContent ?? getFinalAssistantContent(providerTranscript) ?? message.content,
  };
}
