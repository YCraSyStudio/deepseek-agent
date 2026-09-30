import type { ImageAttachment } from "@/contracts";

export interface PendingImagePreview {
  requestId: string;
  name: string;
  previewUri: string;
}

const owners = new Map<string, ClipboardUploads>();

/** Tracks uploads independently of completion order and attachment selection. */
export class ClipboardUploads {
  private readonly requests = new Map<string, PendingImagePreview & { removed: boolean }>();
  constructor(private readonly revoke: (uri: string) => void) {}

  add(preview: PendingImagePreview): void {
    owners.set(preview.requestId, this);
    this.requests.set(preview.requestId, { ...preview, removed: false });
  }

  remove(requestId: string): void {
    const pending = this.requests.get(requestId);
    if (pending && !pending.removed) {
      pending.removed = true;
      this.revoke(pending.previewUri);
    }
  }

  complete(requestId: string, attachments: ImageAttachment[]): { handled: boolean; accepted: ImageAttachment[]; discarded: ImageAttachment[] } {
    const owner = owners.get(requestId);
    if (owner && owner !== this) {return owner.complete(requestId, attachments);}
    const pending = this.requests.get(requestId);
    if (!pending) {return { handled: false, accepted: attachments, discarded: [] };}
    this.requests.delete(requestId);
    owners.delete(requestId);
    if (!pending.removed) {this.revoke(pending.previewUri);}
    return { handled: true, accepted: pending.removed ? [] : attachments, discarded: pending.removed ? attachments : [] };
  }

  previews(): PendingImagePreview[] {
    return [...this.requests.values()].filter((item) => !item.removed);
  }

  dispose(): void {
    for (const id of this.requests.keys()) {this.remove(id);}
  }

  get outstanding(): number {return this.requests.size;}
}
