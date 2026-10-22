import { BoundedLruCache } from './bounded-lru-cache.js';

type Entry<T extends object> = { value: T | null } | { reference: WeakRef<T> };

/** Immutable source artifacts can be reloaded without keeping whole catalogs alive. */
export class CollectableDefinitionCache<T extends object> {
  private readonly entries: BoundedLruCache<string, Entry<T>>;

  constructor(maxEntries: number) {
    this.entries = new BoundedLruCache(maxEntries);
  }

  get(key: string): T | null | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if ('value' in entry) return entry.value;
    const value = entry.reference.deref();
    if (value === undefined) this.entries.delete(key);
    return value;
  }

  has(key: string): boolean { return this.get(key) !== undefined; }

  set(key: string, value: T | null, collectable = false): void {
    this.entries.set(key, collectable && value !== null
      ? { reference: new WeakRef(value) } : { value });
  }

  keys(): IterableIterator<string> { return this.entries.keys(); }
  delete(key: string): void { this.entries.delete(key); }
  clear(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
}
