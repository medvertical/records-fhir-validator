import type { ValidationIssue } from '../types';
import type { StructureDefinition } from './structure-definition-types';
import { createValidationIssue } from '../issues';

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
  'terminology-display-mismatch',
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

    issues.push(createValidationIssue({
      code: 'profile-constraint-violation',
      path: `${prefix}.${entryPath}`,
      resourceType: 'Composition',
      profile: getDeclaredProfiles(composition)[0],
      customMessage: `Unable to find a profile match for ${reference} among choices: ${targetProfiles.join(', ')}`,
      ruleId: 'profile-targetprofile-match-failed',
      severityOverride: 'error',
      aspectOverride: 'profile',
      details: {
        reference,
        targetProfiles,
        referencedResourceType: target.resourceType,
        referencedResourceId: target.entryResource.id,
        causeIssueCodes: [...new Set(blockingIssues.map(issue => issue.code))],
      },
    }));
  });

  return issues;
}

interface BundleEntrySliceDefinition {
  sliceName: string;
  min: number;
  max: string;
  resourceTypes: string[];
  profiles: string[];
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

    issues.push(createValidationIssue({
      code: 'profile-slice-min-cardinality',
      path: 'Bundle.entry',
      resourceType: 'Bundle',
      profile: bundleProfile,
      customMessage: `Slice 'Bundle.entry:${slice.sliceName}': a matching slice is required, but candidate entries failed conformance`,
      ruleId: `bundle-entry-slice-min-${slice.sliceName}-conformance`,
      severityOverride: 'error',
      aspectOverride: 'profile',
      details: {
        sliceName: slice.sliceName,
        min: slice.min,
        actual: cleanMatchCount,
        candidateCount: candidates.length,
        reason: 'bundle-entry-resource-profile-match-failed',
        targetProfiles: slice.profiles,
        targetResourceTypes: slice.resourceTypes,
      },
    }));
  }

  return issues;
}

function getBundleEntrySliceDefinitions(
  structureDef: StructureDefinition | undefined,
): BundleEntrySliceDefinition[] {
  const elements = structureDef?.snapshot?.element;
  if (!elements?.length) return [];

  const slices: BundleEntrySliceDefinition[] = [];
  for (const element of elements) {
    if (element.path !== 'Bundle.entry' || !element.sliceName) continue;
    const resourceElement = elements.find(candidate =>
      candidate.id === `Bundle.entry:${element.sliceName}.resource` &&
      candidate.path === 'Bundle.entry.resource',
    );
    const resourceTypes = new Set<string>();
    const profiles = new Set<string>();
    const types = Array.isArray((resourceElement as any)?.type)
      ? (resourceElement as any).type
      : [];
    for (const type of types) {
      if (typeof type?.code === 'string' && type.code !== 'Resource') {
        resourceTypes.add(type.code);
      }
      const typeProfiles = Array.isArray(type?.profile) ? type.profile : [];
      for (const profile of typeProfiles) {
        if (typeof profile === 'string') profiles.add(profile);
      }
    }

    slices.push({
      sliceName: element.sliceName,
      min: element.min ?? 0,
      max: element.max ?? '*',
      resourceTypes: [...resourceTypes],
      profiles: [...profiles],
    });
  }

  return slices;
}

function childMatchesBundleEntrySliceCandidate(
  child: BundleDocumentContextChildResult,
  slice: BundleEntrySliceDefinition,
): boolean {
  if (slice.resourceTypes.length > 0 && slice.resourceTypes.includes(child.resourceType)) {
    return true;
  }
  const declaredProfiles = getDeclaredProfiles(child.entryResource);
  return slice.profiles.some(profile => declaredProfiles.includes(profile));
}

function getCompositionEntryTargetProfiles(
  structureDef: StructureDefinition | undefined,
  section: Record<string, unknown>,
): string[] | null {
  const elements = structureDef?.snapshot?.element;
  if (!elements?.length) return null;

  const sectionSliceName = findMatchingSectionSliceName(elements, section);
  if (sectionSliceName) {
    const sliceProfiles = collectTargetProfiles(elements, element =>
      element.path === 'Composition.section.entry' &&
      typeof element.id === 'string' &&
      element.id.startsWith(`Composition.section:${sectionSliceName}.entry:`),
    );
    if (sliceProfiles && sliceProfiles.length > 0) return sliceProfiles;

    const sectionEntryProfiles = collectTargetProfiles(elements, element =>
      element.path === 'Composition.section.entry' &&
      element.id === `Composition.section:${sectionSliceName}.entry`,
    );
    if (sectionEntryProfiles && sectionEntryProfiles.length > 0) return sectionEntryProfiles;
  }

  return collectTargetProfiles(elements, element => element.path === 'Composition.section.entry');
}

function collectTargetProfiles(
  elements: NonNullable<StructureDefinition['snapshot']>['element'],
  predicate: (element: NonNullable<StructureDefinition['snapshot']>['element'][number]) => boolean,
): string[] | null {
  const profiles = new Set<string>();
  for (const element of elements) {
    if (!predicate(element)) continue;
    const types = (element as any).type;
    if (!Array.isArray(types)) continue;
    for (const type of types) {
      const targetProfiles = Array.isArray(type?.targetProfile) ? type.targetProfile : [];
      for (const profile of targetProfiles) {
        if (typeof profile === 'string') profiles.add(profile);
      }
    }
  }

  return profiles.size > 0 ? [...profiles] : null;
}

function findMatchingSectionSliceName(
  elements: NonNullable<StructureDefinition['snapshot']>['element'],
  section: Record<string, unknown>,
): string | null {
  for (const element of elements) {
    if (element.path !== 'Composition.section' || !element.sliceName) continue;

    const codeElement = elements.find(candidate =>
      candidate.id === `Composition.section:${element.sliceName}.code` &&
      candidate.path === 'Composition.section.code',
    );
    const expectedCode = getCodeableConceptConstraint(codeElement);
    if (!expectedCode) continue;
    if (codeableConceptMatches(section.code, expectedCode)) return element.sliceName;
  }

  return null;
}

function getCodeableConceptConstraint(element: unknown): unknown {
  if (!element || typeof element !== 'object') return null;
  const record = element as Record<string, unknown>;
  return record.patternCodeableConcept ?? record.fixedCodeableConcept ?? null;
}

function codeableConceptMatches(actual: unknown, expected: unknown): boolean {
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object') {
    return false;
  }

  const expectedRecord = expected as Record<string, unknown>;
  const expectedCodings = Array.isArray(expectedRecord.coding)
    ? expectedRecord.coding.filter(isRecord)
    : [];
  if (expectedCodings.length === 0) return false;

  const actualRecord = actual as Record<string, unknown>;
  const actualCodings = Array.isArray(actualRecord.coding)
    ? actualRecord.coding.filter(isRecord)
    : [];

  return expectedCodings.every(expectedCoding =>
    actualCodings.some(actualCoding => codingMatches(actualCoding, expectedCoding)),
  );
}

function codingMatches(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return stringFieldMatches(actual, expected, 'system') &&
    stringFieldMatches(actual, expected, 'code') &&
    stringFieldMatches(actual, expected, 'display');
}

function stringFieldMatches(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  field: string,
): boolean {
  return typeof expected[field] !== 'string' || actual[field] === expected[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
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
      ? `Slice 'Bundle.entry:composition': a matching slice is required, but not found (from ${source.label})`
      : "Slice 'Bundle.entry:composition': a matching slice is required, but not found",
    ruleId: 'slice-min-composition-conformance',
    severityOverride: 'error',
    aspectOverride: 'profile',
    details: {
      sliceName: 'composition',
      reason: 'composition-entry-target-profile-match-failed',
      sourceProfile: source.profile,
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
    if (!profile || profile === 'http://hl7.org/fhir/StructureDefinition/Bundle') return;
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
