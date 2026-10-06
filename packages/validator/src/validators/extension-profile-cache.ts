import { createHash } from 'node:crypto';
import { profileDefinitionSourceKey, ProfileReferenceUnavailableError } from '../core/profile-reference-authority.js';
import type { StructureDefinitionLoader, ProfileReferenceSource } from '../core/structure-definition-loader.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';

export interface ExtensionProfileCache<Value> {
  get(key: string): Value | undefined;
  set(key: string, value: Value): void;
}

/** The selected content, including its issued source, owns derived extension caches. */
export function extensionDefinitionCacheKey(profile: StructureDefinition, family: string): string {
  const content = profileDefinitionSourceKey(profile) ?? createHash('sha256').update(JSON.stringify(profile)).digest('hex');
  return `${family}|${profile.url}|${content}`;
}

export async function loadExtensionProfile(
  loader: StructureDefinitionLoader, url: string, source: ProfileReferenceSource | undefined,
  family: 'R4' | 'R5' | 'R6',
): Promise<StructureDefinition | null> {
  if (loader.loadReferencedProfile) return loader.loadReferencedProfile(url, source, family);
  const pinned = await loader.pinProfileReference?.(url, source, family) ?? url;
  return (pinned !== url ? await loader.loadProfile(pinned, family) : null) ?? loader.loadProfile(url, family);
}

export function rethrowUnavailableProfile(error: unknown): void {
  if (error instanceof ProfileReferenceUnavailableError) throw error;
}
