import type { ImageAttachment } from "@/contracts";

export interface PendingImagePreview {
  requestId: string;
  name: string;
  previewUri: string;
  file?: File;
}

/** Keeps pasted images local until submission and cleans up cancelled uploads. */
export class ClipboardUploads {
  private readonly requests = new Map<string, PendingImagePreview & { removed: boolean }>();
  private readonly activeUploads = new Set<string>();
  private readonly waiters = new Map<string, { resolve: (attachments: ImageAttachment[]) => void; reject: (error: Error) => void }>();
  constructor(private readonly revoke: (uri: string) => void) {}

  add(preview: PendingImagePreview): void {
    this.requests.set(preview.requestId, { ...preview, removed: false });
  }

  remove(requestId: string): void {
    const pending = this.requests.get(requestId);
    if (pending && !pending.removed) {
      pending.removed = true;
      this.revoke(pending.previewUri);
      this.waiters.get(requestId)?.reject(new Error("Image submission cancelled."));
      this.waiters.delete(requestId);
      if (!this.activeUploads.has(requestId)) {
        this.requests.delete(requestId);
      }
    }
  }

  complete(requestId: string, attachments: ImageAttachment[], error?: string): { accepted: ImageAttachment[]; discarded: ImageAttachment[] } {
    const pending = this.requests.get(requestId);
    if (!pending) {return { accepted: attachments.filter((attachment) => attachment.source !== "clipboard"), discarded: [] };}
    this.activeUploads.delete(requestId);
    const waiter = this.waiters.get(requestId);
    this.waiters.delete(requestId);
    if (error && !pending.removed) {
      waiter?.reject(new Error(error));
      return { accepted: [], discarded: attachments };
    }
    this.requests.delete(requestId);
    if (!pending.removed) {this.revoke(pending.previewUri);}
    waiter?.resolve(pending.removed ? [] : attachments);
    return { accepted: pending.removed ? [] : attachments, discarded: pending.removed ? attachments : [] };
  }

  async uploadSelected(upload: (preview: PendingImagePreview) => Promise<void>): Promise<ImageAttachment[]> {
    const selected = this.previews();
    const results = selected.map((preview) => {
      const pending = this.requests.get(preview.requestId)!;
      this.activeUploads.add(preview.requestId);
      const result = new Promise<ImageAttachment[]>((resolve, reject) => {
        this.waiters.set(preview.requestId, { resolve, reject });
      });
      void upload(pending).catch((error: unknown) => {
        this.complete(preview.requestId, [], error instanceof Error ? error.message : String(error));
      });
      return result;
    });
    const settled = await Promise.allSettled(results);
    const failed = settled.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {throw failed.reason;}
    return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }

  previews(): PendingImagePreview[] {
    return [...this.requests.values()].filter((item) => !item.removed);
  }

  dispose(): void {
    for (const id of this.requests.keys()) {this.remove(id);}
  }

  get outstanding(): number {return this.requests.size;}
}
