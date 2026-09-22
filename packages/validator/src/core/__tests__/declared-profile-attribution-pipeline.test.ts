import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { CODE_INFERRED_SIGNPOST_CODE } from '../code-inferred-profile-attribution';
import type { StructureDefinitionLoader } from '../structure-definition-loader';
import type { StructureDefinition } from '../structure-definition-types';
import {
  executeRecordsResourceValidation,
  type RecordsSingleResourceValidationContext,
} from '../validator-single-resource-pipeline';

const BP_PROFILE_URL = 'http://hl7.org/fhir/StructureDefinition/bp';

function bpProfile(): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: BP_PROFILE_URL,
    name: 'Bp',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Observation',
    snapshot: {
      element: [
        { path: 'Observation' },
        { path: 'Observation.status', min: 1, max: '1', base: { path: 'Observation.status', min: 1, max: '1' } },
        { path: 'Observation.category', min: 1, max: '*', base: { path: 'Observation.category', min: 0, max: '*' } },
      ],
    },
  };
}

function structuralMinIssue(path: string): ValidationIssue {
  return {
    aspect: 'structural',
    severity: 'error',
    code: 'structural-cardinality-min',
    message: `${path} has too few values: expected at least 1`,
    path,
    timestamp: new Date(),
  };
}

function pipelineContext(): RecordsSingleResourceValidationContext {
  const sdLoader = {
    loadProfile: vi.fn(async (url: string) => (url === BP_PROFILE_URL ? bpProfile() : null)),
    setProfileResolutionContext: vi.fn(),
    getAvailableProfiles: () => [BP_PROFILE_URL],
  } as unknown as StructureDefinitionLoader;
  return {
    sdLoader,
    profileCache: undefined as never,
    snapshotGenerator: {} as never,
    structuralExecutor: {
      validate: vi.fn(async () => [
        structuralMinIssue('Observation.category'),
        structuralMinIssue('Observation.status'),
      ]),
    } as never,
    profileExecutor: { validate: vi.fn(async () => []) } as never,
    terminologyExecutor: { validate: vi.fn(async () => []) } as never,
    invariantExecutor: { validate: vi.fn(async () => []) } as never,
    customRuleExecutor: { validate: vi.fn(async () => []) } as never,
    metadataExecutor: { validate: vi.fn(async () => []) } as never,
    referenceExecutor: { validate: vi.fn(async () => []) } as never,
    bestPracticeValidator: { validate: vi.fn(() => []) } as never,
    terminologyResourceValidator: { validate: vi.fn(() => []) } as never,
    strictMode: false,
    validateBundleEntriesIfNeeded: vi.fn(async () => []),
    validateContainedResourcesIfNeeded: vi.fn(async () => []),
    validateParametersResourcesIfNeeded: vi.fn(async () => []),
    validateAgainstProfile: vi.fn(async () => []),
  };
}

describe('declared profile attribution (single-resource pipeline)', () => {
  it('re-homes the profile-imposed minimum but keeps the base-spec violation structural', async () => {
    const issues = await executeRecordsResourceValidation(
      {
        resource: {
          resourceType: 'Observation',
          meta: { profile: [BP_PROFILE_URL] },
          code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
        },
        fhirVersion: 'R4',
      },
      pipelineContext(),
      Date.now(),
    );

    const categoryMinimum = issues.find(issue => issue.path === 'Observation.category');
    expect(categoryMinimum).toMatchObject({
      aspect: 'profile',
      severity: 'error',
      code: 'structural-cardinality-min',
      profile: BP_PROFILE_URL,
      details: expect.objectContaining({
        profileSource: 'declared',
        declaredProfileUrl: BP_PROFILE_URL,
      }),
    });

    const statusMinimum = issues.find(issue => issue.path === 'Observation.status');
    expect(statusMinimum).toMatchObject({
      aspect: 'structural',
      code: 'structural-cardinality-min',
    });
    expect(statusMinimum?.details ?? {}).not.toMatchObject({ profileSource: 'declared' });

    // The user declared the profile — no code-inference signpost fires.
    expect(issues.filter(issue => issue.code === CODE_INFERRED_SIGNPOST_CODE)).toHaveLength(0);
  });
});
