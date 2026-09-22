import { describe, expect, it } from 'vitest';
import { ConstraintValidator } from '../constraint-validator';
import { validateSliceTypeProfileConstraints } from '../slicing-type-profile-constraints';
import type { SliceDefinition } from '../slice-types';
import type { StructureDefinition } from '../../core/structure-definition-types';
import { SlicingValidator } from '../slicing-validator';

// Modelled on de.basisprofil.r4 gender-amtlich-de: the extension profile's
// invariant reads the CONTAINING resource through %resource. Regression for
// the profiled-precision FP where the slice value itself was bound as
// %resource and `%resource.where(gender='other')` came back empty.
const genderExtensionProfile: StructureDefinition = {
  resourceType: 'StructureDefinition',
  url: 'http://example.org/StructureDefinition/gender-amtlich-de',
  name: 'GenderAmtlichDe',
  status: 'active',
  kind: 'complex-type',
  abstract: false,
  type: 'Extension',
  snapshot: {
    element: [
      { id: 'Extension', path: 'Extension' },
      {
        id: 'Extension.value[x]',
        path: 'Extension.value[x]',
        constraint: [{
          key: 'gender-amtlich-1',
          severity: 'error',
          human: 'The extension may only be populated when gender is other',
          expression: "%resource.where(gender='other').exists()",
        }],
      },
    ],
  },
} as StructureDefinition;

const genderSlice: SliceDefinition = {
  sliceName: 'Geschlecht-administrativ',
  path: 'Patient.gender.extension',
  min: 0,
  max: '1',
  type: [{
    code: 'Extension',
    profile: ['http://example.org/StructureDefinition/gender-amtlich-de'],
  }],
};

const genderExtensionInstance = {
  url: 'http://example.org/StructureDefinition/gender-amtlich-de',
  valueCoding: { system: 'http://fhir.de/CodeSystem/gender-amtlich-de', code: 'D' },
};

function validateWithPatient(gender: string) {
  return validateSliceTypeProfileConstraints(
    genderExtensionInstance,
    genderSlice,
    'Patient.gender.extension[0]',
    'R4',
    async () => genderExtensionProfile,
    new ConstraintValidator(),
    { resourceType: 'Patient', id: 'example', gender },
  );
}

describe('validateSliceTypeProfileConstraints %resource binding', () => {
  it('binds %resource to the containing resource, not the slice value', async () => {
    const issues = await validateWithPatient('other');

    expect(issues.find(issue => issue.ruleId === 'gender-amtlich-1')).toBeUndefined();
  });

  it('still reports the violation when the containing resource fails the invariant', async () => {
    const issues = await validateWithPatient('male');

    const violation = issues.find(issue => issue.ruleId === 'gender-amtlich-1');
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe('error');
    expect(violation?.path).toBe('Patient.gender.extension[0].valueCoding');
  });

  it('uses a child type profile for slice identity and invariant validation', async () => {
    const sorCanonical = 'http://example.org/StructureDefinition/sor-identifier';
    const sorIdentifierProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: sorCanonical,
      name: 'SorIdentifier',
      status: 'active',
      kind: 'complex-type',
      abstract: false,
      type: 'Identifier',
      snapshot: {
        element: [
          { id: 'Identifier', path: 'Identifier' },
          { id: 'Identifier.system', path: 'Identifier.system', fixedUri: 'urn:oid:1.2.3.4' } as any,
          {
            id: 'Identifier.value',
            path: 'Identifier.value',
            constraint: [{
              key: 'min-digits-sor',
              severity: 'warning',
              human: 'SOR identifiers must contain at least 15 digits',
              expression: "matches('^([0-9]){15,}$')",
            }],
          },
        ],
      },
    } as StructureDefinition;
    const patientProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/patient-sor',
      name: 'PatientSor',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient.generalPractitioner',
            path: 'Patient.generalPractitioner',
            slicing: {
              discriminator: [{ type: 'value', path: 'identifier.system' }],
              rules: 'closed',
            },
          } as any,
          {
            id: 'Patient.generalPractitioner:sor',
            path: 'Patient.generalPractitioner',
            sliceName: 'sor',
            min: 0,
            max: '*',
            type: [{ code: 'Reference' }],
          } as any,
          {
            id: 'Patient.generalPractitioner:sor.identifier',
            path: 'Patient.generalPractitioner.identifier',
            min: 1,
            max: '1',
            type: [{ code: 'Identifier', profile: [sorCanonical] }],
          } as any,
        ],
      },
    } as StructureDefinition;
    const slicingValidator = new SlicingValidator();
    slicingValidator.setTypeProfileResolver(async url => (
      url.split('|')[0] === sorCanonical ? sorIdentifierProfile : null
    ));

    const issues = await slicingValidator.validateSlicing(
      [{ identifier: { system: 'urn:oid:1.2.3.4', value: '73456' } }],
      'Patient.generalPractitioner',
      patientProfile,
      null,
      undefined,
      'R4',
      { resourceType: 'Patient' },
    );

    expect(issues).toContainEqual(expect.objectContaining({
      ruleId: 'min-digits-sor',
      // A constraint authored as severity 'warning' is reported as a warning
      // since the severity fix in this release; it is no longer demoted.
      severity: 'warning',
      path: 'Patient.generalPractitioner[0].identifier.value',
    }));
    expect(issues.find(issue => issue.code === 'profile-slice-validation-error')).toBeUndefined();
    expect(issues.find(issue => issue.code === 'profile-slice-closed-unmatched')).toBeUndefined();
  });

  it('does not treat multiple child profile candidates as cumulative constraints', async () => {
    const candidateProfiles = [
      {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/StructureDefinition/patient-name',
        type: 'Patient',
        differential: { element: [{ path: 'Patient.name', min: 1 }] },
      },
      {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/StructureDefinition/patient-birth-date',
        type: 'Patient',
        differential: { element: [{ path: 'Patient.birthDate', min: 1 }] },
      },
    ] as StructureDefinition[];
    const multipleCandidateSlice: SliceDefinition = {
      sliceName: 'one',
      path: 'Parameters.parameter',
      min: 1,
      max: '1',
      childTypes: new Map([['resource', [{
        code: 'Resource',
        profile: candidateProfiles.map(profile => profile.url!),
      }]]]),
    };

    const issues = await validateSliceTypeProfileConstraints(
      { name: 'one', resource: { resourceType: 'Patient', id: '1' } },
      multipleCandidateSlice,
      'Parameters.parameter[0]',
      'R4',
      async url => candidateProfiles.find(profile => profile.url === url) ?? null,
      new ConstraintValidator(),
    );

    expect(issues).toEqual([]);
  });
});
