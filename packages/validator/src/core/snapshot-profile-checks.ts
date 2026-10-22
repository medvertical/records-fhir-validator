import { AsyncLocalStorage } from 'node:async_hooks';
import { getProfileSource, type ProfileSourceContext } from '../persistence/profile-source.js';
import type { StructureDefinition } from './structure-definition-types.js';

const checks = new AsyncLocalStorage<{ sha256: string; failure?: Error }>();

/** A caught nested lookup failure cannot turn a changed immutable basis into completed evidence. */
export function recordSnapshotExecutionFailure(error: Error, context: ProfileSourceContext): void {
  const state = checks.getStore();
  if (context.terminologySnapshotSha256 && state?.sha256 === context.terminologySnapshotSha256) state.failure ??= error;
}

export async function withSnapshotProfileLookup(request: string, context: ProfileSourceContext | undefined,
  parent: { url?: string; version?: string } | undefined, load: () => Promise<StructureDefinition | null>) {
  try {
    const source = getProfileSource();
    const unavailable = context?.terminologySnapshotSha256
      && await source.isSnapshotProfileUnavailable?.(request, context, parent);
    return await checkSnapshotProfile(request, unavailable ? null : await load(), context, parent);
  } catch (error: unknown) {
    const state = checks.getStore();
    if (context?.terminologySnapshotSha256 && state?.sha256 === context.terminologySnapshotSha256) {
      state.failure ??= error instanceof Error ? error : new Error('Snapshot profile lookup failed');
    }
    throw error;
  }
}

/** Profile-load failures are sometimes converted to issues. A scope violation must still fail the whole operation. */
export async function withSnapshotProfileChecks<T>(context: ProfileSourceContext, operation: () => Promise<T>, resources?: readonly unknown[]): Promise<T> {
  const sha256 = context.terminologySnapshotSha256;
  if (!sha256) return operation();
  const previous = checks.getStore();
  const state = previous?.sha256 === sha256 ? previous : { sha256 };
  return checks.run(state, async () => {
    if (resources) {
      try {
        const source = getProfileSource();
        if (!source.assertSnapshotProfileClaims) throw new Error('The host does not support snapshot profile claim checks');
        await source.assertSnapshotProfileClaims(collectSnapshotProfileClaims(resources), context);
      } catch (error: unknown) {
        state.failure ??= error instanceof Error ? error : new Error('Snapshot profile claim check failed');
        throw state.failure;
      }
    }
    const result = await operation();
    if (state.failure) throw state.failure;
    return result;
  });
}

/** Only canonical identities leave the transient clinical input traversal. */
function collectSnapshotProfileClaims(resources: readonly unknown[]): string[] {
  const claims = new Set<string>();
  let nodes = 0;
  const add = (value: unknown) => {
    if (typeof value !== 'string' || !value || value.length > 2560) throw new Error('Invalid snapshot profile claim');
    claims.add(value);
    if (claims.size > 5000) throw new Error('Snapshot profile claims exceed limit');
  };
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object') return;
    if (depth > 80 || ++nodes > 1_000_000) throw new Error('Snapshot profile claim traversal exceeds limit');
    if (Array.isArray(value)) { for (const entry of value) visit(entry, depth + 1); return; }
    const record = value as Record<string, unknown>;
    if (typeof record.resourceType === 'string') add(`http://hl7.org/fhir/StructureDefinition/${record.resourceType}`);
    if (record.meta && typeof record.meta === 'object' && !Array.isArray(record.meta)) {
      const profile = (record.meta as Record<string, unknown>).profile;
      if (Array.isArray(profile)) profile.forEach(add);
    }
    for (const key of ['extension', 'modifierExtension']) if (Array.isArray(record[key])) {
      for (const extension of record[key]) if (extension && typeof extension === 'object' && !Array.isArray(extension)) {
        const url = (extension as Record<string, unknown>).url;
        if (typeof url === 'string' && /^(?:https?:\/\/|urn:)/.test(url)) add(url);
      }
    }
    for (const entry of Object.values(record)) visit(entry, depth + 1);
  };
  for (const resource of resources) visit(resource, 0);
  return [...claims];
}

export async function checkSnapshotProfile(request: string, profile: StructureDefinition | null,
  context: ProfileSourceContext | undefined, parent?: { url?: string; version?: string }): Promise<StructureDefinition | null> {
  if (!context?.terminologySnapshotSha256) return profile;
  try {
    const source = getProfileSource();
    if (!source.assertSnapshotProfile) throw new Error('The host does not support snapshot profile scope checks');
    await source.assertSnapshotProfile(request, profile, context, parent);
    return profile;
  } catch (error: unknown) {
    const failure = error instanceof Error ? error : new Error('Snapshot profile scope check failed');
    const state = checks.getStore();
    if (state?.sha256 === context.terminologySnapshotSha256) state.failure ??= failure;
    throw failure;
  }
}
