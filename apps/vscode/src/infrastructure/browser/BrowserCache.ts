export class LruCache<K, V> {
  private readonly values = new Map<K, { value: V; size: number; expiresAt?: number }>();
  private totalSize = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxTotalSize = Number.POSITIVE_INFINITY,
  ) {}

  get(key: K, now = Date.now()): V | undefined {
    const entry = this.values.get(key);
    if (!entry) {return undefined;}
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      this.delete(key);
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, size = 1, ttlMs?: number): void {
    this.delete(key);
    const boundedSize = Math.max(0, size);
    this.values.set(key, {
      value,
      size: boundedSize,
      expiresAt: ttlMs === undefined ? undefined : Date.now() + ttlMs,
    });
    this.totalSize += boundedSize;
    while (this.values.size > this.maxEntries || this.totalSize > this.maxTotalSize) {
      const oldest = this.values.keys().next().value as K | undefined;
      if (oldest === undefined) {break;}
      this.delete(oldest);
    }
  }

  delete(key: K): boolean {
    const entry = this.values.get(key);
    if (!entry) {return false;}
    this.totalSize -= entry.size;
    return this.values.delete(key);
  }

  valuesNewestFirst(now = Date.now()): V[] {
    for (const [key, entry] of this.values) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {this.delete(key);}
    }
    return [...this.values.values()].reverse().map((entry) => entry.value);
  }

  get size(): number {return this.values.size;}
}
