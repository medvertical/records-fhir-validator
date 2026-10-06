import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { copyProfilePackageProvenance } from './package/canonical-pin-provenance.js';

export class ValidationDependencySnapshotLimitError extends Error {
  constructor() { super('Validation dependency snapshot is too large'); this.name = 'ValidationDependencySnapshotLimitError'; }
}

type DependencyKind = 'profile' | 'terminology';
interface CapturedDependency { kind: DependencyKind; lookupIdentity: string; value: Promise<unknown>; hash?: string }
interface DependencySnapshot {
  operations?: ReadonlySet<string>;
  entries: Map<string, CapturedDependency>;
  cachedValues: Map<string, unknown>;
  scopes: WeakMap<object, number>;
  nextScope: number;
  bytes: number;
  unattested: Set<string>;
}
const activeSnapshot = new AsyncLocalStorage<DependencySnapshot>();
export const isValidationDependencySnapshotActive = () => activeSnapshot.getStore() !== undefined;

const inventoryOperations = new Set(['load-referenced-profile', 'profile-reference-installed-manifests',
  'profile-reference-package-index', 'profile-reference-fallback-inventory',
  'profile-reference-fallback-definition', 'profile-reference-example-directory']);

/** Reuse actual package reads per resource without activating unrelated terminology/host capture budgets. */
export function withProfileReferenceInventorySnapshot<T>(operation: () => Promise<T>): Promise<T> {
  if (isValidationDependencySnapshotActive()) return operation();
  return activeSnapshot.run({ ...newSnapshot(), operations: inventoryOperations }, operation);
}
function newSnapshot(): DependencySnapshot {
  return { entries: new Map(), cachedValues: new Map(), scopes: new WeakMap(), nextScope: 0, bytes: 0, unattested: new Set() };
}

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
  if (!snapshot || snapshot.operations) return resolve();
  const identity = hash(serialize(['terminology', operation, key]));
  if (snapshot.cachedValues.has(identity)) return structuredClone(snapshot.cachedValues.get(identity)) as T;
  const value = resolve();
  if (value === undefined || value === null) return value;
  const detached = structuredClone(value);
  const encoded = serialize(detached);
  snapshot.bytes += Buffer.byteLength(encoded);
  if (snapshot.bytes > 64 * 1024 * 1024 || snapshot.entries.size >= 4096) {
    snapshot.unattested.add('Dependency snapshot exceeded its memory or entry limit.');
    throw new ValidationDependencySnapshotLimitError();
  }
  snapshot.cachedValues.set(identity, detached);
  snapshot.entries.set(identity, { kind: 'terminology', lookupIdentity: identity, value: Promise.resolve(detached), hash: hash(encoded) });
  return structuredClone(detached);
}

function cloneDependency<T>(kind: DependencyKind, value: T): T {
  const detached = structuredClone(value);
  if (kind === 'profile') copyProfilePackageProvenance(value, detached);
  return detached;
}

/** Capture lookup results before mutable caches; return detached values to every caller. */
export async function captureValidationDependency<T>(
  kind: DependencyKind, operation: string, arguments_: unknown, resolve: () => Promise<T>, reuseScope?: object, currentScope?: () => object, inventoryEligible = true,
): Promise<T> {
  const snapshot = activeSnapshot.getStore();
  if (!snapshot || (snapshot.operations && (!inventoryEligible || kind !== 'profile' || !snapshot.operations.has(operation)))) return resolve();
  const lookupIdentity = hash(serialize([kind, operation, arguments_]));
  let scopeId = reuseScope && snapshot.scopes.get(reuseScope);
  if (reuseScope && scopeId === undefined) {
    scopeId = snapshot.nextScope++;
    snapshot.scopes.set(reuseScope, scopeId);
  }
  const key = reuseScope ? `${lookupIdentity}:${scopeId}` : lookupIdentity;
  let entry = snapshot.entries.get(key);
  if (!entry) {
    if (snapshot.entries.size >= 4096) {
      snapshot.unattested.add('Dependency snapshot exceeded its entry limit.');
      throw new ValidationDependencySnapshotLimitError();
    }
    let complete!: (value: T | PromiseLike<T>) => void;
    let fail!: (reason: unknown) => void;
    const lookup = new Promise<T>((resolveValue, rejectValue) => { complete = resolveValue; fail = rejectValue; });
    const captured: CapturedDependency = { kind, lookupIdentity, value: lookup.then(value => {
      if (currentScope && currentScope() !== reuseScope) {
        snapshot.unattested.add('The profile resolution owner changed during a dependency lookup.');
      }
      const detached = cloneDependency(kind, value);
      const encoded = serialize(detached);
      snapshot.bytes += Buffer.byteLength(encoded);
      if (snapshot.bytes > 64 * 1024 * 1024) {
        snapshot.unattested.add('Dependency snapshot exceeded its memory limit.');
        throw new ValidationDependencySnapshotLimitError();
      }
      captured.hash = hash(encoded);
      return detached;
    }) };
    snapshot.entries.set(key, captured);
    entry = captured;
    // Reserve first, then bind actual lookup inputs in the initiating call.
    // Deferring resolve lets mutable owner settings change under this key.
    try { complete(resolve()); } catch (error) { fail(error); }
  }
  try {
    return cloneDependency(kind, await entry.value) as T;
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
  const snapshot = newSnapshot();
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
        hash: hash(serialize(entries.map(([, entry]) => [entry.lookupIdentity, entry.hash]).sort((left, right) =>
          serialize(left).localeCompare(serialize(right))))),
        profileCount, terminologyCount,
        ...(reasons.length ? { reason: reasons.join(' ') } : {}),
      };
    },
  };
}
