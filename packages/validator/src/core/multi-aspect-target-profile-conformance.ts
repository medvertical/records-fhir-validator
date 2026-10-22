import { prepareReferenceTargetSliceSelections } from '../validators/reference-target-slice-selection.js';
import { elementTypeTargetProfileSource } from '../package/element-profile-reference-provenance.js';
import type { ProfileReferenceSource } from './profile-reference-authority.js';
import { copyProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import { ProfileReferenceUnavailableError, profileReferenceUnavailableIssue } from './profile-reference-authority.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import type { StructureDefinition } from './structure-definition-types.js';
import type { ProfiledTargetHit, ReferenceResolver, ReferenceTargetValidator } from '../validators/reference-target-validator.js';
import { isProfiledCanonical } from '../validators/reference-target-type-resolution.js';
import type { ProfileConformanceCheck, ProfileConformanceVerdict } from '../validators/sd-fhirpath-profile-conformance.js';
import { createValidationIssue } from '../issues/index.js';
import { extractExtensionDefinitions, normalizeExtensionUrlForMatching } from '../validators/extension-definition-extractor.js';
import { loadExtensionProfile } from '../validators/extension-profile-cache.js';

const CORE_DEFINITION = 'http://hl7.org/fhir/StructureDefinition/';

/**
 * Target-profile conformance as the reference validator checks it for the
 * targets it holds: where a Reference names profiled targetProfiles, a
 * resolved target must conform to one of the choices made for its type, the
 * type's core definition included, else one error names all the choices
 * ("Unable to find a profile match for Patient/p1 among choices: …"). Choices
 * that are all core definitions, or Resource, leave the target to its own
 * validation.
 *
 * The supplied check owns recursion bounds and session caching. An unavailable
 * alternative leaves the OR condition undecided; profiles made for another
 * resource type are excluded from it.
 */
export async function validateReferenceTargetProfileConformance(params: {
  resource: unknown;
  structureDef: StructureDefinition;
  referenceTargetValidator: ReferenceTargetValidator;
  resolveReference?: ReferenceResolver | null;
  /** Whether a target conforms, cannot be checked, or has an inapplicable resource type. */
  conformsTo?: ProfileConformanceCheck;
  /** Loads an extension's definition, whose value element may name targetProfiles of its own. */
  pinExtensionProfile?: (url: string, definition: StructureDefinition) => Promise<string>;
  onIncomplete?: (issue: ValidationIssue) => void;
  loadExtensionDefinition?: (url: string, parent?: StructureDefinition) => Promise<StructureDefinition | null | undefined>;
  loadReferenceTargetDefinition?: (url: string, source: ProfileReferenceSource) => Promise<StructureDefinition | null>;
}): Promise<ValidationIssue[]> {
  const { resource, structureDef, referenceTargetValidator, resolveReference, conformsTo } = params;
  if (!resolveReference || !conformsTo) return [];
  const resourceType = isRecord(resource) && typeof resource.resourceType === 'string'
    ? resource.resourceType
    : 'Unknown';

  const selectedSlices = isRecord(resource) && params.loadReferenceTargetDefinition
    ? await prepareReferenceTargetSliceSelections(resource, structureDef, resolveReference,
      params.loadReferenceTargetDefinition, params.onIncomplete) : undefined;
  const profiledHits = referenceTargetValidator.collectProfiledTargetHits(resource, structureDef, selectedSlices);
  const extensionHits = params.loadExtensionDefinition
    ? await collectExtensionTargetHits(resource, params.loadExtensionDefinition, params.pinExtensionProfile, params.onIncomplete)
    : [];
  const seen = new Set(profiledHits.map(hit => `${hit.path}|${hit.reference}`));
  const issues: ValidationIssue[] = [];
  for (const hit of [...profiledHits, ...extensionHits.filter(hit => !seen.has(`${hit.path}|${hit.reference}`))]) {
    const target = resolveTarget(resolveReference, hit.reference);
    if (!target || hit.choices.some(choice => choice.split('|')[0] === `${CORE_DEFINITION}Resource`)) continue;
    const coreChoices = hit.choices.filter(choice => choice.split('|')[0] === `${CORE_DEFINITION}${target.resourceType}`);
    if (!await matchesNoCandidate(target, hit.profiles, coreChoices, conformsTo, hit.referencingProfile, hit.profileCandidates)) continue;
    issues.push(createValidationIssue({
      code: 'reference-target-profile-noncompliant',
      path: hit.path,
      resourceType,
      customMessage: `Unable to find a profile match for ${hit.reference} among choices: ${hit.choices.join(', ')}`,
      details: {
        reference: hit.reference,
        targetProfiles: hit.choices,
        targetResourceType: target.resourceType,
      },
    }));
  }
  return issues;
}

/**
 * Targets the validated content holds itself (Bundle entries, contained
 * resources) are held to their targetProfiles by default, as the reference
 * validator does; targets fetched from elsewhere only when
 * `validateTargetProfiles` asks for it.
 */
export function targetProfileResolver(
  settings: Pick<ValidationSettings, 'recursiveReferenceValidation'> | undefined,
  resolvers: { local?: ReferenceResolver | null; all?: ReferenceResolver | null },
): ReferenceResolver | null | undefined {
  const recursive = settings?.recursiveReferenceValidation;
  if (recursive?.validateTargetProfiles === true) return resolvers.all;
  if (recursive?.validateTargetProfiles === false || recursive?.enabled === false) return undefined;
  return resolvers.local;
}

/**
 * References in extension values are held to the targetProfiles of the
 * extension's own definition, which the resource's profile does not repeat
 * (VhDir's usage-restriction points at a contained vhdir-restriction Consent).
 * Contained resources and Bundle entries are validated on their own.
 */
export async function collectExtensionTargetHits(
  resource: unknown,
  loadDefinition: (url: string, parent?: StructureDefinition) => Promise<StructureDefinition | null | undefined>,
  _pinProfile?: (url: string, definition: StructureDefinition) => Promise<string>,
  onIncomplete?: (issue: ValidationIssue) => void,
): Promise<ProfiledTargetHit[]> {
  if (!isRecord(resource) || typeof resource.resourceType !== 'string') return [];
  const found: Array<{ url: string; path: string; reference: string; parents: string[] }> = [];
  collectExtensionReferences(resource, resource.resourceType, true, found);
  const hits: ProfiledTargetHit[] = [];
  for (const item of found) {
    let definition: StructureDefinition | null | undefined;
    try {
      for (const ancestor of item.parents) {
        definition = definition ? await loadDefinition(ancestor, definition) : await loadDefinition(ancestor);
        if (!definition) break;
      }
      if (item.parents.length && !definition) continue;
      definition = definition ? await loadDefinition(item.url, definition) : await loadDefinition(item.url);
    }
    catch (error: unknown) {
      if (error instanceof ProfileReferenceUnavailableError) onIncomplete?.(profileReferenceUnavailableIssue(error, item.path));
      continue;
    }
    const value = definition?.snapshot?.element?.find(element => element.path === 'Extension.value[x]');
    const declaredChoices = [...new Set((value?.type ?? [])
      .filter(type => type.code === 'Reference')
      .flatMap(type => (type.targetProfile ?? []).filter((profile): profile is string => typeof profile === 'string')))].sort();
    const choices = declaredChoices;
    const profiles = choices.filter(isProfiledCanonical);
    const candidates = (value?.type ?? []).filter(type => type.code === 'Reference')
      .flatMap(type => (type.targetProfile ?? []).filter((profile): profile is string => typeof profile === 'string' && isProfiledCanonical(profile))
        .map(profile => ({ profile, referencingProfile: elementTypeTargetProfileSource(type) })));
    const profileCandidates = candidates.some(candidate => candidate.referencingProfile) ? candidates : undefined;
    if (profiles.length > 0) hits.push({ path: item.path, reference: item.reference, profiles, choices,
      ...(definition ? { referencingProfile: definition } : {}), ...(profileCandidates ? { profileCandidates } : {}) });
  }
  return hits;
}

function collectExtensionReferences(
  value: unknown,
  path: string,
  isRoot: boolean,
  found: Array<{ url: string; path: string; reference: string; parents: string[] }>,
  parents: string[] = [],
  isExtension = false,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectExtensionReferences(item, `${path}[${index}]`, false, found, parents, isExtension));
    return;
  }
  if (!isRecord(value)) return;
  const reference = isRecord(value.valueReference) ? value.valueReference.reference : undefined;
  const absoluteUrl = isExtension && typeof value.url === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(value.url) ? value.url : undefined;
  if (absoluteUrl && typeof reference === 'string' && reference) {
    found.push({ url: absoluteUrl, path: `${path}.valueReference`, reference, parents });
  }
  const ancestors = absoluteUrl ? [...parents, absoluteUrl] : parents;
  for (const [key, child] of Object.entries(value)) {
    if (isRoot && (key === 'contained' || (value.resourceType === 'Bundle' && key === 'entry'))) continue;
    const extensionArray = key === 'extension' || key === 'modifierExtension';
    collectExtensionReferences(child, `${path}.${key.replace(/^_/, '')}`, false, found,
      extensionArray ? ancestors : parents, extensionArray);
  }
}

function resolveTarget(
  resolveReference: ReferenceResolver,
  reference: string,
): Record<string, unknown> & { resourceType: string } | undefined {
  let target: unknown;
  try {
    target = resolveReference(reference);
  } catch {
    return undefined;
  }
  return isRecord(target) && typeof target.resourceType === 'string'
    ? target as Record<string, unknown> & { resourceType: string }
    : undefined;
}

/** A profiled choice is made for the target's type, and neither it nor the core choices accept the target. */
async function matchesNoCandidate(
  target: Record<string, unknown>,
  profiles: string[],
  coreChoices: string[],
  conformsTo: ProfileConformanceCheck,
  referencingProfile?: ProfileReferenceSource,
  issuedCandidates?: ProfiledTargetHit['profileCandidates'],
): Promise<boolean> {
  const candidates = profiles.flatMap(profile => {
    const issued = issuedCandidates?.filter(candidate => candidate.profile === profile);
    return issued?.length ? issued : [{ profile, referencingProfile }];
  });
  let profiledCandidates = 0;
  for (const { profile, referencingProfile: source } of [...candidates, ...coreChoices.map(profile => ({ profile, referencingProfile }))]) {
    if (profiledCandidates === 0 && coreChoices.includes(profile)) return false;
    let verdict: ProfileConformanceVerdict;
    try {
      verdict = await conformsTo(target, profile, source ?? referencingProfile);
    } catch {
      return false;
    }
    if (verdict === undefined || verdict === true) return false;
    if (verdict === 'not-applicable') continue;
    if (!coreChoices.includes(profile)) profiledCandidates += 1;
  }
  return profiledCandidates > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadExtensionTargetDefinition(
  loader: StructureDefinitionLoader, generator: SnapshotGenerator, url: string,
  source: StructureDefinition, family: 'R4' | 'R5' | 'R6',
): Promise<StructureDefinition | null> {
  const declaration = extractExtensionDefinitions(source).byUrl.get(normalizeExtensionUrlForMatching(url));
  const profile = await loadExtensionProfile(loader, declaration?.profileUrl ?? url,
    declaration?.profileUrl ? source : null, family);
  if (!profile || profile.snapshot?.element?.length || !profile.differential?.element?.length) return profile;
  const element = await generator.generateSnapshot(profile, { fhirVersion: family, cacheResults: false });
  const materialized = { ...profile, snapshot: { element } };
  copyProfilePackageProvenance(profile, materialized);
  return materialized;
}
