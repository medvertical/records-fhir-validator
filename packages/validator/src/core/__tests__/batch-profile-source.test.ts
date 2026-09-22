import { describe, expect, it, vi } from 'vitest';
import { createDefaultValidationSettings } from '@records-fhir/validation-types';
import { validateRecordsAspects, validateRecordsBatch, type RecordsBatchValidationContext } from '../validator-batch-validation';
import type { MultiAspectValidateResult } from '../multi-aspect-types';

const profileUrl = 'http://hl7.org/fhir/StructureDefinition/bp';
const resource = {
  resourceType: 'Observation',
  code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
  meta: { profile: [profileUrl] },
};

function context(): RecordsBatchValidationContext {
  const structureDef = {
    resourceType: 'StructureDefinition', url: profileUrl, type: 'Observation',
    snapshot: { element: [{ path: 'Observation' }] },
  };
  return {
    sdLoader: {
      loadProfile: vi.fn(async () => structureDef),
      loadProfilesBatch: vi.fn(async () => new Map([[profileUrl, structureDef]])),
      setProfileResolutionContext: vi.fn(),
    },
    profileCache: { get: vi.fn(), set: vi.fn() },
    snapshotGenerator: {},
    structuralExecutor: { validate: vi.fn(async () => [{
      aspect: 'structural', severity: 'error', code: 'structural-cardinality-min',
      message: 'Required category', path: 'Observation.category',
    }]) },
    profileExecutor: { validate: vi.fn(async () => []) },
    terminologyExecutor: { validate: vi.fn(async () => []) },
    referenceExecutor: { validate: vi.fn(async () => []) },
    invariantExecutor: { validate: vi.fn(async () => []) },
    metadataExecutor: { validate: vi.fn(async () => []) },
    customRuleExecutor: { validate: vi.fn(async () => []) },
    terminologyResourceValidator: { validate: vi.fn(() => []) },
    bestPracticeValidator: { validate: vi.fn(() => []) },
    strictMode: false,
  } as unknown as RecordsBatchValidationContext;
}

const options = {
  fhirVersion: 'R4' as const,
  aspects: ['structural', 'profile'] as Array<'structural' | 'profile'>,
  settings: createDefaultValidationSettings('R4'),
};

describe('materialized profile provenance', () => {
  it('preserves inferred and declared attribution for identical batch payloads', async () => {
    const declared = structuredClone(resource);
    const results = await validateRecordsBatch([resource, declared], {
      ...options, profileSources: ['code-inferred', 'resource-meta'],
    }, context()) as Map<unknown, MultiAspectValidateResult>;

    const inferredIssues = results.get(resource)!.aspects.flatMap(aspect => aspect.issues);
    const declaredIssues = results.get(declared)!.aspects.flatMap(aspect => aspect.issues);
    expect(inferredIssues).toContainEqual(expect.objectContaining({
      code: 'profile-code-inferred-signpost',
      details: expect.objectContaining({ profileSource: 'code-inferred' }),
    }));
    expect(inferredIssues).toContainEqual(expect.objectContaining({
      code: 'structural-cardinality-min', aspect: 'profile',
    }));
    expect(declaredIssues.some(issue => issue.code === 'profile-code-inferred-signpost')).toBe(false);
  });

  it.each(['code-inferred', 'explicit-run'] as const)('retains %s selection in direct aspect validation', async source => {
    const result = await validateRecordsAspects(resource, {
      ...options, profileUrl, profileSources: [source],
    }, context());
    const signposts = result.aspects.flatMap(aspect => aspect.issues)
      .filter(issue => issue.code === 'profile-code-inferred-signpost');
    expect(signposts).toHaveLength(source === 'code-inferred' ? 1 : 0);
  });
});
