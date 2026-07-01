import { describe, expect, it } from 'vitest';
import { ReferenceTargetValidator } from '../reference-target-validator';
import type { StructureDefinition } from '../../core/structure-definition-types';

// Profile restricting Observation.subject to Reference(Patient).
const observationSubjectPatientProfile: StructureDefinition = {
  resourceType: 'StructureDefinition',
  url: 'http://example.org/StructureDefinition/obs-subject-patient',
  name: 'ObsSubjectPatient',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Observation',
  snapshot: {
    element: [
      { id: 'Observation', path: 'Observation' },
      {
        id: 'Observation.subject',
        path: 'Observation.subject',
        type: [{
          code: 'Reference',
          targetProfile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
        }],
      } as any,
    ],
  },
};

describe('ReferenceTargetValidator', () => {
  it('flags a relative reference of a disallowed target type', () => {
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      { resourceType: 'Observation', subject: { reference: 'Organization/o1' } },
      observationSubjectPatientProfile,
    );
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-target-type-invalid',
      path: 'Observation.subject',
    }));
  });

  it('accepts a relative reference of an allowed target type', () => {
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      { resourceType: 'Observation', subject: { reference: 'Patient/p1' } },
      observationSubjectPatientProfile,
    );
    expect(issues).toHaveLength(0);
  });

  it('flags a contained reference whose target type is disallowed', () => {
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      {
        resourceType: 'Observation',
        contained: [{ resourceType: 'Organization', id: 'org1' }],
        subject: { reference: '#org1' },
      },
      observationSubjectPatientProfile,
    );
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-target-type-invalid',
      path: 'Observation.subject',
      details: expect.objectContaining({ actualTarget: 'Organization' }),
    }));
  });

  it('accepts a contained reference whose target type is allowed', () => {
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      {
        resourceType: 'Observation',
        contained: [{ resourceType: 'Patient', id: 'pat1' }],
        subject: { reference: '#pat1' },
      },
      observationSubjectPatientProfile,
    );
    expect(issues).toHaveLength(0);
  });

  it('flags a urn:uuid reference resolved via the bundle resolver to a disallowed type', () => {
    const validator = new ReferenceTargetValidator();
    const resolve = (ref: string) =>
      ref === 'urn:uuid:org-1' ? { resourceType: 'Organization', id: 'org-1' } : null;
    const issues = validator.validate(
      { resourceType: 'Observation', subject: { reference: 'urn:uuid:org-1' } },
      observationSubjectPatientProfile,
      resolve,
    );
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-target-type-invalid',
      details: expect.objectContaining({ actualTarget: 'Organization' }),
    }));
  });

  it('accepts a urn:uuid reference resolved to an allowed type', () => {
    const validator = new ReferenceTargetValidator();
    const resolve = (ref: string) =>
      ref === 'urn:uuid:pat-1' ? { resourceType: 'Patient', id: 'pat-1' } : null;
    const issues = validator.validate(
      { resourceType: 'Observation', subject: { reference: 'urn:uuid:pat-1' } },
      observationSubjectPatientProfile,
      resolve,
    );
    expect(issues).toHaveLength(0);
  });

  it('does not flag a urn:uuid reference that the resolver cannot resolve (fail open)', () => {
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      { resourceType: 'Observation', subject: { reference: 'urn:uuid:unknown' } },
      observationSubjectPatientProfile,
      () => null,
    );
    expect(issues).toHaveLength(0);
  });

  it('does not flag an unresolvable contained reference (fail open)', () => {
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      {
        resourceType: 'Observation',
        contained: [{ resourceType: 'Patient', id: 'other' }],
        subject: { reference: '#missing' },
      },
      observationSubjectPatientProfile,
    );
    expect(issues).toHaveLength(0);
  });

  it('does not apply sliced targetProfiles to every reference at the base path', () => {
    const validator = new ReferenceTargetValidator();
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/obs-derived-from-sliced',
      name: 'ObsDerivedFromSliced',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Observation',
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation' },
          {
            id: 'Observation.derivedFrom',
            path: 'Observation.derivedFrom',
            type: [{
              code: 'Reference',
              targetProfile: [
                'http://hl7.org/fhir/StructureDefinition/Observation',
                'http://hl7.org/fhir/StructureDefinition/MolecularSequence',
              ],
            }],
          } as any,
          {
            id: 'Observation.derivedFrom:molecular-sequence',
            path: 'Observation.derivedFrom',
            sliceName: 'molecular-sequence',
            type: [{
              code: 'Reference',
              targetProfile: ['http://hl7.org/fhir/StructureDefinition/MolecularSequence'],
            }],
          } as any,
        ],
      },
    };

    const issues = validator.validate(
      {
        resourceType: 'Observation',
        derivedFrom: [{ reference: 'Observation/source-observation' }],
      },
      profile,
    );

    expect(issues).toHaveLength(0);
  });
});
