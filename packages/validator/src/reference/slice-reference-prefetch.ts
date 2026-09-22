import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { logger } from '../logger.js';
import type { ReferenceResolver } from '../validators/slice-types.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { fetchReferenceWithinDeadline, type ReferenceResourceFetcher } from './reference-fetch-deadline.js';
import { parseReference } from './reference-type-extractor.js';
import {
  createSafeRecursiveValidationConfig,
  type RecursiveValidationConfig,
} from './recursive-reference-config.js';

/**
 * Slice membership under a `profile` discriminator — or any discriminator that
 * traverses `resolve()` — is decided by the referenced target, not by the
 * Reference element itself. Without the target the slicing validator reports
 * the slice as unverifiable and its `min` stays unchecked, so a profile such as
 * MII `reasonReference:Primaertumor` can never be confirmed or refuted for a
 * standalone resource. Resolving the targets up front turns that guess into
 * evidence while keeping the matcher synchronous.
 */
export interface SliceReferencePrefetchLimits {
  maxReferences: number;
  timeoutMs: number;
  allowAbsolute: boolean;
}

export interface SliceReferencePrefetchOptions {
  resource: Record<string, unknown>;
  structureDef: StructureDefinition;
  fetcher: ReferenceResourceFetcher;
  limits: SliceReferencePrefetchLimits;
  /** References this resolver already answers are never fetched. */
  alreadyResolved?: ReferenceResolver | null;
}

/**
 * Prefetching makes structural validation reach the server, which the shipped
 * defaults never do. `validateTargetProfiles` is the existing, deliberately
 * unset opt-in for dereferencing targets to check their profiles, so it also
 * governs this — enabling recursive reference validation alone is not consent.
 */
export function sliceReferencePrefetchLimits(
  config: (Partial<RecursiveValidationConfig> & { validateTargetProfiles?: boolean }) | undefined,
): SliceReferencePrefetchLimits | null {
  if (!config?.validateTargetProfiles) return null;
  const safe = createSafeRecursiveValidationConfig(config);
  if (!safe.enabled) return null;
  return {
    maxReferences: safe.maxReferencesPerResource ?? 10,
    timeoutMs: safe.timeoutMs ?? 30_000,
    allowAbsolute: safe.validateExternal,
  };
}

export function collectSliceDiscriminatorReferences(
  resource: Record<string, unknown>,
  structureDef: StructureDefinition,
): string[] {
  const references = new Set<string>();
  for (const path of targetDependentSlicePaths(structureDef)) {
    for (const value of valuesAtElementPath(resource, path)) {
      const reference = referenceStringOf(value);
      if (reference) references.add(reference);
    }
  }
  return Array.from(references);
}

/**
 * Returns a synchronous resolver over the fetched targets, or null when nothing
 * was fetched. Fetch failures are dropped: an unresolved target must leave the
 * slice unverifiable rather than declare the resource invalid.
 */
export async function prefetchSliceReferenceTargets(
  options: SliceReferencePrefetchOptions,
): Promise<ReferenceResolver | null> {
  const candidates = selectFetchableReferences(options);
  if (candidates.length === 0) return null;

  const startTime = Date.now();
  const resolved = new Map<string, unknown>();
  await Promise.all(candidates.map(async reference => {
    try {
      const target = await fetchReferenceWithinDeadline(
        options.fetcher,
        reference,
        startTime,
        options.limits.timeoutMs,
      );
      if (target && typeof target === 'object') resolved.set(reference, target);
    } catch (error: unknown) {
      logger.debug(
        '[SliceReferencePrefetch] Reference target could not be fetched',
        validationFailureMetadata(error),
      );
    }
  }));

  if (resolved.size === 0) return null;
  return reference => resolved.get(reference) ?? null;
}

function selectFetchableReferences(options: SliceReferencePrefetchOptions): string[] {
  const selected: string[] = [];
  for (const reference of collectSliceDiscriminatorReferences(options.resource, options.structureDef)) {
    if (selected.length >= options.limits.maxReferences) break;
    if (reference.startsWith('#')) continue;
    const parsed = parseReference(reference);
    if (!parsed.isValid || !parsed.resourceType || !parsed.resourceId) continue;
    if (!options.limits.allowAbsolute && isExternalReference(parsed.referenceType)) continue;
    if (resolvesAlready(options.alreadyResolved, reference)) continue;
    selected.push(reference);
  }
  return selected;
}

function isExternalReference(referenceType: unknown): boolean {
  return referenceType === 'absolute' || referenceType === 'canonical';
}

function resolvesAlready(resolver: ReferenceResolver | null | undefined, reference: string): boolean {
  if (!resolver) return false;
  try {
    return resolver(reference) != null;
  } catch {
    return false;
  }
}

function targetDependentSlicePaths(structureDef: StructureDefinition): string[] {
  const elements = structureDef.snapshot?.element ?? structureDef.differential?.element ?? [];
  const paths = new Set<string>();
  for (const element of elements) {
    if (isTargetDependentSlicing(element)) paths.add(element.path);
  }
  return Array.from(paths);
}

function isTargetDependentSlicing(element: ElementDefinition): boolean {
  const discriminators = element.slicing?.discriminator ?? [];
  return discriminators.some(discriminator =>
    discriminator.type === 'profile' || (discriminator.path ?? '').includes('resolve()'));
}

/** Walks a dotted snapshot path, fanning out over repeating elements. */
function valuesAtElementPath(resource: Record<string, unknown>, elementPath: string): unknown[] {
  const segments = elementPath.split('.').slice(1);
  if (segments.length === 0) return [];

  let current: unknown[] = [resource];
  for (const segment of segments) {
    const next: unknown[] = [];
    for (const value of current) {
      if (!isRecord(value)) continue;
      const child = value[segment];
      if (child === undefined || child === null) continue;
      if (Array.isArray(child)) next.push(...child);
      else next.push(child);
    }
    if (next.length === 0) return [];
    current = next;
  }
  return current;
}

function referenceStringOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.reference === 'string' && value.reference.length > 0
    ? value.reference
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
