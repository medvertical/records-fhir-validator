import { localDatatypeConstraintsReject, partialDatatypeMembership, partialProfileMembership } from './slice-datatype-conformance.js';
import type { SlicingDefinition } from '../core/structure-definition-types.js';
import { KNOWN_FHIR_RESOURCE_TYPES } from '../reference/reference-resource-types.js';
import { normalizeDiscriminatorPath } from './slice-discriminator-constraints.js';
import { splitResolveDiscriminatorPath } from './slice-discriminator-path.js';
import { getTypeSpecsForDiscriminator, matchTypeDiscriminator } from './slice-type-discriminator.js';
import { getValueAtPath } from './slice-utils.js';
import type { ReferenceResolver, SliceDefinition } from './slice-types.js';

interface ValidatedProfileNonmembers {
  nonmemberIndices: Set<number>;
  unverifiedIndices: Set<number>;
}

/** Negative receipts must not promote the synchronous declaration fallback to evidence. */
export function assessValidatedProfileNonmembers(
  elements: unknown[],
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  resolver: ReferenceResolver | null,
  legacyMatch: (element: unknown) => SliceDefinition | null,
): ValidatedProfileNonmembers | null {
  if (!resolver || slices.length === 0 || new Set(slices.map(slice => slice.sliceName)).size !== slices.length
    || !slices.every(slice => slice.validatedProfileConformanceEvidence)) return null;
  const discriminator = slicing.discriminator?.[0];
  if (slicing.discriminator?.length !== 1 || discriminator?.type !== 'profile') return null;
  const step = splitResolveDiscriminatorPath(normalizeDiscriminatorPath(discriminator.path || '$this'));
  if (!step || (step.remainder && step.remainder !== '$this')) return null;
  const nonmemberIndices = new Set<number>();
  const unverifiedIndices = new Set<number>();
  for (const [index, element] of elements.entries()) {
    const value = step.referencePath === '$this' ? element : getValueAtPath(element, step.referencePath);
    const target = resolveTarget(value, resolver);
    const states = new Map<string, boolean | undefined>();
    for (const slice of slices) {
      const profiles = getTypeSpecsForDiscriminator(slice, step.referencePath)
        .flatMap(spec => [...(spec.profile ?? []), ...(spec.targetProfile ?? [])]);
      const verdict = target && profiles.length > 0 ? slice.validatedProfileConformanceEvidence?.(target, profiles) : undefined;
      states.set(slice.sliceName, verdict);
    }
    const matched = legacyMatch(element);
    // Partial receipt consumption cannot safely keep an unproved positive match.
    // Leave the whole group on its existing policy until that fallback is reviewed.
    if (matched ? states.get(matched.sliceName) !== true
      : [...states.values()].some(state => state === true)) return null;
    if ([...states.values()].some(state => state === undefined)) unverifiedIndices.add(index);
    if ([...states.values()].every(state => state === false)) nonmemberIndices.add(index);
  }
  return { nonmemberIndices, unverifiedIndices };
}

function resolveTarget(value: unknown, resolver: ReferenceResolver): unknown | null {
  const reference = typeof value === 'string' ? value
    : value && typeof value === 'object' && !Array.isArray(value) && 'reference' in value ? value.reference : null;
  if (typeof reference !== 'string') return null;
  try { return resolver(reference) ?? null; } catch { return null; }
}

/** Consume the invocation's direct resource receipts without declaration fallback. */
export function directProfileSliceStates(
  element: unknown,
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
): Map<SliceDefinition, boolean | undefined> | null {
  const partialDatatype = partialDatatypeMembership(element);
  const sole = slicing.discriminator?.[0];
  if (partialDatatype && slicing.discriminator?.length === 1 && sole?.type === 'profile'
    && normalizeDiscriminatorPath(sole.path || '$this') === '$this') {
    return new Map(slices.map(slice => {
      const state = partialDatatype.get(slice.sliceName);
      return [slice, state === undefined && violatesLocalSliceConstraints(element, slice) ? false : state];
    }));
  }
  const direct = directResourceProfileDiscrimination(slices, slicing);
  if (!direct || slices.length === 0
    || new Set(slices.map(slice => slice.sliceName)).size !== slices.length) return null;
  const { path } = direct;
  const target = path === '$this' ? element : getValueAtPath(element, path);
  const partial = partialProfileMembership(target);
  if (!partial && !slices.every(slice => slice.validatedProfileConformanceEvidence)) return null;
  return new Map(slices.map(slice => {
    const profiles = getTypeSpecsForDiscriminator(slice, path)
      .flatMap(spec => [...(spec.profile ?? []), ...(spec.targetProfile ?? [])]);
    // A supplied conformance receipt, including U, owns membership before local preparation.
    const profileState = profiles.length === 0 ? undefined : slice.validatedProfileConformanceEvidence
      ? slice.validatedProfileConformanceEvidence(target, profiles)
      : slice.validatedProfileConformance?.(target, profiles) ?? partial?.get(slice.sliceName);
    // Conformance to the loaded profile cannot override an explicit TYPE constraint.
    return [slice, direct.requiresType && !matchTypeDiscriminator(element, slice, path) ? false : profileState];
  }));
}

function violatesLocalSliceConstraints(element: unknown, slice: SliceDefinition): boolean {
  const local = slice.localProfileDiscriminatorElements;
  return Boolean(local && localDatatypeConstraintsReject(element, local));
}

/** Only resource metadata can authorize the resource conformance receipt path. */
export function directResourceProfileDiscrimination(
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
): { path: string; requiresType: boolean } | null {
  const discriminators = slicing.discriminator ?? [];
  const profile = discriminators.find(discriminator => discriminator.type === 'profile');
  const path = normalizeDiscriminatorPath(profile?.path || '$this');
  const type = discriminators.find(discriminator => discriminator.type === 'type');
  const requiresType = discriminators.length === 2;
  if (!profile || (path !== '$this' && path !== 'resource')
    || (discriminators.length !== 1 && !requiresType)
    || (requiresType && (!type || normalizeDiscriminatorPath(type.path || '$this') !== path))) return null;
  return slices.every(slice => {
    const specs = getTypeSpecsForDiscriminator(slice, path);
    return specs.length > 0 && specs.every(spec => KNOWN_FHIR_RESOURCE_TYPES.has(spec.code)
      && spec.code !== 'Element' && spec.code !== 'BackboneElement' && spec.code !== 'Narrative'
      && spec.code !== 'Signature');
  }) ? { path, requiresType } : null;
}
