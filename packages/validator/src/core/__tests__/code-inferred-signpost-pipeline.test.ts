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
const BASE_OBSERVATION_URL = 'http://hl7.org/fhir/StructureDefinition/Observation';

function profile(url: string): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url,
    name: 'Observation',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Observation',
    snapshot: { element: [{ path: 'Observation' }] },
  };
}

function observation(code: string, meta?: Record<string, unknown>): Record<string, unknown> {
  return {
    resourceType: 'Observation',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code }] },
    ...(meta ? { meta } : {}),
  };
}

/** The structural executor reports the bp-imposed minimum only when bp is applied. */
function bpAwareStructuralExecutor() {
  return {
    validate: vi.fn(async (_resource: unknown, context: { structureDef: StructureDefinition }) =>
      context.structureDef.url === BP_PROFILE_URL
        ? [{
          aspect: 'structural',
          severity: 'error',
          code: 'structural-cardinality-min',
          message: 'Observation.category has too few values: expected at least 1',
          path: 'Observation.category',
          timestamp: new Date(),
        } satisfies ValidationIssue]
        : []),
  };
}

function bpAwareProfileExecutor() {
  return {
    validate: vi.fn(async (context: { structureDef: StructureDefinition }) =>
      context.structureDef.url === BP_PROFILE_URL
        ? [{
          aspect: 'profile',
          severity: 'error',
          code: 'profile-slice-count',
          message: 'Slice systolic: minimum 1 occurrence required',
          path: 'Observation.component',
          timestamp: new Date(),
        } satisfies ValidationIssue]
        : []),
  };
}

function pipelineContext(profiles: StructureDefinition[]): RecordsSingleResourceValidationContext {
  const byUrl = new Map(profiles.map(candidate => [candidate.url, candidate]));
  const sdLoader = {
    loadProfile: vi.fn(async (url: string) => byUrl.get(url) ?? null),
    setProfileResolutionContext: vi.fn(),
    getAvailableProfiles: () => [...byUrl.keys()],
  } as unknown as StructureDefinitionLoader;
  const context: RecordsSingleResourceValidationContext = {
    sdLoader,
    profileCache: undefined as never,
    snapshotGenerator: {} as never,
    structuralExecutor: bpAwareStructuralExecutor() as never,
    profileExecutor: bpAwareProfileExecutor() as never,
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
    validateAgainstProfile: (resource, profileUrl, fhirVersion) =>
      executeRecordsResourceValidation({ resource, profileUrl, fhirVersion }, context, Date.now()),
  };
  return context;
}

async function runPipeline(
  resource: Record<string, unknown>,
  profiles: StructureDefinition[],
): Promise<ValidationIssue[]> {
  return executeRecordsResourceValidation(
    { resource, fhirVersion: 'R4' },
    pipelineContext(profiles),
    Date.now(),
  );
}

describe('code-inferred profile signpost and attribution (single-resource pipeline)', () => {
  it('applies the mandated profile beside a different declared profile', async () => {
    const declared = 'urn:declared-observation';
    const issues = await runPipeline(observation('8480-6', { profile: [declared] }),
      [profile(declared), profile(BP_PROFILE_URL)]);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'structural-cardinality-min', profile: BP_PROFILE_URL }),
      expect.objectContaining({ code: 'profile-slice-count', profile: BP_PROFILE_URL }),
    ]));
  });

  it('propagates a failed mandated-profile pass to the validation error boundary', async () => {
    const declared = 'urn:declared-observation';
    const context = pipelineContext([profile(declared)]);
    const failure = new Error('profile evaluator failed');
    context.validateAgainstProfile = async () => { throw failure; };

    await expect(executeRecordsResourceValidation({
      resource: observation('8480-6', { profile: [declared] }), fhirVersion: 'R4',
    }, context, Date.now())).rejects.toBe(failure);
  });

  it('signposts bp for a systolic 8480-6 Observation and attributes its errors to the profile aspect', async () => {
    const issues = await runPipeline(observation('8480-6'), [profile(BP_PROFILE_URL)]);

    const signposts = issues.filter(issue => issue.code === CODE_INFERRED_SIGNPOST_CODE);
    expect(signposts).toHaveLength(1);
    expect(signposts[0].severity).toBe('info');
    expect(signposts[0].message).toContain(BP_PROFILE_URL);
    expect(signposts[0].message).toContain('the LOINC code 8480-6 was found');

    const cardinality = issues.find(issue => issue.code === 'structural-cardinality-min');
    expect(cardinality).toMatchObject({
      aspect: 'profile',
      severity: 'error',
      profile: BP_PROFILE_URL,
      details: expect.objectContaining({ profileSource: 'code-inferred' }),
    });

    const slice = issues.find(issue => issue.code === 'profile-slice-count');
    expect(slice).toMatchObject({
      aspect: 'profile',
      profile: BP_PROFILE_URL,
      details: expect.objectContaining({ profileSource: 'code-inferred' }),
    });
  });

  it('does not signpost or apply bp for the diastolic-only 8462-4 Observation', async () => {
    // Deliberate upstream parity: 8462-4 is absent from the reference
    // validator's implied-profiles table, so base Observation applies.
    const issues = await runPipeline(
      observation('8462-4'),
      [profile(BASE_OBSERVATION_URL), profile(BP_PROFILE_URL)],
    );

    expect(issues.filter(issue => issue.code === CODE_INFERRED_SIGNPOST_CODE)).toHaveLength(0);
    expect(issues.filter(issue => issue.code === 'structural-cardinality-min')).toHaveLength(0);
    expect(issues.filter(issue => issue.code === 'profile-slice-count')).toHaveLength(0);
  });

  it('does not signpost a resource that declares its profile in meta.profile', async () => {
    const issues = await runPipeline(
      observation('8480-6', { profile: [BP_PROFILE_URL] }),
      [profile(BP_PROFILE_URL)],
    );

    expect(issues.filter(issue => issue.code === CODE_INFERRED_SIGNPOST_CODE)).toHaveLength(0);
    // The bp findings still fire — only the code-inference signpost is absent.
    expect(issues.some(issue => issue.code === 'structural-cardinality-min')).toBe(true);
  });
});
