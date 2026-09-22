import type { ValidationGraphNode } from './validation-graph-types.js';

/**
 * Resolves a FHIR reference to the target payload, or null when it cannot be
 * reached. The graph executor stays synchronous, so callers pre-resolve.
 */
export type GraphReferenceResolver = (reference: string) => unknown | null;

export type ResolvedSliceMatch = 'match' | 'no-match' | 'unresolved';

/** Slice membership here depends on the referenced target, not on the Reference. */
export function usesTargetDependentDiscriminator(parentNode: ValidationGraphNode): boolean {
  return (parentNode.slicing?.discriminator ?? []).some(discriminator =>
    discriminator.type === 'profile' || (discriminator.path ?? '').includes('resolve()'));
}

/**
 * Reports whether the target the value points at satisfies the slice.
 * `unresolved` is deliberately distinct from `no-match`: without the target the
 * slice is unverifiable, and an unverifiable slice must not be declared missing.
 */
export function matchResolvedSlice(
  value: unknown,
  slice: ValidationGraphNode,
  resolveReference: GraphReferenceResolver | undefined,
): ResolvedSliceMatch {
  if (!isRecord(value)) return 'no-match';

  const inlineMatch = matchAgainstSlice(value, slice);
  if (inlineMatch === 'match') return 'match';

  const reference = value.reference;
  if (typeof reference !== 'string' || reference.length === 0) return inlineMatch;
  if (!resolveReference) return 'unresolved';

  let target: unknown = null;
  try {
    target = resolveReference(reference);
  } catch {
    return 'unresolved';
  }
  if (!isRecord(target)) return 'unresolved';

  return matchAgainstSlice(target, slice);
}

function matchAgainstSlice(target: Record<string, unknown>, slice: ValidationGraphNode): ResolvedSliceMatch {
  const requiredProfiles = slice.refers ?? [];
  if (requiredProfiles.length > 0) {
    const meta = isRecord(target.meta) ? target.meta : null;
    const declared = toStringArray(meta?.profile);
    if (declared.length === 0) return 'no-match';
    return declared.some(profile => requiredProfiles.some(required => canonicalsMatch(profile, required)))
      ? 'match'
      : 'no-match';
  }

  const allowedTypes = slice.referenceTargetTypes ?? [];
  if (allowedTypes.length > 0 && typeof target.resourceType === 'string') {
    return allowedTypes.includes(target.resourceType) ? 'match' : 'no-match';
  }

  return 'no-match';
}

function canonicalsMatch(left: string, right: string): boolean {
  return left === right || stripVersion(left) === stripVersion(right);
}

function stripVersion(canonical: string): string {
  const separator = canonical.indexOf('|');
  return separator === -1 ? canonical : canonical.slice(0, separator);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return typeof value === 'string' ? [value] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
