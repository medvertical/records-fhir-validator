import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

type DependencyKind = 'profile' | 'terminology';
interface CapturedDependency { kind: DependencyKind; value: Promise<unknown>; hash?: string }
interface DependencySnapshot {
  entries: Map<string, CapturedDependency>;
  cachedValues: Map<string, unknown>;
  bytes: number;
  unattested: Set<string>;
}
const activeSnapshot = new AsyncLocalStorage<DependencySnapshot>();
export const isValidationDependencySnapshotActive = () => activeSnapshot.getStore() !== undefined;

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === undefined) return null;
    if (item instanceof Set) return [...item].sort();
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
    }
    return item;
  });
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Only cache hits are captured: an initial cache miss may be filled by its owning loader. */
export function captureValidationDependencyCacheHit<T>(
  operation: string, key: string, resolve: () => T,
): T {
  const snapshot = activeSnapshot.getStore();
  if (!snapshot) return resolve();
  const identity = hash(serialize(['terminology', operation, key]));
  if (snapshot.cachedValues.has(identity)) return structuredClone(snapshot.cachedValues.get(identity)) as T;
  const value = resolve();
  if (value === undefined || value === null) return value;
  const detached = structuredClone(value);
  const encoded = serialize(detached);
  snapshot.bytes += Buffer.byteLength(encoded);
  if (snapshot.bytes > 64 * 1024 * 1024 || snapshot.entries.size >= 4096) {
    snapshot.unattested.add('Dependency snapshot exceeded its memory or entry limit.');
    throw new Error('Validation dependency snapshot is too large');
  }
  snapshot.cachedValues.set(identity, detached);
  snapshot.entries.set(identity, { kind: 'terminology', value: Promise.resolve(detached), hash: hash(encoded) });
  return structuredClone(detached);
}

/** Capture lookup results before mutable caches; return detached values to every caller. */
export async function captureValidationDependency<T>(
  kind: DependencyKind, operation: string, arguments_: unknown, resolve: () => Promise<T>,
): Promise<T> {
  const snapshot = activeSnapshot.getStore();
  if (!snapshot) return resolve();
  const key = hash(serialize([kind, operation, arguments_]));
  let entry = snapshot.entries.get(key);
  if (!entry) {
    if (snapshot.entries.size >= 4096) {
      snapshot.unattested.add('Dependency snapshot exceeded its entry limit.');
      throw new Error('Validation dependency snapshot is too large');
    }
    const captured: CapturedDependency = { kind, value: Promise.resolve().then(resolve).then(value => {
      const detached = structuredClone(value);
      const encoded = serialize(detached);
      snapshot.bytes += Buffer.byteLength(encoded);
      if (snapshot.bytes > 64 * 1024 * 1024) {
        snapshot.unattested.add('Dependency snapshot exceeded its memory limit.');
        throw new Error('Validation dependency snapshot is too large');
      }
      captured.hash = hash(encoded);
      return detached;
    }) };
    snapshot.entries.set(key, captured);
    entry = captured;
  }
  try {
    return structuredClone(await entry.value) as T;
  } catch (error) {
    snapshot.unattested.add('A validation dependency could not be captured.');
    throw error;
  }
}

/** Online query responses cannot attest the terminology dataset behind different queries. */
export function markValidationDependencyUnattested(reason: string): void {
  activeSnapshot.getStore()?.unattested.add(reason);
}

export function createValidationDependencySnapshot({ requireProfileLookup = true }: { requireProfileLookup?: boolean } = {}) {
  const snapshot: DependencySnapshot = { entries: new Map(), cachedValues: new Map(), bytes: 0, unattested: new Set() };
  return {
    run: <T>(operation: () => Promise<T>): Promise<T> => activeSnapshot.run(snapshot, operation),
    markUnattested: (reason: string) => { snapshot.unattested.add(reason); },
    evidence() {
      const entries = [...snapshot.entries.entries()].sort(([left], [right]) => left.localeCompare(right));
      const profileCount = entries.filter(([, entry]) => entry.kind === 'profile').length;
      const terminologyCount = entries.length - profileCount;
      const reasons = [...snapshot.unattested];
      if (requireProfileLookup && profileCount === 0) reasons.push('The runtime did not capture its profile dependencies.');
      if (entries.some(([, entry]) => !entry.hash)) reasons.push('Some dependency lookups are incomplete.');
      return {
        status: reasons.length ? 'unattested' as const : 'captured' as const,
        hash: hash(serialize(entries.map(([key, entry]) => [key, entry.hash]))),
        profileCount, terminologyCount,
        ...(reasons.length ? { reason: reasons.join(' ') } : {}),
      };
    },
  };
}
