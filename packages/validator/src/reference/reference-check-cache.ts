export interface ReferenceCheckCacheEntry {
  exists: boolean;
  statusCode?: number;
  timestamp: number;
}

export interface ReferenceCheckCacheStats {
  size: number;
  entries: Array<{ reference: string; exists: boolean; age: number }>;
}

export class ReferenceCheckCache {
  private entries = new Map<string, ReferenceCheckCacheEntry>();

  get(reference: string, ttlMs: number): ReferenceCheckCacheEntry | null {
    const entry = this.entries.get(reference);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > ttlMs) {
      this.entries.delete(reference);
      return null;
    }

    return entry;
  }

  set(reference: string, exists: boolean, statusCode?: number): void {
    this.entries.set(reference, {
      exists,
      statusCode,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  getStats(): ReferenceCheckCacheStats {
    const now = Date.now();
    const entries = Array.from(this.entries.entries()).map(([reference, entry]) => ({
      reference,
      exists: entry.exists,
      age: now - entry.timestamp,
    }));

    return {
      size: this.entries.size,
      entries,
    };
  }
}
