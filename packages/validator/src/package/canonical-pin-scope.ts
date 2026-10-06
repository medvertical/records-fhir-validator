import { AsyncLocalStorage } from 'node:async_hooks';

export interface PinnedCanonicalSource {
  readonly canonical: string;
  readonly version: string;
  readonly packageDirName: string;
}

// Kept on the immutable binding copy, never keyed globally by canonical identity.
export const bindingPinSource = Symbol('bindingPinSource');
export type PinnedBinding = { readonly [bindingPinSource]?: PinnedCanonicalSource };
const activePin = new AsyncLocalStorage<PinnedCanonicalSource | undefined>();

/** Carries the binding's package choice through asynchronous expansion and validation. */
export function withPinnedCanonicalSource<T>(source: PinnedCanonicalSource | undefined, run: () => T): T {
  return activePin.run(source ? Object.freeze({ ...source }) : undefined, run);
}

export function pinnedCanonicalSourceDir(canonical: string, version: string | undefined): string | null {
  const source = activePin.getStore();
  return source?.canonical === canonical && source.version === version ? source.packageDirName : null;
}

/** Derived results and in-flight lookups must have the same scope as their package reads. */
export function canonicalPinCacheKey(key: string): string {
  const source = activePin.getStore();
  return source ? JSON.stringify([source.canonical, source.version, source.packageDirName, key]) : key;
}
