import type { SlicingDefinition } from '../core/structure-definition-types.js';
import { getValueAtPath } from './slice-utils.js';
import { normalizeDiscriminatorPath } from './slice-discriminator-constraints.js';
import { stripCanonicalVersion } from './slice-type-discriminator.js';

type ProfileResolverFn = (profileUrl: string) => Promise<{ baseDefinition?: string } | null>;

/**
 * A profile discriminator matches when the instance CONFORMS to the slice's
 * required profile, so a resource declaring a DERIVED profile (e.g. MHD
 * Comprehensive.Folder deriving from the required Minimal.Folder) must
 * select the slice. Discriminator matching is synchronous while resolving a
 * declared profile's baseDefinition chain is async, so this pre-pass walks
 * the chains up front and parks each value's ancestor set here, keyed weakly
 * by the instance object, instead of threading request state through every
 * matcher signature. Instance objects are parsed per request, so entries
 * cannot leak across requests or tenants.
 */
const ancestryByValue = new WeakMap<object, ReadonlySet<string>>();

/** Derivation chains in practice stay in single digits; bound against cycles. */
const MAX_DERIVATION_DEPTH = 16;

export async function prepareDeclaredProfileAncestry(
  elements: unknown[],
  slicing: SlicingDefinition,
  resolveProfile: ProfileResolverFn | null,
): Promise<void> {
  if (!resolveProfile) return;
  const profilePaths = (slicing.discriminator ?? [])
    .filter(discriminator => discriminator.type === 'profile')
    .map(discriminator => normalizeDiscriminatorPath(discriminator.path || '$this'))
    .filter(path => !path.includes('resolve()'));
  if (profilePaths.length === 0) return;

  const chainCache = new Map<string, string[]>();
  for (const element of elements) {
    for (const path of profilePaths) {
      const value = !path || path === '$this' ? element : getValueAtPath(element, path);
      for (const candidate of Array.isArray(value) ? value : [value]) {
        await attachAncestry(candidate, resolveProfile, chainCache);
      }
    }
  }
}

export function declaredProfileAncestryContains(
  value: unknown,
  requiredProfiles: string[],
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const ancestors = ancestryByValue.get(value);
  if (!ancestors?.size) return false;
  return requiredProfiles.some(profile => ancestors.has(stripCanonicalVersion(profile)));
}

async function attachAncestry(
  candidate: unknown,
  resolveProfile: ProfileResolverFn,
  chainCache: Map<string, string[]>,
): Promise<void> {
  if (!isRecord(candidate) || ancestryByValue.has(candidate)) return;
  const declared = declaredProfiles(candidate);
  if (declared.length === 0) return;

  const ancestors = new Set<string>();
  for (const url of declared) {
    for (const ancestor of await resolveAncestorChain(url, resolveProfile, chainCache)) {
      ancestors.add(ancestor);
    }
  }
  if (ancestors.size > 0) ancestryByValue.set(candidate, ancestors);
}

async function resolveAncestorChain(
  declaredUrl: string,
  resolveProfile: ProfileResolverFn,
  chainCache: Map<string, string[]>,
): Promise<string[]> {
  const declaredKey = stripCanonicalVersion(declaredUrl);
  const cached = chainCache.get(declaredKey);
  if (cached) return cached;

  const chain: string[] = [];
  const seen = new Set<string>([declaredKey]);
  let current: string | undefined = declaredUrl;
  for (let depth = 0; depth < MAX_DERIVATION_DEPTH && current; depth++) {
    let resolved: { baseDefinition?: string } | null = null;
    try {
      resolved = await resolveProfile(current);
    } catch {
      break;
    }
    const base = typeof resolved?.baseDefinition === 'string' ? resolved.baseDefinition : undefined;
    if (!base) break;
    const baseKey = stripCanonicalVersion(base);
    if (seen.has(baseKey)) break;
    seen.add(baseKey);
    chain.push(baseKey);
    current = base;
  }
  chainCache.set(declaredKey, chain);
  return chain;
}

function declaredProfiles(candidate: Record<string, unknown>): string[] {
  const meta = isRecord(candidate.meta) ? candidate.meta : null;
  const profile = meta?.profile;
  if (typeof profile === 'string') return [profile];
  if (Array.isArray(profile)) return profile.filter((url): url is string => typeof url === 'string');
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
