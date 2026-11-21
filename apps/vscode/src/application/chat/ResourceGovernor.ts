const DEFAULT_SESSION_BUDGET_BYTES = 256 * 1024 * 1024;

export class ResourceGovernor {
  private readonly reservations = new Map<string, number>();
  private reservedBytes = 0;

  constructor(readonly maxBytes = DEFAULT_SESSION_BUDGET_BYTES) {}

  tryReserve(id: string, requestedBytes: number): boolean {
    const bytes = Math.max(0, Math.trunc(requestedBytes));
    if (!Number.isSafeInteger(bytes) || this.reservations.has(id) || this.reservedBytes + bytes > this.maxBytes) {
      return false;
    }
    this.reservations.set(id, bytes);
    this.reservedBytes += bytes;
    return true;
  }

  release(id: string): void {
    const bytes = this.reservations.get(id);
    if (bytes === undefined) {return;}
    this.reservations.delete(id);
    this.reservedBytes = Math.max(0, this.reservedBytes - bytes);
  }
}
