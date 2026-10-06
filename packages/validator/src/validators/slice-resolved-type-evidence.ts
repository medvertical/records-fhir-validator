import type { SlicingDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import type { FhirVersionFamily } from '../core/sd-loader-version-utils.js';
import { KNOWN_FHIR_RESOURCE_TYPES } from '../reference/reference-resource-types.js';
import { normalizeDiscriminatorPath } from './slice-discriminator-constraints.js';
import { splitResolveDiscriminatorPath } from './slice-discriminator-path.js';
import { matchesRequestedDefinition } from './slice-validated-conformance.js';
import type { ReferenceResolver, ResolvedCodeElementMatch, SliceDefinition } from './slice-types.js';
import { getElementTypes, getProfileElements } from './slice-info-input.js';
import { getValueAtPath } from './slice-utils.js';

type TypeMatchState = 'matched' | 'nonmember' | 'unknown';
const GENERIC_TYPES = new Set(['Resource', 'DomainResource', 'Element', 'BackboneElement', 'Narrative']);

/** A singleton TYPE receipt proves discriminator membership, never profile conformance. */
export async function prepareResolvedTypeEvidence(options: {
  elements: unknown[];
  slices: SliceDefinition[];
  slicing: SlicingDefinition;
  referenceResolver: ReferenceResolver | null;
  typeProfileResolver: ((canonical: string) => Promise<StructureDefinition | null>) | null;
  fhirVersion: FhirVersionFamily;
  attestedGroup: boolean;
  profile: StructureDefinition;
  elementPath: string;
  definitionPath?: string;
}): Promise<SliceDefinition[]> {
  const { slices, slicing, elements } = options;
  const discriminator = slicing.discriminator?.[0];
  if (!options.attestedGroup || elements.length === 0 || slices.length !== 1
    || slices[0].sliceName.includes('/') || slicing.discriminator?.length !== 1
    || discriminator?.type !== 'type') return slices;
  const step = splitResolveDiscriminatorPath(normalizeDiscriminatorPath(discriminator.path));
  if (!step || step.remainder || step.referencePath === '$this') return slices;
  const specs = slices[0].childTypes?.get(step.referencePath);
  const profiles = specs?.[0].targetProfile;
  if (specs?.length !== 1 || specs[0].code !== 'Reference' || profiles?.length !== 1) return slices;
  const path = options.definitionPath ?? options.elementPath;
  const snapshot = getProfileElements({ ...options.profile, differential: undefined });
  const roots = snapshot.filter(element => element.id === `${path}:${slices[0].sliceName}` && element.path === path);
  if (roots.length !== 1 || roots[0].sliceName !== slices[0].sliceName
    || roots[0].min !== slices[0].min || roots[0].max !== slices[0].max) return slices;
  const children = snapshot.filter(element =>
    element.id === `${path}:${slices[0].sliceName}.${step.referencePath}`
    && element.path === `${path}.${step.referencePath}`);
  const childSpecs = children.length === 1 ? getElementTypes(children[0]) : [];
  if (childSpecs.length !== 1 || childSpecs[0].code !== 'Reference'
    || childSpecs[0].targetProfile?.length !== 1 || childSpecs[0].targetProfile[0] !== profiles[0]) return slices;

  const states = new Map<unknown, TypeMatchState>();
  const targets = new Map<string, unknown>();
  const references = new Map<unknown, string>();
  for (const element of elements) {
    states.set(element, 'unknown');
    const value = getValueAtPath(element, step.referencePath);
    if (!isRecord(value) || typeof value.reference !== 'string' || !value.reference) continue;
    references.set(element, value.reference);
    if (!targets.has(value.reference)) {
      try { targets.set(value.reference, options.referenceResolver?.(value.reference) ?? null); }
      catch { targets.set(value.reference, null); }
    }
  }
  // An unavailable target cannot supply a type; avoid a lookup that cannot decide it.
  if (options.typeProfileResolver && [...targets.values()].some(isConcreteResource)) {
    let admittedType: string | undefined;
    try {
      const definition = await options.typeProfileResolver(profiles[0]);
      const type = definition?.type;
      if (matchesRequestedDefinition(profiles[0], definition, options.fhirVersion)
        && typeof type === 'string' && isConcreteType(type)) admittedType = type;
    } catch { admittedType = undefined; }
    if (admittedType) {
      for (const [element, reference] of references) {
        const target = targets.get(reference);
        if (isConcreteResource(target)) states.set(element,
          target.resourceType === admittedType ? 'matched' : 'nonmember');
      }
    }
  }
  return [{ ...slices[0], resolvedTypeEvidence: element => states.get(element) ?? 'unknown' }];
}

/** Presence of a scoped receipt distinguishes unknown from the legacy unsupported path. */
export function assessResolvedTypeElementMatch(
  element: unknown,
  slices: SliceDefinition[],
): ResolvedCodeElementMatch | null {
  if (slices.length !== 1) return null;
  const slice = slices[0], receipt = slice.resolvedTypeEvidence;
  if (!receipt) return null;
  const state = receipt(element);
  const metadata = { hasUnresolvedCodeMetadata: false, unknownSlices: state === 'unknown' ? [slice] : [] };
  return state === 'matched'
    ? { state, slice, matchedSlices: [slice], ...metadata }
    : { state, slice: null, ...metadata };
}

function isConcreteType(type: string): boolean {
  return KNOWN_FHIR_RESOURCE_TYPES.has(type) && !GENERIC_TYPES.has(type);
}

function isConcreteResource(value: unknown): value is Record<string, unknown> & { resourceType: string } {
  return isRecord(value) && typeof value.resourceType === 'string' && isConcreteType(value.resourceType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
