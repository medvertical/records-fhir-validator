import { sliceInstanceEvidence } from './slice-instance-evidence.js';
import type { SlicingDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { normalizeDiscriminatorPath } from './slice-discriminator-constraints.js';
import { getTypeSpecsForDiscriminator } from './slice-type-discriminator.js';
import { prepareDatatypeProfileConformance, prepareResourceProfileConformance, type SliceProfileConformanceContext } from './slice-datatype-conformance.js';
import type { SliceDefinition } from './slice-types.js';
import { getValueAtPath } from './slice-utils.js';

type ProfileResolverFn = (profileUrl: string) => Promise<Pick<StructureDefinition, 'type' | 'snapshot'> | null>;

/**
 * A slice typed only `Resource` names its type through its profile
 * (`Bundle.entry:Composition.resource` → ch-core-composition → Composition),
 * and the reference validator places an entry by conformance to that profile,
 * whether or not the entry declares it. This pre-pass resolves the type every
 * slice admits and parks, per instance value, the one slice whose type the
 * value has, so the synchronous matcher can place an entry that declares no
 * profile; the entry is then held to that profile's rules like any other.
 * A type two slices share decides nothing. The owning slicing invocation
 * isolates this evidence from concurrent checks.
 */

const GENERIC_TYPES = new Set(['Resource', 'DomainResource']);

export async function prepareSliceProfileTypes(
  elements: unknown[],
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  resolveProfile: ProfileResolverFn | null,
  context: SliceProfileConformanceContext = {},
): Promise<void> {
  if (!resolveProfile) return;
  await prepareDatatypeProfileConformance(elements, slices, slicing, resolveProfile, context);
  const paths = (slicing.discriminator ?? [])
    .filter(discriminator => discriminator.type === 'profile')
    .map(discriminator => normalizeDiscriminatorPath(discriminator.path || '$this'))
    .filter(path => !path.includes('resolve()'));

  for (const path of paths) {
    await prepareResourceProfileConformance(elements, slices, path, resolveProfile, context);
    const slicesByType = new Map<string, Set<string>>();
    let resolvedAny = false;
    let unresolved = false;
    for (const slice of slices) {
      const admitted = await admittedTypes(slice, path, resolveProfile);
      resolvedAny ||= admitted.fromProfile;
      unresolved ||= admitted.unresolved;
      for (const type of admitted.types) slicesByType.set(type, (slicesByType.get(type) ?? new Set()).add(slice.sliceName));
    }
    // A slice whose profile could not be read may admit the type as well.
    if (!resolvedAny || unresolved) continue;
    for (const element of elements) {
      const value = !path || path === '$this' ? element : getValueAtPath(element, path);
      for (const candidate of Array.isArray(value) ? value : [value]) {
        if (!isRecord(candidate) || typeof candidate.resourceType !== 'string') continue;
        const owners = slicesByType.get(candidate.resourceType);
        if (owners?.size === 1) sliceInstanceEvidence().typedSlice.set(candidate, [...owners][0]);
      }
    }
  }
}

/** The slice whose admitted type only this value's resource type matches. */
export function sliceTypedByProfile(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null ? sliceInstanceEvidence().typedSlice.get(value) : undefined;
}

async function admittedTypes(
  slice: SliceDefinition,
  path: string,
  resolveProfile: ProfileResolverFn,
): Promise<{ types: Set<string>; fromProfile: boolean; unresolved: boolean }> {
  const types = new Set<string>();
  let fromProfile = false;
  let unresolved = false;
  for (const spec of getTypeSpecsForDiscriminator(slice, path)) {
    if (spec.code && !GENERIC_TYPES.has(spec.code)) {
      types.add(spec.code);
      continue;
    }
    for (const profile of spec.profile ?? []) {
      let type: unknown;
      try {
        type = (await resolveProfile(profile))?.type;
      } catch {
        type = undefined;
      }
      if (typeof type === 'string' && !GENERIC_TYPES.has(type)) {
        types.add(type);
        fromProfile = true;
      } else if (typeof type !== 'string') {
        unresolved = true;
      }
    }
  }
  return { types, fromProfile, unresolved };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
