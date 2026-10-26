import { draftAttachmentsOperation as legacyDraftAttachmentsOperation } from "./LegacyDraftAttachments";
import { draftAttachmentsOperation, readChatDraft, writeChatDraftMetadata } from "./DraftAttachmentsStore";
import { getVsCodeApi } from "@webview/VsCodeApi";
import type { PendingImagePreview } from "./ClipboardUploads";
import type { ImageAttachment, ReferencedFile } from "@/contracts";

export interface PersistentChatViewState {
  schemaVersion: 5;
  mode: "persistent";
  draft: string;
  referencedFiles: ReferencedFile[];
  imageAttachments: ImageAttachment[];
  conversationId?: string;
}

type ChatDraft = Pick<PersistentChatViewState, "draft" | "referencedFiles" | "imageAttachments" | "conversationId">;
type DraftState = PersistentChatViewState & { drafts?: Record<string, ChatDraft>; draftStorageId?: string };
let storageId: string | undefined;
function storageKey(conversationId?: string): string {
  storageId = readState()?.draftStorageId ?? storageId ?? crypto.randomUUID();
  return `${storageId}:${draftKey(conversationId)}`;
}
function reportStorageError(error: unknown): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("draft-attachments-error", { detail: String(error) }));
  }
}
function deleteStoredAttachments(conversationId?: string): void {
  void draftAttachmentsOperation(conversationId, "delete").catch(reportStorageError);
}
const sessionReferences = new Map<string, ReferencedFile[]>();
const pendingDraftImages = new Map<string, Array<{ name: string; file: File }>>();
const draftKey = (conversationId?: string) => conversationId ? `chat:${conversationId}` : "new";

function readState(): DraftState | undefined {
  const state = getVsCodeApi()?.getState<DraftState>();
  return state?.schemaVersion === 5 && state.mode === "persistent" ? state : undefined;
}

function sanitizeDraft(state: Partial<ChatDraft>): ChatDraft {
  return {
    draft: typeof state.draft === "string" ? state.draft : "",
    referencedFiles: Array.isArray(state.referencedFiles)
      ? state.referencedFiles.filter(isReferencedFile).filter((file) => file.scope !== "external-snapshot") : [],
    imageAttachments: Array.isArray(state.imageAttachments) ? state.imageAttachments.filter(isImageAttachment) : [],
    conversationId: typeof state.conversationId === "string" && state.conversationId.trim() ? state.conversationId : undefined,
  };
}

function allDrafts(state: DraftState | undefined): Record<string, ChatDraft> {
  const entries = state?.drafts && typeof state.drafts === "object" ? Object.entries(state.drafts) : [];
  const drafts = Object.fromEntries(entries.filter(([, value]) => value && typeof value === "object")
    .map(([key, value]) => [key, sanitizeDraft(value)]));
  if (state) {
    const current = sanitizeDraft(state);
    drafts[draftKey(current.conversationId)] = current;
  }
  return drafts;
}

export function saveChatDraft(state: PersistentChatViewState, previous?: { conversationId?: string }, persist = true): void {
  const drafts = allDrafts(readState());
  if (previous && previous.conversationId !== state.conversationId) {
    deleteStoredAttachments(previous.conversationId);
    delete drafts[draftKey(previous.conversationId)];
    pendingDraftImages.delete(draftKey(previous.conversationId));
    sessionReferences.delete(draftKey(previous.conversationId));
  }
  const current = sanitizeDraft(state);
  sessionReferences.set(draftKey(current.conversationId), state.referencedFiles.filter(file => file.scope === "external-snapshot"));
  drafts[draftKey(current.conversationId)] = current;
  storageKey(current.conversationId);
  getVsCodeApi()?.setState<DraftState>({ ...state, ...current, drafts, draftStorageId: storageId });
  if (persist) {void writeChatDraftMetadata(current.conversationId, { ...current, referencedFiles: state.referencedFiles }).catch(reportStorageError);}
}

export function selectNewChatDraft(): void {
  if (getVsCodeApi()?.getState<{ mode?: string }>()?.mode === "incognito") {return;}
  const draft = getChatDraft() ?? { schemaVersion: 5 as const, mode: "persistent" as const,
    draft: "", referencedFiles: [], imageAttachments: [] };
  saveChatDraft(draft, undefined, false);
}

export function clearSavedChatState(conversationId?: string): void {
  if (conversationId === undefined) {
    for (const draft of Object.values(allDrafts(readState()))) {deleteStoredAttachments(draft.conversationId);}
    pendingDraftImages.clear(); sessionReferences.clear();
  }
  else {deleteStoredAttachments(conversationId); pendingDraftImages.delete(draftKey(conversationId)); sessionReferences.delete(draftKey(conversationId));}
  const state = readState();
  if (!state) {return;}
  const drafts = allDrafts(state);
  if (conversationId !== undefined) {
    if (!Object.hasOwn(drafts, draftKey(conversationId))) {return;}
    delete drafts[draftKey(conversationId)];
  }
  const current = conversationId !== undefined && state.conversationId !== conversationId
    ? sanitizeDraft(state) : (conversationId !== undefined ? drafts.new : undefined) ??
      { draft: "", referencedFiles: [], imageAttachments: [], conversationId: undefined };
  getVsCodeApi()?.setState<DraftState>({ schemaVersion: 5, mode: "persistent", ...current,
    drafts: conversationId === undefined ? {} : drafts, draftStorageId: state.draftStorageId });
}

export function getSavedChatState(): PersistentChatViewState | undefined {
  const state = readState();
  return state ? restoreSessionReferences({ schemaVersion: 5, mode: "persistent", ...sanitizeDraft(state) }) : undefined;
}

export function getChatDraft(conversationId?: string): PersistentChatViewState | undefined {
  const value = allDrafts(readState())[draftKey(conversationId)];
  return value ? restoreSessionReferences({ schemaVersion: 5, mode: "persistent", ...value, conversationId }) : undefined;
}

function restoreSessionReferences(state: PersistentChatViewState): PersistentChatViewState {
  return { ...state, referencedFiles: [...state.referencedFiles, ...(sessionReferences.get(draftKey(state.conversationId)) ?? [])] };
}

// Restore fresh blob URLs; each previous view revokes its own previews.
export function savePendingDraftImages(conversationId: string | undefined, previews: PendingImagePreview[]): void {
  const files = previews.flatMap(({ name, file }) => file ? [{ name, file }] : []);
  if (files.length) {pendingDraftImages.set(draftKey(conversationId), files);}
  else {pendingDraftImages.delete(draftKey(conversationId));}
}

export function restorePendingDraftImages(conversationId?: string): PendingImagePreview[] {
  return (pendingDraftImages.get(draftKey(conversationId)) ?? []).map(({ name, file }) => ({
    name, file, requestId: crypto.randomUUID(), previewUri: URL.createObjectURL(file),
  }));
}

export async function persistDraftAttachments(conversationId?: string): Promise<void> {
  const images = pendingDraftImages.get(draftKey(conversationId)) ?? [];
  const references = sessionReferences.get(draftKey(conversationId)) ?? [];
  await draftAttachmentsOperation(conversationId, "write", { images, references });
}

export async function hydrateDraftAttachments(conversationId?: string): Promise<void> {
  const result = await readChatDraft(conversationId);
  let stored = result.attachments;
  if (!result.draft && !stored) {
    const previous = getChatDraft(conversationId);
    if (previous) {
      // Upgrade drafts from the previous webview-only storage after a successful read.
      try {stored = await legacyDraftAttachmentsOperation(storageKey(conversationId), "read");} catch { /* Legacy storage may be absent. */ }
      await writeChatDraftMetadata(conversationId, previous);
      if (stored) {
        await draftAttachmentsOperation(conversationId, "write", stored);
        await legacyDraftAttachmentsOperation(storageKey(conversationId), "delete");
      }
    }
  }
  if (result.draft) {
    saveChatDraft({ schemaVersion: 5, mode: "persistent", ...result.draft, conversationId }, undefined, false);
  }
  if (stored) {
    pendingDraftImages.set(draftKey(conversationId), stored.images);
    sessionReferences.set(draftKey(conversationId), stored.references);
  }
}

export function referenceIdentity(file: ReferencedFile): string {
  return file.referenceId ?? `${file.scope ?? "workspace"}:${file.path}`;
}

export function isImageAttachment(value: unknown): value is ImageAttachment {
  if (!value || typeof value !== "object") {return false;}
  const image = value as Partial<ImageAttachment>;
  return typeof image.id === "string" && typeof image.fileId === "string" &&
    (image.imageNumber === undefined || (Number.isSafeInteger(image.imageNumber) && image.imageNumber > 0)) &&
    typeof image.name === "string" && typeof image.previewUri === "string" &&
    typeof image.expiresAt === "number" && image.expiresAt > Date.now();
}

export function isReferencedFile(value: unknown): value is ReferencedFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const file = value as Partial<ReferencedFile>;
  return typeof file.path === "string" && typeof file.name === "string" && (file.type === "file" || file.type === "directory");
}

export function mergeReferencedFiles(currentFiles: ReferencedFile[], newFiles: ReferencedFile[]): ReferencedFile[] {
  const seen = new Set(currentFiles.map((file) => file.path));
  const uniqueNewFiles = newFiles.filter((file) => {
    if (seen.has(file.path)) {
      return false;
    }
    seen.add(file.path);
    return true;
  });
  return [...currentFiles, ...uniqueNewFiles];
}
