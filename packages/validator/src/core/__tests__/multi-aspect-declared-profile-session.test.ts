import { describe, expect, it, vi } from 'vitest';
import { createDefaultValidationSettings } from '@records-fhir/validation-types';
import { validateRecordsAspects, type RecordsBatchValidationContext } from '../validator-batch-validation.js';

const loadProfile = vi.hoisted(() => vi.fn(async (_loader, _generator, profileUrl: string, resourceType: string) => ({
  structureDef: { resourceType: 'StructureDefinition', type: resourceType, url: profileUrl, snapshot: { element: [] } },
  declaredProfileUrl: profileUrl, usedBaseFallback: false,
})));
vi.mock('../profile-loader-utils', () => ({
  loadProfileOrBase: loadProfile,
  loadProfileWithSnapshot: vi.fn(async () => undefined),
  createProfileFallbackIssue: vi.fn(), createProfileResourceTypeMismatchIssue: vi.fn(),
}));

const profiles = ['https://example.test/mii-report', 'https://example.test/genomic-report'];
const resource = { resourceType: 'DiagnosticReport', id: 'synthetic-report', meta: { profile: profiles } };
const aspects = ['structural', 'profile', 'terminology', 'reference', 'invariant', 'custom_rule', 'metadata'] as const;

function context() {
  const empty = { validate: vi.fn(async () => []) };
  const structural = vi.fn(async (_resource: unknown, input: { profileUrl: string }) => input.profileUrl === profiles[1]
    ? [{ aspect: 'structural', severity: 'error', code: 'structural-cardinality-min',
      message: 'Additional profile requires result', path: 'DiagnosticReport.result' }] : []);
  return { structural, runtime: {
    sdLoader: { setProfileResolutionContext: vi.fn() }, snapshotGenerator: {}, strictMode: false,
    structuralExecutor: { validate: structural }, profileExecutor: empty, terminologyExecutor: empty,
    referenceExecutor: empty, invariantExecutor: empty, customRuleExecutor: empty, metadataExecutor: empty,
    bestPracticeValidator: { validate: () => [] }, terminologyResourceValidator: { validate: () => [] },
  } as unknown as RecordsBatchValidationContext };
}

describe('declared profiles share one direct semantic session', () => {
  it('loads each profile once for all seven aspects and retains the additional-profile failure', async () => {
    loadProfile.mockClear();
    const { runtime, structural } = context();
    const onResourceValidated = vi.fn();
    const result = await validateRecordsAspects(resource, {
      aspects: [...aspects], settings: createDefaultValidationSettings('R4'),
      organizationId: 7, serverId: 8, profileSources: ['resource-meta'], onResourceValidated,
    }, runtime);

    expect(loadProfile.mock.calls.map(call => call[2])).toEqual(profiles);
    expect(structural.mock.calls.map(([, input]) => input.profileUrl)).toEqual(profiles);
    expect(result.isValid).toBe(false);
    expect(new Set(result.aspects.map(aspect => aspect.aspect))).toEqual(new Set(aspects));
    expect(result.aspects.flatMap(aspect => aspect.issues)).toEqual([
      expect.objectContaining({ profile: profiles[1], code: 'structural-cardinality-min' }),
    ]);
    expect(onResourceValidated).toHaveBeenCalledOnce();
  });

  it('keeps an explicitly selected basis separate from declarations', async () => {
    loadProfile.mockClear();
    const { runtime, structural } = context();
    const result = await validateRecordsAspects(resource, {
      aspects: [...aspects], settings: createDefaultValidationSettings('R4'), profileUrl: profiles[0],
    }, runtime);
    expect(loadProfile.mock.calls.map(call => call[2])).toEqual([profiles[0]]);
    expect(structural).toHaveBeenCalledOnce();
    expect(result.isValid).toBe(true);
  });
});
