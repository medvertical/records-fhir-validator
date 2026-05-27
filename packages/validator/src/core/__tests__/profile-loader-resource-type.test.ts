import { describe, expect, it, vi } from 'vitest';
import {
  createProfileResourceTypeMismatchIssue,
  loadProfileOrBase,
} from '../profile-loader-utils';

describe('profile resource type compatibility', () => {
  it('falls back to the resource base profile when a declared profile targets another resource type', async () => {
    const patientProfile = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
      type: 'Patient',
      snapshot: { element: [{ path: 'Patient' }] },
    };
    const practitionerBase = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/Practitioner',
      type: 'Practitioner',
      snapshot: { element: [{ path: 'Practitioner' }] },
    };
    const sdLoader = {
      loadProfile: vi.fn(async (url: string) => {
        if (url === patientProfile.url) return patientProfile;
        if (url === practitionerBase.url) return practitionerBase;
        return null;
      }),
    };

    const result = await loadProfileOrBase(
      sdLoader as any,
      {} as any,
      patientProfile.url,
      'Practitioner',
      'R4',
    );

    expect(result.structureDef).toBe(practitionerBase);
    expect(result.usedBaseFallback).toBe(true);
    expect(result.incompatibleProfileType).toBe('Patient');
  });

  it('emits one clear mismatch issue instead of profile-driven structural noise', () => {
    const issue = createProfileResourceTypeMismatchIssue(
      'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
      'Practitioner',
      'Patient',
    );

    expect(issue).toMatchObject({
      aspect: 'structural',
      severity: 'error',
      code: 'structural-resource-type-mismatch',
      path: 'meta.profile',
      details: {
        profileResourceType: 'Patient',
        resourceType: 'Practitioner',
      },
    });
    expect(issue.message).toContain('validated against base Practitioner instead');
  });
});
