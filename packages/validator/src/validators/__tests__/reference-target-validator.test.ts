import { describe, expect, it } from 'vitest';
import { ReferenceTargetValidator } from '../reference-target-validator';
import type { StructureDefinition } from '../../core/structure-definition-types';
import { dedupeIssues } from '../../core/validation-utils';

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
      aspect: 'reference',
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

  it('treats an absolute URL whose tail is not a resource type as opaque (fail open)', () => {
    // hrex PractitionerRole-full: "EndPoint" is not a FHIR type, so the URL
    // is an identity URL, not a typed RESTful reference.
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      { resourceType: 'Observation', subject: { reference: 'http://example.org/some-clinic/EndPoint/1' } },
      observationSubjectPatientProfile,
    );
    expect(issues).toHaveLength(0);
  });

  it('still flags an absolute RESTful URL of a disallowed target type', () => {
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      { resourceType: 'Observation', subject: { reference: 'http://example.org/fhir/Organization/o1' } },
      observationSubjectPatientProfile,
    );
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-target-type-invalid',
      path: 'Observation.subject',
    }));
  });

  it('flags a disallowed target behind a Reference choice element', () => {
    const validator = new ReferenceTargetValidator();
    const profile: StructureDefinition = {
      ...observationSubjectPatientProfile,
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation' },
          {
            id: 'Observation.note.author[x]',
            path: 'Observation.note.author[x]',
            type: [{
              code: 'Reference',
              targetProfile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
            }],
          } as any,
        ],
      },
    };
    const issues = validator.validate(
      {
        resourceType: 'Observation',
        note: [{ authorReference: { reference: 'Organization/o1' } }],
      },
      profile,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-target-type-invalid',
      path: 'Observation.note[0].authorReference',
    }));
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

  it('rejects a case-mismatched Reference.type even when the reference resolves to an allowed target', () => {
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      {
        resourceType: 'Observation',
        subject: {
          reference: 'urn:uuid:pat-1',
          type: 'patient',
        },
      },
      observationSubjectPatientProfile,
      () => ({ resourceType: 'Patient', id: 'pat-1' }),
    );

    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'reference-target-type-invalid',
      path: 'Observation.subject',
      details: expect.objectContaining({
        actualTarget: 'Patient',
        declaredTargetType: 'patient',
      }),
    }));
    expect(dedupeIssues(issues)).toHaveLength(2);
    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'reference-target-type-invalid',
      path: 'Observation.subject',
      details: expect.objectContaining({
        actualTarget: 'patient',
        allowedTargets: ['Patient'],
        reason: 'declared-type-not-allowed',
      }),
    }));
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

  it('does not infer the target type of a bare hash from the contained resource itself', () => {
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      { resourceType: 'Observation', subject: { reference: '#' } },
      observationSubjectPatientProfile,
    );

    expect(issues).toHaveLength(0);
  });

  it('validates a bare hash against the containing resource supplied by the resolver', () => {
    const validator = new ReferenceTargetValidator();
    const issues = validator.validate(
      { resourceType: 'Observation', subject: { reference: '#' } },
      observationSubjectPatientProfile,
      reference => reference === '#' ? { resourceType: 'Organization', id: 'owner' } : null,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-target-type-invalid',
      details: expect.objectContaining({ actualTarget: 'Organization' }),
    }));
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

  it('treats versioned Resource target canonicals as unrestricted', () => {
    const validator = new ReferenceTargetValidator();
    const profile: StructureDefinition = {
      ...observationSubjectPatientProfile,
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation' },
          {
            id: 'Observation.subject',
            path: 'Observation.subject',
            type: [{
              code: 'Reference',
              targetProfile: ['http://hl7.org/fhir/StructureDefinition/Resource|4.0.1'],
            }],
          },
        ],
      },
    };

    expect(validator.validate(
      { resourceType: 'Observation', subject: { reference: 'Organization/o1' } },
      profile,
    )).toEqual([]);
  });

  it('propagates resolver failures instead of treating an unverified target as valid', () => {
    const validator = new ReferenceTargetValidator();

    expect(() => validator.validate(
      { resourceType: 'Observation', subject: { reference: 'urn:uuid:target' } },
      observationSubjectPatientProfile,
      () => {
        throw new Error('resolver unavailable');
      },
    )).toThrow('resolver unavailable');
  });

  it('propagates profile type resolver failures instead of dropping all target rules', () => {
    const validator = new ReferenceTargetValidator();
    validator.setProfileTypeResolver(() => {
      throw new Error('profile resolver unavailable');
    });
    const profile = {
      ...observationSubjectPatientProfile,
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation' },
          {
            id: 'Observation.subject',
            path: 'Observation.subject',
            type: [{
              code: 'Reference',
              targetProfile: ['https://example.org/StructureDefinition/CustomPatient'],
            }],
          },
        ],
      },
    } as StructureDefinition;

    expect(() => validator.validate(
      { resourceType: 'Observation', subject: { reference: 'Patient/p1' } },
      profile,
    )).toThrow('profile resolver unavailable');
  });

  it('applies a sliced target rule only to references matching its child discriminator', () => {
    const validator = new ReferenceTargetValidator();
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/obs-performer-sliced',
      name: 'ObsPerformerSliced',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Observation',
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation' },
          {
            id: 'Observation.performer',
            path: 'Observation.performer',
            type: [{
              code: 'Reference',
              targetProfile: ['http://hl7.org/fhir/StructureDefinition/Resource'],
            }],
          },
          {
            id: 'Observation.performer:practitioner',
            path: 'Observation.performer',
            sliceName: 'practitioner',
            type: [{
              code: 'Reference',
              targetProfile: ['http://hl7.org/fhir/StructureDefinition/Practitioner'],
            }],
          },
          {
            id: 'Observation.performer:practitioner.type',
            path: 'Observation.performer.type',
            fixedUri: 'Practitioner',
          },
        ],
      },
    };

    const issues = validator.validate(
      {
        resourceType: 'Observation',
        performer: [
          { type: 'Practitioner', reference: 'Organization/wrong' },
          { type: 'Patient', reference: 'Organization/not-this-slice' },
        ],
      },
      profile,
    );

    expect(issues).toHaveLength(2);
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-target-type-invalid',
      path: 'Observation.performer[0]',
      details: expect.objectContaining({ declaredTargetType: 'Practitioner' }),
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-target-type-invalid',
      path: 'Observation.performer[0]',
      details: expect.objectContaining({ allowedTargets: ['Practitioner'] }),
    }));
    expect(dedupeIssues(issues)).toHaveLength(2);
  });

  it('skips malformed snapshot entries while retaining valid target rules', () => {
    const validator = new ReferenceTargetValidator();
    const profile = {
      ...observationSubjectPatientProfile,
      snapshot: {
        element: [
          null,
          {},
          { path: 42 },
          observationSubjectPatientProfile.snapshot?.element[1],
        ],
      },
    } as unknown as StructureDefinition;

    const issues = validator.validate(
      { resourceType: 'Observation', subject: { reference: 'Organization/o1' } },
      profile,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-target-type-invalid',
      path: 'Observation.subject',
    }));
  });

  it('does not enumerate an unidentifiable profiled reference slice for every base item', () => {
    const validator = new ReferenceTargetValidator();
    const profile: StructureDefinition = {
      ...observationSubjectPatientProfile,
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation' },
          {
            id: 'Observation.derivedFrom:profiled',
            path: 'Observation.derivedFrom',
            sliceName: 'profiled',
            type: [{
              code: 'Reference',
              targetProfile: ['http://example.org/StructureDefinition/special-observation'],
            }],
          },
        ],
      },
    };

    expect(validator.collectProfiledTargetHits(
      {
        resourceType: 'Observation',
        derivedFrom: [{ reference: 'Observation/source' }],
      },
      profile,
    )).toEqual([]);
  });
});

// CH eMed profiles the Medication a dispense names as
// ch-emed-medication-medicationdispense: its id ends in another resource type.
describe('target profiles whose ids mislead', () => {
  const MEDICATION = 'http://fhir.ch/ig/ch-emed/StructureDefinition/ch-emed-medication-medicationdispense';
  const dispenseProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://fhir.ch/ig/ch-emed/StructureDefinition/ch-emed-medicationdispense',
    type: 'MedicationDispense',
    snapshot: { element: [
      { id: 'MedicationDispense', path: 'MedicationDispense' },
      { id: 'MedicationDispense.medication[x]', path: 'MedicationDispense.medication[x]', type: [{ code: 'Reference', targetProfile: [MEDICATION] }] },
    ] },
  } as unknown as StructureDefinition;
  const dispense = { resourceType: 'MedicationDispense', medicationReference: { reference: 'Medication/m1' } };

  it('are named for loading until their type is known, then type the target', () => {
    const known = new Map<string, string>();
    const validator = new ReferenceTargetValidator();
    validator.setProfileTypeResolver(url => known.get(url) ?? null);

    expect(validator.untypedTargetProfiles(dispenseProfile)).toEqual([MEDICATION]);
    known.set(MEDICATION, 'Medication');
    expect(validator.untypedTargetProfiles(dispenseProfile)).toEqual([]);
    expect(validator.validate(dispense, dispenseProfile).filter(issue => issue.code === 'reference-target-type-invalid')).toEqual([]);
  });
});
