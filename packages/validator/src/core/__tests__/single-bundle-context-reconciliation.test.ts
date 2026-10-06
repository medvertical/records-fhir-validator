import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from '../structure-definition-types';
import type { AspectResult, ValidateOneFn } from '../multi-aspect-types';
import { appendBundleEntryValidationResults } from '../multi-aspect-bundle-entry-validation';
import { validateBundleEntryResources, type BundleEntryValidationDeps } from '../validator-bundle-entry-validation';
import { executeRecordsResourceValidation, type RecordsSingleResourceValidationContext } from '../validator-single-resource-pipeline';

const bundleProfile = 'https://example.test/StructureDefinition/Document';
const compositionProfile = 'https://example.test/StructureDefinition/Composition';
const conditionProfile = 'https://example.test/StructureDefinition/Condition';

function definition(url: string, type: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url, type, snapshot: { element: [{ path: type }] } };
}
function minimum(sliceName: string): ValidationIssue {
  return { aspect: 'profile', severity: 'error', code: 'profile-slice-min-cardinality',
    path: 'Bundle.entry', message: `Missing ${sliceName} slice`, details: { sliceName } };
}
const unknown: ValidationIssue = { aspect: 'profile', severity: 'information', code: 'profile-reference-unavailable',
  path: 'Bundle.meta.profile', message: 'Independent profile dependency unavailable',
  details: { validationComplete: false, validationStatus: 'incomplete', cause: 'dependency-missing' } };
const missingStatus: ValidationIssue = { aspect: 'structural', severity: 'error', code: 'structural-cardinality-min',
  path: 'Condition.clinicalStatus', message: 'Missing clinical status' };
const nestedContext: ValidationIssue = { aspect: 'profile', severity: 'error', code: 'profile-slice-min-cardinality',
  ruleId: 'slice-min-composition-conformance', path: 'Bundle', message: 'Nested Composition is not conformant',
  details: { sliceName: 'composition' } };

function fixture(mode: 'invalid' | 'unknown' | 'nested') {
  const condition = { resourceType: 'Condition', id: 'condition', meta: { profile: [conditionProfile] } };
  const composition = { resourceType: 'Composition', id: 'composition', meta: { profile: [compositionProfile] },
    section: [{ entry: [{ reference: 'Condition/condition' }] }] };
  const bundle = { resourceType: 'Bundle', type: 'document', meta: { profile: [bundleProfile] }, entry: mode === 'nested'
    ? [{ resource: { resourceType: 'Bundle', id: 'nested', type: 'document' } }]
    : [{ resource: composition }, { resource: condition }] };
  const compositionDefinition = definition(compositionProfile, 'Composition');
  compositionDefinition.snapshot!.element.push({ path: 'Composition.section.entry',
    type: [{ code: 'Reference', targetProfile: [conditionProfile] }] });
  const definitions = new Map([
    [bundleProfile, definition(bundleProfile, 'Bundle')],
    [compositionProfile, compositionDefinition],
    [conditionProfile, definition(conditionProfile, 'Condition')],
    ['http://hl7.org/fhir/StructureDefinition/Bundle', definition('http://hl7.org/fhir/StructureDefinition/Bundle', 'Bundle')],
  ]);
  const childIssues = (resourceType: string): ValidationIssue[] => resourceType === 'Bundle' ? [nestedContext]
    : resourceType !== 'Condition' ? [] : mode === 'invalid' ? [missingStatus]
    : [{ ...unknown, path: 'Condition.meta.profile' }];
  const sdLoader = { loadProfile: vi.fn(async (url: string) => definitions.get(url) ?? null),
    setProfileResolutionContext: vi.fn(), getAvailableProfiles: () => [...definitions.keys()] };
  const parentIssues = [minimum('composition'), minimum('patient'), unknown];
  const empty = { validate: async () => [] };
  const entryDependencies = { sdLoader, profileCache: undefined, snapshotGenerator: {}, maxDepth: 0,
    structuralExecutor: { validateResourceIdAndArrays: () => [] },
    validateResource: async (resource: { resourceType: string }) => childIssues(resource.resourceType),
    validateNestedBundleEntries: async () => [] } as unknown as BundleEntryValidationDeps;
  const context = { sdLoader, profileCache: undefined, snapshotGenerator: {}, strictMode: false,
    structuralExecutor: empty, profileExecutor: { validate: async () => parentIssues },
    terminologyExecutor: empty, invariantExecutor: empty, customRuleExecutor: empty, metadataExecutor: empty,
    referenceExecutor: empty, bestPracticeValidator: { validate: () => [] }, terminologyResourceValidator: { validate: () => [] },
    validateBundleEntriesIfNeeded: (resource, version) => validateBundleEntryResources(resource, version, 0, entryDependencies),
    validateContainedResourcesIfNeeded: async () => [], validateParametersResourcesIfNeeded: async () => [],
    validateAgainstProfile: async () => [] } as RecordsSingleResourceValidationContext;
  const validateOne: ValidateOneFn = async (resource, profileUrl) => {
    const resourceType = (resource as { resourceType: string }).resourceType;
    const issues = childIssues(resourceType);
    return { isValid: !issues.some(issue => issue.severity === 'error'), structureDef: definitions.get(profileUrl),
      aspects: [{ aspect: 'profile', issues, evidenceIssues: issues, validationTime: 0,
        isValid: !issues.some(issue => issue.severity === 'error') }] };
  };
  return { bundle, context, parentIssues, validateOne, definitions };
}

async function validateBoth(mode: 'invalid' | 'unknown' | 'nested') {
  const fixtureInputs = fixture(mode);
  const single = await executeRecordsResourceValidation({ resource: fixtureInputs.bundle, profileUrl: bundleProfile,
    fhirVersion: 'R4' }, fixtureInputs.context, Date.now());
  const aspects: AspectResult[] = [{ aspect: 'profile', issues: [...fixtureInputs.parentIssues],
    evidenceIssues: [...fixtureInputs.parentIssues], validationTime: 0, isValid: false }];
  await appendBundleEntryValidationResults(fixtureInputs.bundle, 'R4', 0, fixtureInputs.validateOne, aspects,
    fixtureInputs.definitions.get(bundleProfile), issues => ({ resultIssues: issues, evidenceIssues: issues }));
  return { single, multi: aspects.flatMap(aspect => aspect.issues), evidence: aspects.flatMap(aspect => aspect.evidenceIssues ?? []) };
}
const identities = (issues: ValidationIssue[]) => issues.map(issue =>
  [issue.code, issue.ruleId ?? '', issue.severity, issue.path, issue.message].join('|')).sort();

function expectIndependentFindings(issues: ValidationIssue[]) {
  expect(issues).toContainEqual(expect.objectContaining(minimum('patient')));
  expect(issues).toContainEqual(expect.objectContaining(unknown));
}

describe('single and multi Bundle document-context reconciliation', () => {
  it('returns the causal Composition minimum once while retaining the child defect, another slice and Unknown', async () => {
    const { single, multi, evidence } = await validateBoth('invalid');
    expect(identities(single)).toEqual(identities(multi));
    for (const issues of [single, multi, evidence]) {
      expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality' && issue.path === 'Bundle.entry'
        && issue.details?.sliceName === 'composition')).toEqual([]);
      expect(issues.filter(issue => issue.ruleId === 'slice-min-composition-conformance')).toHaveLength(1);
      expect(issues).toContainEqual(expect.objectContaining({ ruleId: 'profile-targetprofile-match-failed',
        details: expect.objectContaining({ causeIssueCodes: ['structural-cardinality-min'] }) }));
      expect(issues).toContainEqual(expect.objectContaining({ code: missingStatus.code, path: expect.stringContaining('Condition/condition') }));
      expectIndependentFindings(issues);
    }
  });

  it('retains the minimum when an unverified child supplies no causal document-context finding', async () => {
    const { single, multi } = await validateBoth('unknown');
    expect(identities(single)).toEqual(identities(multi));
    for (const issues of [single, multi]) {
      expect(issues).toContainEqual(expect.objectContaining(minimum('composition')));
      expect(issues.some(issue => issue.ruleId === 'slice-min-composition-conformance')).toBe(false);
      expect(issues.filter(issue => issue.code === unknown.code)).toHaveLength(2);
      expectIndependentFindings(issues);
    }
  });

  it('does not let a nested Bundle context replace the independent outer Composition minimum', async () => {
    const { single, multi } = await validateBoth('nested');
    expect(identities(single)).toEqual(identities(multi));
    for (const issues of [single, multi]) {
      expect(issues).toContainEqual(expect.objectContaining(minimum('composition')));
      expect(issues).toContainEqual(expect.objectContaining({ ruleId: nestedContext.ruleId,
        path: expect.stringContaining('Bundle/nested') }));
      expectIndependentFindings(issues);
    }
  });
});
