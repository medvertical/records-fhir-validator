import type { ValidationIssue } from '../types';
import type { StructureDefinition } from './structure-definition-types';
import { createValidationIssue } from '../issues';
import {
  childMatchesBundleEntrySliceCandidate,
  getBundleEntrySliceDefinitions,
} from './bundle-entry-slice-definitions';
import { getCompositionEntryTargetProfiles } from './composition-target-profiles';

export interface BundleDocumentContextChildResult {
  index: number;
  entryResource: Record<string, unknown>;
  resourceType: string;
  issues: ValidationIssue[];
  structureDef?: StructureDefinition;
}

const TARGET_PROFILE_BLOCKING_ASPECTS = new Set([
  'structural',
  'profile',
  'invariant',
]);

const TARGET_PROFILE_BLOCKING_TERMINOLOGY_CODES = new Set([
  'terminology-binding-required',
]);

const KNOWN_IMPOSED_BUNDLE_PROFILES: Record<string, string[]> = {
  'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps': [
    'http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips',
  ],
};

/**
 * Emit HAPI-compatible parent document-context consequences when a
 * Composition.section.entry points at an embedded resource that cannot
 * actually conform to its declared target profile.
 */
export function buildBundleDocumentContextIssues(
  bundle: Record<string, unknown>,
  childResults: BundleDocumentContextChildResult[],
  bundleStructureDef?: StructureDefinition,
): ValidationIssue[] {
  if (childResults.length === 0 || bundle.resourceType !== 'Bundle') return [];

  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
  const byReference = buildChildResultReferenceIndex(entries, childResults);
  const issues: ValidationIssue[] = [
    ...buildBundleEntrySliceConformanceIssues(bundle, childResults, bundleStructureDef),
  ];
  if ((bundle as any).type !== 'document') return dedupeDocumentContextIssues(issues);

  let hasCompositionTargetProfileFailure = false;

  for (const child of childResults) {
    if (child.resourceType !== 'Composition') continue;
    const compositionIssues = buildCompositionTargetProfileIssues(child, byReference);
    if (compositionIssues.length > 0) {
      hasCompositionTargetProfileFailure = true;
      issues.push(...compositionIssues);
    }
  }

  if (hasCompositionTargetProfileFailure) {
    issues.push(...buildBundleCompositionSliceIssues(bundle, bundleStructureDef));
  }

  return dedupeDocumentContextIssues(issues);
}

function buildChildResultReferenceIndex(
  entries: unknown[],
  childResults: BundleDocumentContextChildResult[],
): Map<string, BundleDocumentContextChildResult> {
  const byReference = new Map<string, BundleDocumentContextChildResult>();
  for (const child of childResults) {
    const entry = entries[child.index] as Record<string, unknown> | undefined;
    if (typeof entry?.fullUrl === 'string') {
      byReference.set(entry.fullUrl, child);
    }
    const id = child.entryResource.id;
    if (typeof id === 'string') {
      byReference.set(`${child.resourceType}/${id}`, child);
    }
  }
  return byReference;
}

function buildCompositionTargetProfileIssues(
  compositionChild: BundleDocumentContextChildResult,
  byReference: Map<string, BundleDocumentContextChildResult>,
): ValidationIssue[] {
  const composition = compositionChild.entryResource;
  const sections = Array.isArray(composition.section) ? composition.section : [];
  if (sections.length === 0) return [];

  const prefix = bundleEntryResourcePrefix(
    compositionChild.index,
    composition,
    compositionChild.resourceType,
  );
  const issues: ValidationIssue[] = [];
  visitCompositionSections(sections, 'section', (section, entry, entryPath) => {
    const reference = typeof entry.reference === 'string' ? entry.reference : null;
    if (!reference) return;

    const target = byReference.get(reference);
    if (!target) return;

    const blockingIssues = getTargetProfileBlockingIssues(target.issues);
    if (blockingIssues.length === 0) return;

    const targetProfiles =
      getCompositionEntryTargetProfiles(compositionChild.structureDef, section) ??
      getDeclaredProfiles(target.entryResource);
    if (targetProfiles.length === 0) return;
    if (targetProfilesAllowAnyResource(targetProfiles)) return;

    const targetLabel = formatBundleTargetLabel(target.resourceType, target.entryResource.id);
    const causeIssueCodes = [...new Set(blockingIssues.map(issue => issue.code))];
    const causeSummary = causeIssueCodes.length > 0
      ? ` Blocking child issues: ${causeIssueCodes.join(', ')}.`
      : '';

    issues.push(createValidationIssue({
      code: 'profile-constraint-violation',
      path: `${prefix}.${entryPath}`,
      resourceType: 'Composition',
      profile: getDeclaredProfiles(composition)[0],
      customMessage:
        `Composition.section.entry references ${targetLabel} (${reference}), but the target resource ` +
        `does not match any allowed targetProfile: ${targetProfiles.join(', ')}.${causeSummary}`,
      ruleId: 'profile-targetprofile-match-failed',
      severityOverride: 'error',
      aspectOverride: 'profile',
      details: {
        reference,
        targetProfiles,
        referencedResourceType: target.resourceType,
        referencedResourceId: target.entryResource.id,
        causeIssueCodes,
        fixHint:
          `Fix ${targetLabel} so it conforms to one of the allowed targetProfiles, or update ` +
          'Composition.section.entry to reference a resource that does.',
      },
    }));
  });

  return issues;
}

function targetProfilesAllowAnyResource(targetProfiles: string[]): boolean {
  return targetProfiles.some(profile => {
    const canonical = profile.split('|')[0];
    return canonical === 'http://hl7.org/fhir/StructureDefinition/Resource';
  });
}

function formatBundleTargetLabel(resourceType: string, id: unknown): string {
  return typeof id === 'string' && id.length > 0 ? `${resourceType}/${id}` : resourceType;
}

function buildBundleEntrySliceConformanceIssues(
  bundle: Record<string, unknown>,
  childResults: BundleDocumentContextChildResult[],
  bundleStructureDef: StructureDefinition | undefined,
): ValidationIssue[] {
  const slices = getBundleEntrySliceDefinitions(bundleStructureDef)
    .filter(slice => slice.min > 0);
  if (slices.length === 0) return [];

  const issues: ValidationIssue[] = [];
  const bundleProfile = getDeclaredProfiles(bundle)[0];

  for (const slice of slices) {
    const candidates = childResults.filter(child => childMatchesBundleEntrySliceCandidate(child, slice));
    if (candidates.length === 0) continue;

    const blockedCandidates = candidates
      .map(child => ({
        child,
        blockingIssues: getTargetProfileBlockingIssues(child.issues),
      }))
      .filter(candidate => candidate.blockingIssues.length > 0);

    const cleanMatchCount = candidates.length - blockedCandidates.length;
    if (cleanMatchCount >= slice.min) continue;

    for (const { child, blockingIssues } of blockedCandidates) {
      issues.push(createValidationIssue({
        code: 'profile-constraint-violation',
        path: bundleEntryResourcePrefix(child.index, child.entryResource, child.resourceType),
        resourceType: 'Bundle',
        profile: bundleProfile,
        customMessage: `Bundle.entry:${slice.sliceName} candidate ${child.resourceType}/${String(child.entryResource.id ?? '?')} failed conformance to ${slice.profiles.join(', ') || slice.resourceTypes.join(', ')}`,
        ruleId: 'bundle-entry-slice-profile-match-failed',
        severityOverride: 'error',
        aspectOverride: 'profile',
        details: {
          sliceName: slice.sliceName,
          targetProfiles: slice.profiles,
          targetResourceTypes: slice.resourceTypes,
          candidateEntryIndex: child.index,
          candidateResourceType: child.resourceType,
          candidateResourceId: child.entryResource.id,
          causeIssueCodes: [...new Set(blockingIssues.map(issue => issue.code))],
        },
      }));
    }
  }

  return issues;
}

function visitCompositionSections(
  sections: unknown[],
  pathPrefix: string,
  onEntry: (
    section: Record<string, unknown>,
    entry: Record<string, unknown>,
    path: string,
  ) => void,
): void {
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex] as Record<string, unknown> | undefined;
    if (!section || typeof section !== 'object') continue;
    const sectionPath = `${pathPrefix}[${sectionIndex}]`;

    const entries = Array.isArray(section.entry) ? section.entry : [];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex] as Record<string, unknown> | undefined;
      if (!entry || typeof entry !== 'object') continue;
      onEntry(section, entry, `${sectionPath}.entry[${entryIndex}]`);
    }

    const childSections = Array.isArray(section.section) ? section.section : [];
    if (childSections.length > 0) {
      visitCompositionSections(childSections, `${sectionPath}.section`, onEntry);
    }
  }
}

function getTargetProfileBlockingIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter(issue => {
    if (issue.severity !== 'error' && issue.severity !== 'fatal') return false;
    if (issue.ruleId === 'profile-targetprofile-match-failed') return false;

    if (TARGET_PROFILE_BLOCKING_ASPECTS.has(issue.aspect)) return true;
    return issue.aspect === 'terminology' &&
      typeof issue.code === 'string' &&
      TARGET_PROFILE_BLOCKING_TERMINOLOGY_CODES.has(issue.code);
  });
}

function dedupeDocumentContextIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.ruleId ?? issue.code}|${issue.path}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }

  return out;
}

function getDeclaredProfiles(resource: Record<string, unknown>): string[] {
  const profiles = (resource.meta as any)?.profile;
  return Array.isArray(profiles)
    ? profiles.filter((profile: unknown): profile is string => typeof profile === 'string')
    : [];
}

function buildBundleCompositionSliceIssues(
  bundle: Record<string, unknown>,
  bundleStructureDef: StructureDefinition | undefined,
): ValidationIssue[] {
  const sources = getBundleCompositionSliceSources(bundle, bundleStructureDef);
  return sources.map(source => createValidationIssue({
    code: 'profile-slice-min-cardinality',
    path: 'Bundle',
    resourceType: 'Bundle',
    profile: source.profile,
    customMessage: source.label
      ? `Bundle requires a conformant Bundle.entry:composition slice, but none was found (from ${source.label}).`
      : 'Bundle requires a conformant Bundle.entry:composition slice, but none was found.',
    ruleId: 'slice-min-composition-conformance',
    severityOverride: 'error',
    aspectOverride: 'profile',
    details: {
      sliceName: 'composition',
      reason: 'composition-entry-target-profile-match-failed',
      sourceProfile: source.profile,
      targetResourceType: 'Composition',
      fixHint:
        'Ensure the document Bundle has a Composition entry that matches the required slice. ' +
        'If a Composition is present, fix its profile or child targetProfile failures first.',
    },
  }));
}

function getBundleCompositionSliceSources(
  bundle: Record<string, unknown>,
  bundleStructureDef: StructureDefinition | undefined,
): Array<{ profile?: string; label?: string }> {
  const sources: Array<{ profile?: string; label?: string }> = [];
  const seen = new Set<string>();
  const addSource = (profile: string | undefined, version?: string): void => {
    if (
      !profile ||
      profile === 'http://hl7.org/fhir/StructureDefinition/Bundle' ||
      profile === 'http://hl7.org/fhir/StructureDefinition/Resource'
    ) return;
    const label = version && !profile.includes('|') ? `${profile}|${version}` : profile;
    if (seen.has(label)) return;
    seen.add(label);
    sources.push({ profile, label });
  };

  const profiles = getDeclaredProfiles(bundle);
  addSource(
    profiles[0] ?? bundleStructureDef?.url,
    profiles[0] === bundleStructureDef?.url ? bundleStructureDef?.version : undefined,
  );
  for (const imposedProfile of getImposedProfiles(bundleStructureDef)) {
    addSource(imposedProfile);
  }
  for (const imposedProfile of getKnownImposedBundleProfiles(profiles[0] ?? bundleStructureDef?.url)) {
    addSource(imposedProfile);
  }
  addSource(bundleStructureDef?.baseDefinition);

  if (sources.length === 0) sources.push({});
  return sources;
}

function getImposedProfiles(
  structureDef: StructureDefinition | undefined,
): string[] {
  const extensions = Array.isArray((structureDef as any)?.extension)
    ? (structureDef as any).extension
    : [];
  return extensions
    .filter((extension: any) =>
      extension?.url === 'http://hl7.org/fhir/StructureDefinition/structuredefinition-imposeProfile' &&
      typeof extension?.valueCanonical === 'string'
    )
    .map((extension: any) => extension.valueCanonical);
}

function getKnownImposedBundleProfiles(profile: string | undefined): string[] {
  if (!profile) return [];
  return KNOWN_IMPOSED_BUNDLE_PROFILES[profile.split('|')[0]] ?? [];
}

function bundleEntryResourcePrefix(
  entryIndex: number,
  entryResource: Record<string, unknown>,
  resourceType: string,
): string {
  const rtId = typeof entryResource.id === 'string'
    ? `${resourceType}/${entryResource.id}`
    : resourceType;
  return `Bundle.entry[${entryIndex}].resource/*${rtId}*/`;
}
