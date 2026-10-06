import { fhirVersionFamily, type FhirVersionFamily } from '../core/sd-loader-version-utils.js';
import { KNOWN_FHIR_RESOURCE_TYPES } from '../reference/reference-resource-types.js';
import type { SlicingDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { normalizeDiscriminatorPath } from './slice-discriminator-constraints.js';
import { splitResolveDiscriminatorPath } from './slice-discriminator-path.js';
import { getTypeSpecsForDiscriminator } from './slice-type-discriminator.js';
import { directResourceProfileDiscrimination } from './slice-profile-nonmember-proof.js';
import type { ReferenceResolver, SliceDefinition } from './slice-types.js';
import { getValueAtPath } from './slice-utils.js';
import type { ProfileConformanceCheck, ProfileConformanceVerdict } from './sd-fhirpath-profile-conformance.js';

type ProfileResolverFn = (profileUrl: string) => Promise<(Pick<StructureDefinition, 'type'> & Partial<Pick<StructureDefinition, 'url' | 'version' | 'fhirVersion'>>) | null>;

const GENERIC_TYPES = new Set(['Resource', 'DomainResource']);

/**
 * The reference validator places a resource by a profile discriminator
 * through conformsTo(): it validates the resource against each slice's
 * profile and does not look at meta.profile, so an IPS Observation that
 * conforms to two entry slices' profiles matches both. Where the validation
 * session can validate, every resource at the discriminated path is held to
 * the profiles of the slices that admit its type, and those verdicts decide
 * the slice; a profile it cannot read or reach leaves the slice to the
 * approximations of the synchronous matcher. A discriminator that traverses
 * resolve() is decided the same way on the resource the reference names (CH
 * Lab-Order's section entries by the ServiceRequest profile). Keyed by the
 * invocation, the verdicts cannot leak into another validation of the same
 * parsed resource or another slicing.
 */
export async function prepareValidatedProfileConformance(
  elements: unknown[],
  slices: SliceDefinition[],
  slicing: SlicingDefinition,
  resolveProfile: ProfileResolverFn | null,
  conformsTo: ProfileConformanceCheck | undefined,
  referenceResolver: ReferenceResolver | null = null,
  allowNegativeProfileEvidence = false,
  requestedFhirVersion?: FhirVersionFamily,
): Promise<SliceDefinition[]> {
  const validatedSlicesByValue = new WeakMap<object, Map<string, boolean>>();
  const evidenceByValue = new WeakMap<object, Map<string, boolean | undefined>>();
  const discriminator = slicing.discriminator?.[0];
  const step = discriminator?.type === 'profile'
    ? splitResolveDiscriminatorPath(normalizeDiscriminatorPath(discriminator.path || '$this')) : null;
  const directResourceProfile = directResourceProfileDiscrimination(slices, slicing);
  const preparedEvidence = allowNegativeProfileEvidence && hasRequestFamily(requestedFhirVersion)
    && Boolean(resolveProfile && conformsTo)
    && (Boolean(directResourceProfile) || (slicing.discriminator?.length === 1
      && Boolean(step && (!step.remainder || step.remainder === '$this'))));
  const prepared = slices.map(slice => ({
    ...slice,
    validatedProfileConformance: (value: unknown, profiles: string[]) => isRecord(value)
      ? validatedSlicesByValue.get(value)?.get(verdictKey(slice.sliceName, profiles)) : undefined,
    ...(preparedEvidence ? { validatedProfileConformanceEvidence: (value: unknown, profiles: string[]) => isRecord(value)
      ? evidenceByValue.get(value)?.get(verdictKey(slice.sliceName, profiles)) : undefined } : {}),
  }));
  if (!resolveProfile || !conformsTo) return prepared;
  const paths = (slicing.discriminator ?? [])
    .filter(discriminator => discriminator.type === 'profile')
    .map(discriminator => normalizeDiscriminatorPath(discriminator.path || '$this'));

  for (const path of paths) {
    const resolveStep = splitResolveDiscriminatorPath(path);
    if (resolveStep && (!referenceResolver || (resolveStep.remainder && resolveStep.remainder !== '$this'))) continue;
    // The type specs naming the slice's profiles sit on the element holding the Reference.
    const specPath = resolveStep ? resolveStep.referencePath : path;
    const valuePath = resolveStep ? resolveStep.referencePath : path;
    const resources = elements
      .flatMap(element => [!valuePath || valuePath === '$this' ? element : getValueAtPath(element, valuePath) ?? []].flat())
      .map(value => (resolveStep && referenceResolver ? resolveReferenceTarget(value, referenceResolver) : value))
      .filter((value): value is Record<string, unknown> => isRecord(value) && typeof value.resourceType === 'string');
    for (const resource of resources) {
      const verdicts = validatedSlicesByValue.get(resource) ?? new Map<string, boolean>();
      const evidence = evidenceByValue.get(resource) ?? new Map<string, boolean | undefined>();
      for (const slice of slices) {
        const profiles = getTypeSpecsForDiscriminator(slice, specPath)
          .flatMap(spec => [...(spec.profile ?? []), ...(spec.targetProfile ?? [])]);
        const verdict = await sliceVerdict(resource, profiles, resolveProfile, conformsTo, requestedFhirVersion);
        if (verdict.value !== undefined) verdicts.set(verdictKey(slice.sliceName, profiles), verdict.value);
        evidence.set(verdictKey(slice.sliceName, profiles), verdict.evidence);
      }
      if (verdicts.size > 0) validatedSlicesByValue.set(resource, verdicts);
      evidenceByValue.set(resource, evidence);
    }
  }
  return prepared;
}

function verdictKey(sliceName: string, profiles: string[]): string {
  return `${sliceName}|${[...new Set(profiles)].sort().join(' ')}`;
}

/** A slice matches when the resource conforms to one of its profiles of the resource's type. */
async function sliceVerdict(
  resource: Record<string, unknown>,
  profiles: string[],
  resolveProfile: ProfileResolverFn,
  conformsTo: ProfileConformanceCheck,
  requestedFhirVersion: FhirVersionFamily | undefined,
): Promise<{ value: boolean | undefined; evidence: boolean | undefined }> {
  if (profiles.length === 0) return { value: undefined, evidence: undefined };
  let undecided = false;
  let evidenceUndecided = false;
  for (const profile of profiles) {
    let type: unknown;
    let selectedCanonicalConfirmed = false;
    try {
      const definition = await resolveProfile(profile);
      type = definition?.type;
      selectedCanonicalConfirmed = matchesRequestedDefinition(profile, definition, requestedFhirVersion);
    } catch {
      type = undefined;
    }
    if (typeof type !== 'string' || GENERIC_TYPES.has(type)) {
      undecided = true;
      evidenceUndecided = true;
      continue;
    }
    const concreteResourceType = selectedCanonicalConfirmed && KNOWN_FHIR_RESOURCE_TYPES.has(type)
      && type !== 'Element' && type !== 'BackboneElement' && type !== 'Narrative';
    if (!concreteResourceType) evidenceUndecided = true;
    if (type !== resource.resourceType) continue;
    let conforms: ProfileConformanceVerdict;
    try {
      conforms = await conformsTo(resource, profile);
    } catch {
      conforms = undefined;
    }
    if (conforms === true) return { value: true, evidence: concreteResourceType ? true : undefined };
    if (conforms === undefined) { undecided = true; evidenceUndecided = true; }
  }
  return { value: undecided ? undefined : false, evidence: evidenceUndecided ? undefined : false };
}

export function matchesRequestedDefinition(
  profile: string,
  definition: Partial<Pick<StructureDefinition, 'url' | 'version' | 'fhirVersion'>> | null,
  requestedFhirVersion: FhirVersionFamily | undefined,
): boolean {
  try {
    const [canonical, version, ...extra] = profile.split('|');
    if (!hasRequestFamily(requestedFhirVersion) || definition?.url !== canonical || extra.length > 0
      || (version !== undefined && (!version || definition.version !== version))) return false;
    // Capture optional metadata once; injected resolvers may expose accessors.
    const publication = definition.fhirVersion;
    if (publication === undefined) return true;
    if (typeof publication !== 'string' || !/^[456]\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(publication)) return false;
    return fhirVersionFamily({ fhirVersion: publication } as unknown as StructureDefinition) === requestedFhirVersion;
  } catch {
    return false;
  }
}

function hasRequestFamily(version: FhirVersionFamily | undefined): version is FhirVersionFamily {
  return version === 'R4' || version === 'R5' || version === 'R6';
}

/** The resource a Reference (or a canonical string) names, as the matcher resolves it. */
function resolveReferenceTarget(value: unknown, resolver: ReferenceResolver): unknown {
  const reference = isRecord(value) && typeof value.reference === 'string' ? value.reference
    : typeof value === 'string' ? value : null;
  if (!reference) return null;
  try { return resolver(reference) ?? null; } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
