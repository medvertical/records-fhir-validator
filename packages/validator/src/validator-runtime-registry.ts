export interface RuntimeLease<T> {
  promise: Promise<T>;
  release(): void;
}

interface RuntimeEntry<T> {
  promise: Promise<T>;
  instance?: T;
  leases: number;
}

/** Retryable global/scoped runtime registry with leased LRU eviction. */
export class ValidatorRuntimeRegistry<T> {
  private defaultInstance: T | null = null;
  private defaultPromise: Promise<T> | null = null;
  private readonly scopedEntries = new Map<string, RuntimeEntry<T>>();

  constructor(
    private readonly factory: (scoped: boolean) => Promise<T>,
    private readonly maxScopedEntries: number,
  ) {}

  get(runtimeScopeKey?: string): Promise<T> {
    return runtimeScopeKey
      ? this.getScopedEntry(runtimeScopeKey).promise
      : this.getDefault();
  }

  acquire(runtimeScopeKey?: string): RuntimeLease<T> {
    if (!runtimeScopeKey) {
      return { promise: this.getDefault(), release: () => undefined };
    }

    const entry = this.getScopedEntry(runtimeScopeKey);
    entry.leases++;
    let released = false;
    return {
      promise: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        entry.leases = Math.max(0, entry.leases - 1);
        this.trimScopedEntries();
      },
    };
  }

  peekDefault(): T | null {
    return this.defaultInstance;
  }

  currentPromises(): Promise<T>[] {
    const promises = [...this.scopedEntries.values()].map(entry => entry.promise);
    if (this.defaultPromise) promises.unshift(this.defaultPromise);
    return promises;
  }

  retireScopes(prefix: string): void {
    for (const key of this.scopedEntries.keys()) {
      if (key.startsWith(prefix)) this.scopedEntries.delete(key);
    }
    // Active leases keep their old instance until release; future acquisitions
    // cannot observe a late write to that retired generation.
  }

  currentInstances(): T[] {
    const instances = [...this.scopedEntries.values()]
      .flatMap(entry => entry.instance ? [entry.instance] : []);
    return this.defaultInstance ? [this.defaultInstance, ...instances] : instances;
  }

  currentScopedEntries(): ReadonlyArray<{ instance?: T; promise: Promise<T> }> {
    return [...this.scopedEntries.values()];
  }

  private getDefault(): Promise<T> {
    if (this.defaultPromise) return this.defaultPromise;

    const pending = this.factory(false).then(
      instance => {
        if (this.defaultPromise === pending) this.defaultInstance = instance;
        return instance;
      },
      error => {
        if (this.defaultPromise === pending) this.defaultPromise = null;
        throw error;
      },
    );
    this.defaultPromise = pending;
    return pending;
  }

  private getScopedEntry(runtimeScopeKey: string): RuntimeEntry<T> {
    const existing = this.scopedEntries.get(runtimeScopeKey);
    if (existing) {
      this.scopedEntries.delete(runtimeScopeKey);
      this.scopedEntries.set(runtimeScopeKey, existing);
      return existing;
    }

    const entry = { leases: 0 } as RuntimeEntry<T>;
    entry.promise = this.factory(true).then(
      instance => {
        if (this.scopedEntries.get(runtimeScopeKey) === entry) entry.instance = instance;
        return instance;
      },
      error => {
        if (this.scopedEntries.get(runtimeScopeKey) === entry) {
          this.scopedEntries.delete(runtimeScopeKey);
        }
        throw error;
      },
    );
    this.scopedEntries.set(runtimeScopeKey, entry);
    this.trimScopedEntries();
    return entry;
  }

  private trimScopedEntries(): void {
    while (this.scopedEntries.size > this.maxScopedEntries) {
      const oldestUnleased = [...this.scopedEntries.entries()]
        .find(([, entry]) => entry.leases === 0);
      if (!oldestUnleased) return;
      this.scopedEntries.delete(oldestUnleased[0]);
    }
  }
}
