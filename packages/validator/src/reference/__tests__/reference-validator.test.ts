import { describe, expect, it } from 'vitest';
import { ReferenceValidator } from '../reference-validator-refactored';

describe('ReferenceValidator', () => {
  it('keeps the source path on recursive unresolved reference issues', async () => {
    const validator = new ReferenceValidator();
    const issues = await validator.validateInternal(
      {
        resourceType: 'Observation',
        id: 'obs-1',
        subject: { reference: 'Patient/missing' },
      },
      'Observation',
      'R4',
      {
        recursiveReferenceValidation: {
          enabled: true,
          maxDepth: 2,
          validateExternal: true,
          maxReferencesPerResource: 10,
        },
      } as any,
    );

    const unresolved = issues.find(issue => issue.code === 'reference-unresolved');

    expect(unresolved).toMatchObject({
      path: 'Observation.subject',
      details: {
        reference: 'Patient/missing',
        referencePath: 'Observation.subject',
      },
    });
  });

  it('does not report standalone relative references as unresolved when external validation is disabled', async () => {
    const validator = new ReferenceValidator();
    const issues = await validator.validateInternal(
      {
        resourceType: 'Observation',
        id: 'obs-1',
        subject: { reference: 'Patient/existing-or-not-checked' },
      },
      'Observation',
      'R4',
      {
        recursiveReferenceValidation: {
          enabled: true,
          maxDepth: 2,
          validateExternal: false,
          maxReferencesPerResource: 10,
        },
      } as any,
    );

    expect(issues.some(issue => issue.code === 'reference-unresolved')).toBe(false);
  });

  it('uses the FHIR client fetcher for external recursive reference validation', async () => {
    const validator = new ReferenceValidator();
    const fhirClient = {
      getResource: async (resourceType: string, id: string) => ({ resourceType, id }),
    };

    const issues = await validator.validateInternal(
      {
        resourceType: 'Observation',
        id: 'obs-1',
        subject: { reference: 'Patient/patient-1' },
      },
      'Observation',
      fhirClient,
      'R4',
      {
        recursiveReferenceValidation: {
          enabled: true,
          maxDepth: 2,
          validateExternal: true,
          maxReferencesPerResource: 10,
        },
      } as any,
    );

    expect(issues.some(issue => issue.code === 'reference-unresolved')).toBe(false);
  });
});
