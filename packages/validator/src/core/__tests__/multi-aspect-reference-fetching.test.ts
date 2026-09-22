import { describe, expect, it, vi } from 'vitest';
import type { MultiAspectDeps } from '../multi-aspect-dependencies';
import { buildMultiAspectValidateCallback } from '../multi-aspect-validate-callback';
import { ReferenceExecutor } from '../executors/reference-executor';

vi.mock('../profile-loader-utils', () => ({
  loadProfileOrBase: vi.fn(async (_loader, _generator, profileUrl, resourceType) => ({
    structureDef: { resourceType: 'StructureDefinition', type: resourceType,
      url: profileUrl, snapshot: { element: [] } },
    declaredProfileUrl: profileUrl, usedBaseFallback: false,
  })),
  createProfileFallbackIssue: vi.fn(), createProfileResourceTypeMismatchIssue: vi.fn(),
}));

function createSession(getResource: ReturnType<typeof vi.fn>, resolver?: (reference: string) => unknown) {
  const unused = { validate: async () => [] };
  const deps = {
    sdLoader: {}, snapshotGenerator: {}, fhirClient: { getResource },
    referenceExecutor: new ReferenceExecutor(), structuralExecutor: unused, profileExecutor: unused,
    terminologyExecutor: unused, invariantExecutor: unused, customRuleExecutor: unused, metadataExecutor: unused,
    bestPracticeValidator: { validate: () => [] }, terminologyResourceValidator: { validate: () => [] },
    strictMode: false,
  } as unknown as MultiAspectDeps;
  return buildMultiAspectValidateCallback(deps, ['reference'], {
    validationStrictness: 'standard', aspects: {},
    recursiveReferenceValidation: { enabled: true, maxDepth: 2, validateExternal: true },
  }, 1, undefined, undefined, resolver, 1);
}

const profile = 'http://hl7.org/fhir/StructureDefinition/Observation';
const observation = (id: string) => ({ resourceType: 'Observation', id, subject: { reference: 'Patient/synthetic' } });

describe('batch recursive reference reuse', () => {
  it('uses prefetched targets at every recursion depth without source reads', async () => {
    const getResource = vi.fn().mockRejectedValue(new Error('must use the prefetched index'));
    const targets: Record<string, unknown> = {
      'Patient/synthetic': { resourceType: 'Patient', id: 'synthetic', managingOrganization: { reference: 'Organization/synthetic' } },
      'Organization/synthetic': { resourceType: 'Organization', id: 'synthetic' },
    };
    const validate = createSession(getResource, reference => targets[reference] ?? null);
    const result = await validate(observation('one'), profile, 'R4');
    expect(result.aspects.flatMap(aspect => aspect.issues)).toEqual([]);
    expect(getResource).not.toHaveBeenCalled();
  });

  it('shares uncached targets across resources and keeps sessions isolated', async () => {
    const getResource = vi.fn().mockResolvedValue({ resourceType: 'Patient', id: 'synthetic' });
    const validate = createSession(getResource);
    const results = await Promise.all(Array.from({ length: 100 }, (_, index) =>
      validate(observation(`synthetic-${index}`), profile, 'R4')));
    expect(results.flatMap(result => result.aspects.flatMap(aspect => aspect.issues))).toEqual([]);
    await validate(observation('four'), profile, 'R4');
    expect(getResource).toHaveBeenCalledTimes(1);
    await createSession(getResource)(observation('five'), profile, 'R4');
    expect(getResource).toHaveBeenCalledTimes(2);
  });
});
