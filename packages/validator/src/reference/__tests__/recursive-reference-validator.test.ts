import { describe, expect, it } from 'vitest';
import { RecursiveReferenceValidator } from '../recursive-reference-validator';

describe('RecursiveReferenceValidator', () => {
  it('resolves Bundle-internal urn:uuid references before reporting unresolved references', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'urn:uuid:composition-1',
          resource: {
            resourceType: 'Composition',
            id: 'composition-1',
            status: 'final',
            subject: { reference: 'urn:uuid:patient-1' },
          },
        },
        {
          fullUrl: 'urn:uuid:patient-1',
          resource: {
            resourceType: 'Patient',
            id: 'patient-1',
          },
        },
      ],
    };

    const result = await new RecursiveReferenceValidator().validateRecursively(bundle, {
      enabled: true,
      maxDepth: 2,
      maxReferencesPerResource: 10,
    });

    expect(result.unresolvedReferences).toEqual([]);
    expect(result.referencesFollowed).toBeGreaterThan(0);
  });

  it('resolves Bundle-internal relative references before reporting unresolved references', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'urn:uuid:composition-1',
          resource: {
            resourceType: 'Composition',
            id: 'composition-1',
            status: 'final',
            subject: { reference: 'Patient/patient-1' },
          },
        },
        {
          fullUrl: 'urn:uuid:patient-1',
          resource: {
            resourceType: 'Patient',
            id: 'patient-1',
          },
        },
      ],
    };

    const result = await new RecursiveReferenceValidator().validateRecursively(bundle, {
      enabled: true,
      maxDepth: 2,
      maxReferencesPerResource: 10,
    });

    expect(result.unresolvedReferences).toEqual([]);
    expect(result.referencesFollowed).toBeGreaterThan(0);
  });
});
