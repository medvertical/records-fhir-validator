import { describe, expect, it, vi } from 'vitest';
import type { MultiAspectDeps } from '../multi-aspect-dependencies';
import { buildMultiAspectValidateCallback } from '../multi-aspect-validate-callback';
import { ReferenceExecutor } from '../executors/reference-executor';

vi.mock('../profile-loader-utils', () => ({
  loadProfileOrBase: vi.fn(async (_loader, _generator, profileUrl, resourceType) => ({
    structureDef: {
      resourceType: 'StructureDefinition', type: resourceType,
      url: profileUrl, snapshot: { element: [] },
    },
    declaredProfileUrl: profileUrl,
    usedBaseFallback: false,
  })),
  createProfileFallbackIssue: vi.fn(),
  createProfileResourceTypeMismatchIssue: vi.fn(),
}));

describe('Bundle contained references through multi-aspect validation', () => {
  it('reports each missing reference once with the affected entry identity', async () => {
    const unused = { validate: async () => [] };
    const dependencies = {
      sdLoader: {}, snapshotGenerator: {},
      referenceExecutor: new ReferenceExecutor(),
      structuralExecutor: unused, profileExecutor: unused,
      terminologyExecutor: unused, invariantExecutor: unused,
      customRuleExecutor: unused, metadataExecutor: unused,
      bestPracticeValidator: { validate: () => [] },
      terminologyResourceValidator: { validate: () => [] },
      strictMode: false,
    } as unknown as MultiAspectDeps;
    const validate = buildMultiAspectValidateCallback(dependencies, ['reference'], {
      validationStrictness: 'standard', aspects: {},
    });
    const result = await validate({
      resourceType: 'Bundle', type: 'collection',
      entry: [{
        resource: {
          resourceType: 'Observation', id: 'missing-subject',
          meta: { profile: ['https://example.test/Observation'] },
          subject: { reference: '#patient' },
        },
      }, {
        resource: {
          resourceType: 'Observation', id: 'valid-subject',
          subject: { reference: '#patient' },
          contained: [{ resourceType: 'Patient', id: 'patient' }],
        },
      }],
    }, 'http://hl7.org/fhir/StructureDefinition/Bundle', 'R4');
    const ref1 = result.aspects.flatMap(aspect => aspect.issues)
      .filter(issue => issue.code === 'reference-ref1-invariant');
    expect(ref1).toHaveLength(1);
    expect(ref1[0].path).toBe('Bundle.entry[0].resource/*Observation/missing-subject*/.subject');
    expect(ref1[0].details).toMatchObject({ containedId: 'patient' });
  });
});
