/**
 * Slicing Validator Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { SlicingValidator } from '../slicing-validator';
import { emitMatchedSliceChildIssues } from '../slicing-content-rules';
import type { StructureDefinition } from '../../core/structure-definition-types';

describe('SlicingValidator', () => {
  const validator = new SlicingValidator();

  it('does not report a required primitive child missing when only its sidecar is present', () => {
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/patient',
      name: 'PatientProfile',
      status: 'draft',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient.identifier:MaskierterVersichertenIdentifer',
            path: 'Patient.identifier',
            sliceName: 'MaskierterVersichertenIdentifer',
          },
          {
            id: 'Patient.identifier:MaskierterVersichertenIdentifer.value',
            path: 'Patient.identifier.value',
            min: 1,
          },
        ],
      },
    } as any;

    const issues = emitMatchedSliceChildIssues(
      {
        system: 'http://fhir.de/sid/gkv/kvid-10',
        _value: {
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
            valueCode: 'masked',
          }],
        },
      },
      { path: 'Patient.identifier', sliceName: 'MaskierterVersichertenIdentifer' } as any,
      'Patient.identifier[0]',
      profile,
    );

    expect(issues).toHaveLength(0);
  });

  it('matches value $this slices that constrain the whole Coding with patternCoding', async () => {
    const bodyTemperatureProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://nictiz.nl/fhir/StructureDefinition/zib-BodyTemperature',
      name: 'ZibBodyTemperature',
      status: 'draft',
      kind: 'resource',
      abstract: false,
      type: 'Observation',
      snapshot: {
        element: [
          {
            id: 'Observation.code.coding',
            path: 'Observation.code.coding',
            min: 1,
            max: '*',
            type: [{ code: 'Coding' }],
            slicing: {
              discriminator: [{ type: 'value', path: '$this' }],
              rules: 'open',
            },
          },
          {
            id: 'Observation.code.coding:BodyTempCode',
            path: 'Observation.code.coding',
            sliceName: 'BodyTempCode',
            min: 1,
            max: '1',
            type: [{ code: 'Coding' }],
            patternCoding: {
              system: 'http://loinc.org',
              code: '8310-5',
            },
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      [{ system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' }],
      'Observation.code.coding',
      bodyTemperatureProfile,
    );

    expect(issues.some(i => i.code === 'profile-slice-min-cardinality')).toBe(false);
  });

  it('does not enforce required slices whose type profile is for another FHIR version', async () => {
    const r4ProfileWithR5ExtensionSlice: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/r4-procedure',
      name: 'R4Procedure',
      status: 'draft',
      kind: 'resource',
      abstract: false,
      type: 'Procedure',
      snapshot: {
        element: [
          {
            id: 'Procedure.extension',
            path: 'Procedure.extension',
            min: 0,
            max: '*',
            slicing: {
              discriminator: [{ type: 'value', path: 'url' }],
              rules: 'open',
            },
          },
          {
            id: 'Procedure.extension:recorded',
            path: 'Procedure.extension',
            sliceName: 'recorded',
            min: 1,
            max: '1',
            type: [{
              code: 'Extension',
              profile: ['http://hl7.org/fhir/5.0/StructureDefinition/extension-Procedure.recorded'],
            }],
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      [],
      'Procedure.extension',
      r4ProfileWithR5ExtensionSlice,
      null,
      'Procedure.extension',
      'R4',
    );

    expect(issues.filter(i => i.code === 'profile-slice-min-cardinality')).toHaveLength(0);
  });

  it('matches primitive fixedCanonical slices on meta.profile', async () => {
    const kbvPatientProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient',
      name: 'KBV_PR_FOR_Patient',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient.meta.profile',
            path: 'Patient.meta.profile',
            min: 1,
            max: '*',
            slicing: {
              discriminator: [{ type: 'value', path: '$this' }],
              rules: 'open',
            },
          },
          {
            id: 'Patient.meta.profile:forProfile',
            path: 'Patient.meta.profile',
            sliceName: 'forProfile',
            min: 1,
            max: '1',
            fixedCanonical: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.3',
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      ['https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.3'],
      'Patient.meta.profile',
      kbvPatientProfile,
    );

    expect(issues.filter(i => i.code === 'profile-slice-min-cardinality')).toHaveLength(0);
    expect(issues.filter(i => i.code?.includes('fixed-value'))).toHaveLength(0);
  });

  it('reports a concrete fixedCanonical version mismatch instead of a missing meta.profile slice', async () => {
    const kbvPatientProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient',
      name: 'KBV_PR_FOR_Patient',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient.meta.profile',
            path: 'Patient.meta.profile',
            min: 1,
            max: '*',
            slicing: {
              discriminator: [{ type: 'value', path: '$this' }],
              rules: 'open',
            },
          },
          {
            id: 'Patient.meta.profile:forProfile',
            path: 'Patient.meta.profile',
            sliceName: 'forProfile',
            min: 1,
            max: '1',
            fixedCanonical: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.3',
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      ['https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.1.0'],
      'Patient.meta.profile',
      kbvPatientProfile,
    );

    expect(issues.filter(i => i.code === 'profile-slice-min-cardinality')).toHaveLength(0);
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-slice-fixed-value-mismatch',
      path: 'Patient.meta.profile[0]',
      details: expect.objectContaining({
        sliceName: 'forProfile',
        expectedValue: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.3',
        actualValue: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_FOR_Patient|1.1.0',
      }),
    }));
  });

  it('matches value $this slices using child patterns from a Coding type profile', async () => {
    const profileUrl = 'http://example.org/StructureDefinition/BodyTempCoding';
    const validatorWithResolver = new SlicingValidator();
    validatorWithResolver.setTypeProfileResolver(async (url) => url === profileUrl
      ? {
        resourceType: 'StructureDefinition',
        url: profileUrl,
        name: 'BodyTempCoding',
        status: 'draft',
        kind: 'complex-type',
        abstract: false,
        type: 'Coding',
        snapshot: {
          element: [
            { id: 'Coding', path: 'Coding' },
            { id: 'Coding.system', path: 'Coding.system', patternUri: 'http://loinc.org' },
            { id: 'Coding.code', path: 'Coding.code', patternCode: '8310-5' },
          ],
        },
      } as any
      : null);

    const bodyTemperatureProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://nictiz.nl/fhir/StructureDefinition/zib-BodyTemperature',
      name: 'ZibBodyTemperature',
      status: 'draft',
      kind: 'resource',
      abstract: false,
      type: 'Observation',
      snapshot: {
        element: [
          {
            id: 'Observation.code.coding',
            path: 'Observation.code.coding',
            min: 1,
            max: '*',
            type: [{ code: 'Coding' }],
            slicing: {
              discriminator: [{ type: 'value', path: '$this' }],
              rules: 'open',
            },
          },
          {
            id: 'Observation.code.coding:BodyTempCode',
            path: 'Observation.code.coding',
            sliceName: 'BodyTempCode',
            min: 1,
            max: '1',
            type: [{ code: 'Coding', profile: [profileUrl] }],
          },
        ],
      },
    } as any;

    const issues = await validatorWithResolver.validateSlicing(
      [{ system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' }],
      'Observation.code.coding',
      bodyTemperatureProfile,
    );

    expect(issues.some(i => i.code === 'profile-slice-min-cardinality')).toBe(false);
  });

  it('reports a concrete pattern mismatch instead of a missing slice for versioned Coding patterns', async () => {
    const heartRateProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_Base_Observation_Heart_Rate',
      name: 'KBV_PR_Base_Observation_Heart_Rate',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Observation',
      snapshot: {
        element: [
          {
            id: 'Observation.code.coding',
            path: 'Observation.code.coding',
            min: 2,
            max: '*',
            type: [{ code: 'Coding' }],
            slicing: {
              discriminator: [{ type: 'pattern', path: '$this' }],
              rules: 'open',
            },
          },
          {
            id: 'Observation.code.coding:loinc',
            path: 'Observation.code.coding',
            sliceName: 'loinc',
            min: 1,
            max: '1',
            type: [{ code: 'Coding' }],
            patternCoding: {
              system: 'http://loinc.org',
              code: '8867-4',
              version: '2.77',
            },
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      [{
        system: 'http://loinc.org',
        code: '8867-4',
        version: '2.81',
        display: 'Heart rate',
      }],
      'Observation.code.coding',
      heartRateProfile,
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-slice-min-cardinality',
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-slice-pattern-mismatch',
      path: 'Observation.code.coding[0]',
      details: expect.objectContaining({
        sliceName: 'loinc',
        expectedPattern: expect.objectContaining({
          system: 'http://loinc.org',
          code: '8867-4',
          version: '2.77',
        }),
        actualValue: expect.objectContaining({
          system: 'http://loinc.org',
          code: '8867-4',
          version: '2.81',
        }),
      }),
    }));
  });

  it('reports matched slice content issues at the original repeating element index', async () => {
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/observation-two-codings',
      name: 'ObservationTwoCodings',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Observation',
      snapshot: {
        element: [
          {
            id: 'Observation.code.coding',
            path: 'Observation.code.coding',
            min: 2,
            max: '*',
            type: [{ code: 'Coding' }],
            slicing: {
              discriminator: [{ type: 'pattern', path: '$this' }],
              rules: 'closed',
            },
          },
          {
            id: 'Observation.code.coding:sct',
            path: 'Observation.code.coding',
            sliceName: 'sct',
            min: 1,
            max: '1',
            type: [{ code: 'Coding' }],
            patternCoding: {
              system: 'http://snomed.info/sct',
              code: '251847006',
              display: 'Total fluid loss',
            },
          },
          {
            id: 'Observation.code.coding:loinc',
            path: 'Observation.code.coding',
            sliceName: 'loinc',
            min: 1,
            max: '1',
            type: [{ code: 'Coding' }],
            patternCoding: {
              system: 'http://loinc.org',
              code: '9257-7',
              display: 'Fluid output total Measured',
            },
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      [
        {
          system: 'http://snomed.info/sct',
          code: '251847006',
          display: 'Total fluid loss',
        },
        {
          system: 'http://loinc.org',
          code: '9257-7',
        },
      ],
      'Observation.code.coding',
      profile,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-slice-pattern-mismatch',
      path: 'Observation.code.coding[1]',
      details: expect.objectContaining({
        sliceName: 'loinc',
      }),
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-slice-min-cardinality',
      path: 'Observation.code.coding',
      details: expect.objectContaining({
        sliceName: 'loinc',
      }),
    }));
    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-slice-pattern-mismatch',
      path: 'Observation.code.coding[0]',
      details: expect.objectContaining({
        sliceName: 'loinc',
      }),
    }));
  });

  it('validates differential-only slices whose slicing declaration is inherited from the base profile', async () => {
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'https://example.org/StructureDefinition/left-ventricular-stroke-volume',
      name: 'LeftVentricularStrokeVolume',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Observation',
      baseDefinition: 'https://example.org/StructureDefinition/base-vitals',
      derivation: 'constraint',
      differential: {
        element: [
          {
            id: 'Observation.code.coding',
            path: 'Observation.code.coding',
            min: 3,
          },
          {
            id: 'Observation.code.coding:sct',
            path: 'Observation.code.coding',
            sliceName: 'sct',
            min: 1,
            max: '1',
            patternCoding: {
              system: 'http://snomed.info/sct',
              code: '90096001',
            },
          },
          {
            id: 'Observation.code.coding:loinc',
            path: 'Observation.code.coding',
            sliceName: 'loinc',
            min: 1,
            max: '1',
            patternCoding: {
              system: 'http://loinc.org',
              code: '20562-5',
            },
          },
          {
            id: 'Observation.code.coding:IEEE-11073',
            path: 'Observation.code.coding',
            sliceName: 'IEEE-11073',
            min: 1,
            max: '1',
            patternCoding: {
              system: 'urn:iso:std:iso:11073:10101',
              code: '150408',
            },
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      [
        { system: 'http://loinc.org', code: '20562-5', display: 'Left ventricular Stroke volume' },
        { system: 'http://snomed.info/sct', code: '90096001', display: 'Stroke volume (observable entity)' },
        { system: 'urn:iso:std:iso:11073:10101', code: '150428', display: 'Ventricular stroke' },
      ],
      'Observation.code.coding',
      profile,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-slice-min-cardinality',
      path: 'Observation.code.coding',
      details: expect.objectContaining({
        sliceName: 'IEEE-11073',
      }),
    }));
  });

  it('matches value discriminators backed by fixed child values on Coding', async () => {
    const bodyTemperatureProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/bodytemp',
      name: 'ObservationBodyTemperature',
      status: 'draft',
      kind: 'resource',
      abstract: false,
      type: 'Observation',
      snapshot: {
        element: [
          {
            id: 'Observation.code.coding',
            path: 'Observation.code.coding',
            slicing: {
              discriminator: [
                { type: 'value', path: 'code' },
                { type: 'value', path: 'system' },
              ],
              rules: 'open',
            },
          },
          {
            id: 'Observation.code.coding:BodyTempCode',
            path: 'Observation.code.coding',
            sliceName: 'BodyTempCode',
            min: 1,
            max: '1',
          },
          {
            id: 'Observation.code.coding:BodyTempCode.system',
            path: 'Observation.code.coding.system',
            fixedUri: 'http://loinc.org',
          },
          {
            id: 'Observation.code.coding:BodyTempCode.code',
            path: 'Observation.code.coding.code',
            fixedCode: '8310-5',
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      [{ system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' }],
      'Observation.code.coding',
      bodyTemperatureProfile,
    );

    expect(issues.some(i => i.code === 'profile-slice-min-cardinality')).toBe(false);
  });

  it('matches $this type slices for primitive date values', async () => {
    const usCoreGoalProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-goal',
      name: 'USCoreGoalProfile',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Goal',
      snapshot: {
        element: [
          {
            id: 'Goal.target.due[x]',
            path: 'Goal.target.due[x]',
            min: 0,
            max: '1',
            type: [{ code: 'date' }],
            slicing: {
              discriminator: [{ type: 'type', path: '$this' }],
              rules: 'closed',
            },
          },
          {
            id: 'Goal.target.due[x]:dueDate',
            path: 'Goal.target.due[x]',
            sliceName: 'dueDate',
            min: 0,
            max: '1',
            type: [{ code: 'date' }],
          },
        ],
      },
    } as any;

    const issues = await validator.validateSlicing(
      ['2020-11-25'],
      'Goal.target.due[x]',
      usCoreGoalProfile,
    );

    expect(issues.some(i => i.code === 'profile-slice-closed-unmatched')).toBe(false);
  });

  // Mock UK Core Patient profile with NHS Number identifier slicing
  const mockUKCorePatientProfile: StructureDefinition = {
    resourceType: 'StructureDefinition',
    url: 'https://fhir.hl7.org.uk/StructureDefinition/UKCore-Patient',
    name: 'UKCorePatient',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Patient',
    snapshot: {
      element: [
        {
          id: 'Patient.identifier',
          path: 'Patient.identifier',
          min: 0,
          max: '*',
          slicing: {
            discriminator: [{
              type: 'value',
              path: 'system'
            }],
            rules: 'open',
            ordered: false
          }
        } as any,
        {
          id: 'Patient.identifier:nhsNumber',
          path: 'Patient.identifier',
          sliceName: 'nhsNumber',
          min: 0,
          max: '1',
          type: [{
            code: 'Identifier'
          }],
          pattern: {
            system: 'https://fhir.nhs.uk/Id/nhs-number'
          }
        } as any,
        {
          id: 'Patient.identifier:nhsNumber.system',
          path: 'Patient.identifier.system',
          min: 1,
          max: '1',
          fixedUri: 'https://fhir.nhs.uk/Id/nhs-number'
        } as any,
        {
          id: 'Patient.identifier:nhsNumber.value',
          path: 'Patient.identifier.value',
          min: 1,
          max: '1'
        } as any
      ]
    }
  };

  describe('validateSlicing', () => {
    it('should validate correct NHS Number slice', async () => {
      const identifiers = [{
        system: 'https://fhir.nhs.uk/Id/nhs-number',
        value: '1234567890'
      }];

      const issues = await validator.validateSlicing(
        identifiers,
        'Patient.identifier',
        mockUKCorePatientProfile
      );

      // Should have no errors
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('matches value discriminators backed by child patternCoding on repeating children', async () => {
      const molgenReportProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-molgen/StructureDefinition/molekulargenetischer-befundbericht',
        name: 'MiiMolgenDiagnosticReport',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'DiagnosticReport',
        snapshot: {
          element: [
            {
              id: 'DiagnosticReport.category',
              path: 'DiagnosticReport.category',
              min: 1,
              max: '*',
              slicing: {
                discriminator: [{ type: 'value', path: 'coding' }],
                rules: 'open',
              },
            } as any,
            {
              id: 'DiagnosticReport.category:Genetics',
              path: 'DiagnosticReport.category',
              sliceName: 'Genetics',
              min: 1,
              max: '1',
              type: [{ code: 'CodeableConcept' }],
            } as any,
            {
              id: 'DiagnosticReport.category:Genetics.coding',
              path: 'DiagnosticReport.category.coding',
              min: 1,
              max: '1',
              type: [{ code: 'Coding' }],
              patternCoding: {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
                code: 'GE',
              },
            } as any,
          ],
        },
      };

      const issues = await validator.validateSlicing(
        [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
                code: 'GE',
                display: 'Genetics',
              },
            ],
          },
        ],
        'DiagnosticReport.category',
        molgenReportProfile,
      );

      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-min-cardinality',
      }));
    });

    it('matches value discriminators with $this child paths', async () => {
      const specimenProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-biobank/StructureDefinition/Specimen',
        name: 'MiiBiobankSpecimen',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Specimen',
        snapshot: {
          element: [
            {
              id: 'Specimen.type.coding',
              path: 'Specimen.type.coding',
              min: 1,
              max: '*',
              slicing: {
                discriminator: [{ type: 'value', path: '$this.system' }],
                rules: 'open',
              },
            } as any,
            {
              id: 'Specimen.type.coding:sct',
              path: 'Specimen.type.coding',
              sliceName: 'sct',
              min: 1,
              max: '*',
              type: [{ code: 'Coding' }],
            } as any,
            {
              id: 'Specimen.type.coding:sct.system',
              path: 'Specimen.type.coding.system',
              min: 0,
              max: '1',
              type: [{ code: 'uri' }],
              patternUri: 'http://snomed.info/sct',
            } as any,
          ],
        },
      };

      const issues = await validator.validateSlicing(
        [
          {
            system: 'http://snomed.info/sct',
            code: '16214371000119104',
          },
        ],
        'Specimen.type.coding',
        specimenProfile,
      );

      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-min-cardinality',
      }));
    });

    it('matches pattern discriminators with $this child paths', async () => {
      const qualityObservationProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-biobank/StructureDefinition/mii-pr-biobank-observation-qualitaetspruefung',
        name: 'MiiBiobankQualitaetspruefung',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Observation',
        snapshot: {
          element: [
            {
              id: 'Observation.component',
              path: 'Observation.component',
              min: 2,
              max: '*',
              slicing: {
                discriminator: [{ type: 'pattern', path: '$this.code' }],
                rules: 'open',
              },
            } as any,
            {
              id: 'Observation.component:type',
              path: 'Observation.component',
              sliceName: 'type',
              min: 1,
              max: '1',
              type: [{ code: 'BackboneElement' }],
            } as any,
            {
              id: 'Observation.component:type.code',
              path: 'Observation.component.code',
              min: 1,
              max: '1',
              patternCodeableConcept: {
                coding: [{ system: 'http://snomed.info/sct', code: '246423001' }],
              },
            } as any,
            {
              id: 'Observation.component:result',
              path: 'Observation.component',
              sliceName: 'result',
              min: 1,
              max: '1',
              type: [{ code: 'BackboneElement' }],
            } as any,
            {
              id: 'Observation.component:result.code',
              path: 'Observation.component.code',
              min: 1,
              max: '1',
              patternCodeableConcept: {
                coding: [{ system: 'http://snomed.info/sct', code: '79409006' }],
              },
            } as any,
          ],
        },
      };

      const issues = await validator.validateSlicing(
        [
          {
            code: {
              coding: [{ system: 'http://snomed.info/sct', code: '246423001' }],
            },
          },
          {
            code: {
              coding: [{ system: 'http://snomed.info/sct', code: '79409006' }],
            },
          },
        ],
        'Observation.component',
        qualityObservationProfile,
      );

      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-max-cardinality',
      }));
      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-min-cardinality',
      }));
      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-pattern-mismatch',
      }));
    });

  it('does not require slice dataAbsentReason when the matched component has value[x]', async () => {
    const bloodPressureProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-blood-pressure',
      name: 'USCoreBloodPressure',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Observation',
      snapshot: {
        element: [
          {
            id: 'Observation.component',
            path: 'Observation.component',
            min: 2,
            max: '*',
            slicing: {
              discriminator: [{ type: 'pattern', path: '$this.code' }],
              rules: 'open',
            },
          } as any,
          {
            id: 'Observation.component:systolic',
            path: 'Observation.component',
            sliceName: 'systolic',
            min: 1,
            max: '1',
            type: [{ code: 'BackboneElement' }],
          } as any,
          {
            id: 'Observation.component:systolic.code',
            path: 'Observation.component.code',
            min: 1,
            max: '1',
            patternCodeableConcept: {
              coding: [{ system: 'http://loinc.org', code: '8480-6' }],
            },
          } as any,
          {
            id: 'Observation.component:systolic.dataAbsentReason',
            path: 'Observation.component.dataAbsentReason',
            mustSupport: true,
          } as any,
        ],
      },
    };

    const issues = await validator.validateSlicing(
      [{
        code: {
          coding: [{ system: 'http://loinc.org', code: '8480-6' }],
        },
        valueQuantity: { value: 120, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
      }],
      'Observation.component',
      bloodPressureProfile,
    );

    expect(issues).not.toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
      path: 'Observation.component:systolic.dataAbsentReason',
    }));
  });

    it('matches pattern discriminators backed only by slice ValueSet bindings on first use', async () => {
      const loadValueSet = vi.fn(async (url: string) => {
        if (url.includes('beatmung-loinc')) {
          return ['76531-3'];
        }
        if (url.includes('beatmung-snomed')) {
          return ['271625008'];
        }
        return [];
      });

      const bindingOnlyValidator = new SlicingValidator();
      (bindingOnlyValidator as any).getValueSetLoader = () => ({ loadValueSet });

      const beatmungProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-icu/StructureDefinition/mii-pr-icu-parameter-von-beatmung',
        name: 'MiiIcuParameterVonBeatmung',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Observation',
        snapshot: {
          element: [
            {
              id: 'Observation.code.coding',
              path: 'Observation.code.coding',
              min: 1,
              max: '*',
              slicing: {
                discriminator: [{ type: 'pattern', path: '$this' }],
                rules: 'open',
              },
            } as any,
            {
              id: 'Observation.code.coding:sct',
              path: 'Observation.code.coding',
              sliceName: 'sct',
              min: 0,
              max: '*',
              type: [{ code: 'Coding' }],
              binding: {
                strength: 'required',
                valueSet: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-icu/ValueSet/beatmung-snomed',
              },
            } as any,
            {
              id: 'Observation.code.coding:loinc',
              path: 'Observation.code.coding',
              sliceName: 'loinc',
              min: 1,
              max: '*',
              type: [{ code: 'Coding' }],
              binding: {
                strength: 'required',
                valueSet: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-icu/ValueSet/beatmung-loinc',
              },
            } as any,
          ],
        },
      };

      const issues = await bindingOnlyValidator.validateSlicing(
        [{ system: 'http://loinc.org', code: '76531-3' }],
        'Observation.code.coding',
        beatmungProfile,
      );

      expect(loadValueSet).toHaveBeenCalledWith(
        'https://www.medizininformatik-initiative.de/fhir/ext/modul-icu/ValueSet/beatmung-snomed',
      );
      expect(loadValueSet).toHaveBeenCalledWith(
        'https://www.medizininformatik-initiative.de/fhir/ext/modul-icu/ValueSet/beatmung-loinc',
      );
      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-min-cardinality',
      }));
    });

    it('matches binding-backed CodeableConcept slices against nested codings', async () => {
      const loadValueSet = vi.fn(async (url: string) => {
        if (url.includes('section-types-loinc')) {
          return ['22634-0'];
        }
        return [];
      });

      const categoryValidator = new SlicingValidator();
      (categoryValidator as any).getValueSetLoader = () => ({ loadValueSet });

      const categoryProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-patho/StructureDefinition/mii-pr-patho-finding',
        name: 'MiiPathoFinding',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Observation',
        snapshot: {
          element: [
            {
              id: 'Observation.category',
              path: 'Observation.category',
              min: 2,
              max: '*',
              slicing: {
                discriminator: [{ type: 'pattern', path: '$this' }],
                rules: 'open',
              },
            } as any,
            {
              id: 'Observation.category:laboratory-category',
              path: 'Observation.category',
              sliceName: 'laboratory-category',
              min: 1,
              max: '1',
              patternCodeableConcept: {
                coding: [{
                  system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                  code: 'laboratory',
                }],
              },
              binding: {
                strength: 'preferred',
                valueSet: 'http://hl7.org/fhir/ValueSet/observation-category',
              },
            } as any,
            {
              id: 'Observation.category:section-type',
              path: 'Observation.category',
              sliceName: 'section-type',
              min: 1,
              max: '1',
              binding: {
                strength: 'required',
                valueSet: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-patho/ValueSet/section-types-loinc',
              },
            } as any,
          ],
        },
      };

      const issues = await categoryValidator.validateSlicing(
        [
          {
            coding: [{
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'laboratory',
            }],
          },
          {
            coding: [{
              system: 'http://loinc.org',
              code: '22634-0',
            }],
          },
        ],
        'Observation.category',
        categoryProfile,
      );

      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-min-cardinality',
      }));
    });

    it('does not match Condition.category slices through bare codes from another CodeSystem', async () => {
      const loadValueSet = vi.fn(async (url: string) => {
        if (url.includes('us-core-problem-or-health-concern')) {
          return [
            'http://terminology.hl7.org/CodeSystem/condition-category|problem-list-item',
            'problem-list-item',
          ];
        }
        if (url.includes('us-core-simple-observation-category')) {
          return [
            'http://terminology.hl7.org/CodeSystem/observation-category|survey',
            'problem-list-item',
          ];
        }
        return [];
      });

      const categoryValidator = new SlicingValidator();
      (categoryValidator as any).getValueSetLoader = () => ({ loadValueSet });

      const conditionCategoryProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/us/qicore/StructureDefinition/qicore-condition-problems-health-concerns',
        name: 'QICoreConditionProblemsHealthConcerns',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Condition',
        snapshot: {
          element: [
            {
              id: 'Condition.category',
              path: 'Condition.category',
              slicing: {
                discriminator: [{ type: 'value', path: '$this' }],
                rules: 'open',
              },
            } as any,
            {
              id: 'Condition.category:us-core',
              path: 'Condition.category',
              sliceName: 'us-core',
              min: 1,
              max: '*',
              type: [{ code: 'CodeableConcept' }],
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-problem-or-health-concern',
              },
            } as any,
            {
              id: 'Condition.category:screening-assessment',
              path: 'Condition.category',
              sliceName: 'screening-assessment',
              min: 0,
              max: '*',
              type: [{ code: 'CodeableConcept' }],
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-simple-observation-category',
              },
            } as any,
          ],
        },
      };

      const issues = await categoryValidator.validateSlicing(
        [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'problem-list-item',
          }],
        }],
        'Condition.category',
        conditionCategoryProfile,
      );

      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-min-cardinality',
        ruleId: 'slice-min-us-core',
      }));
    });

    it('does not claim a binding-only required slice is missing when the ValueSet cannot be resolved', async () => {
      const loadValueSet = vi.fn(async () => null);
      const categoryValidator = new SlicingValidator();
      (categoryValidator as any).getValueSetLoader = () => ({ loadValueSet });

      const conditionCategoryProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/us/qicore/StructureDefinition/qicore-condition-problems-health-concerns',
        name: 'QICoreConditionProblemsHealthConcerns',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Condition',
        snapshot: {
          element: [
            {
              id: 'Condition.category',
              path: 'Condition.category',
              slicing: {
                discriminator: [{ type: 'value', path: '$this' }],
                rules: 'open',
              },
            } as any,
            {
              id: 'Condition.category:us-core',
              path: 'Condition.category',
              sliceName: 'us-core',
              min: 1,
              max: '*',
              type: [{ code: 'CodeableConcept' }],
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-problem-or-health-concern',
              },
            } as any,
          ],
        },
      };

      const issues = await categoryValidator.validateSlicing(
        [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'problem-list-item',
          }],
        }],
        'Condition.category',
        conditionCategoryProfile,
      );

      expect(loadValueSet).toHaveBeenCalledWith(
        'http://hl7.org/fhir/us/core/ValueSet/us-core-problem-or-health-concern',
      );
      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-min-cardinality',
      }));
    });

    it('still reports binding-only required slice min when the sliced element is absent', async () => {
      const categoryValidator = new SlicingValidator();
      (categoryValidator as any).getValueSetLoader = () => ({ loadValueSet: vi.fn(async () => null) });

      const conditionCategoryProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://hl7.org/fhir/us/qicore/StructureDefinition/qicore-condition-problems-health-concerns',
        name: 'QICoreConditionProblemsHealthConcerns',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Condition',
        snapshot: {
          element: [
            {
              id: 'Condition.category',
              path: 'Condition.category',
              slicing: {
                discriminator: [{ type: 'value', path: '$this' }],
                rules: 'open',
              },
            } as any,
            {
              id: 'Condition.category:us-core',
              path: 'Condition.category',
              sliceName: 'us-core',
              min: 1,
              max: '*',
              type: [{ code: 'CodeableConcept' }],
              binding: {
                strength: 'required',
                valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-problem-or-health-concern',
              },
            } as any,
          ],
        },
      };

      const issues = await categoryValidator.validateSlicing(
        [],
        'Condition.category',
        conditionCategoryProfile,
      );

      expect(issues).toContainEqual(expect.objectContaining({
        code: 'profile-slice-min-cardinality',
        ruleId: 'slice-min-us-core',
      }));
    });

    it('matches pattern $this discriminators with child constraints on the sliced element', async () => {
      const codeCodingProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'https://www.medizininformatik-initiative.de/fhir/ext/modul-icu/StructureDefinition/mii-pr-icu-parameter-von-beatmung',
        name: 'MiiIcuParameterVonBeatmung',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Observation',
        snapshot: {
          element: [
            {
              id: 'Observation.code.coding',
              path: 'Observation.code.coding',
              min: 1,
              max: '*',
              slicing: {
                discriminator: [{ type: 'pattern', path: '$this' }],
                rules: 'open',
              },
            } as any,
            {
              id: 'Observation.code.coding:sct',
              path: 'Observation.code.coding',
              sliceName: 'sct',
              min: 0,
              max: '*',
              type: [{ code: 'Coding' }],
            } as any,
            {
              id: 'Observation.code.coding:sct.system',
              path: 'Observation.code.coding.system',
              min: 1,
              max: '1',
              patternUri: 'http://snomed.info/sct',
            } as any,
            {
              id: 'Observation.code.coding:loinc',
              path: 'Observation.code.coding',
              sliceName: 'loinc',
              min: 1,
              max: '*',
              type: [{ code: 'Coding' }],
            } as any,
            {
              id: 'Observation.code.coding:loinc.system',
              path: 'Observation.code.coding.system',
              min: 1,
              max: '1',
              patternUri: 'http://loinc.org',
            } as any,
          ],
        },
      };

      const issues = await validator.validateSlicing(
        [{ system: 'http://loinc.org', code: '76531-3' }],
        'Observation.code.coding',
        codeCodingProfile,
      );

      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-min-cardinality',
      }));
      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-pattern-mismatch',
      }));
    });

    it('reports a profile constraint when a single-slice discriminator is missing', async () => {
      const issues = await validator.validateSlicing(
        [{ value: '9000000009' }],
        'Patient.identifier',
        mockUKCorePatientProfile
      );

      expect(issues).toContainEqual(expect.objectContaining({
        code: 'profile-constraint-violation',
        severity: 'info',
        path: 'Patient.identifier[0]',
      }));
    });

    it('should detect too many NHS Number identifiers', async () => {
      const identifiers = [
        {
          system: 'https://fhir.nhs.uk/Id/nhs-number',
          value: '1234567890'
        },
        {
          system: 'https://fhir.nhs.uk/Id/nhs-number',
          value: '0987654321'
        }
      ];

      const issues = await validator.validateSlicing(
        identifiers,
        'Patient.identifier',
        mockUKCorePatientProfile
      );

      // Should have error about max cardinality
      const cardinalityErrors = issues.filter(i =>
        i.code === 'profile-slice-max-cardinality' && i.severity === 'error'
      );
      expect(cardinalityErrors.length).toBeGreaterThan(0);
    });

    it('should validate required slice cardinality', async () => {
      // Create profile with required NHS Number
      const profileWithRequired: StructureDefinition = {
        ...mockUKCorePatientProfile,
        snapshot: {
          element: [
            {
              id: 'Patient.identifier',
              path: 'Patient.identifier',
              min: 0,
              max: '*',
              slicing: {
                discriminator: [{
                  type: 'value',
                  path: 'system'
                }],
                rules: 'open'
              }
            } as any,
            {
              id: 'Patient.identifier:nhsNumber',
              path: 'Patient.identifier',
              sliceName: 'nhsNumber',
              min: 1, // Required
              max: '1',
              type: [{
                code: 'Identifier'
              }],
              pattern: {
                system: 'https://fhir.nhs.uk/Id/nhs-number'
              }
            } as any
          ]
        }
      };

      const identifiers: any[] = []; // No identifiers

      const issues = await validator.validateSlicing(
        identifiers,
        'Patient.identifier',
        profileWithRequired
      );

      // Should have error about missing required slice
      const requiredErrors = issues.filter(i =>
        i.code === 'profile-slice-min-cardinality' && i.severity === 'error'
      );
      expect(requiredErrors.length).toBeGreaterThan(0);
      expect(requiredErrors[0]).toMatchObject({
        resourceType: 'Patient',
        details: expect.objectContaining({ resourceType: 'Patient' }),
      });
    });

    it('should handle multiple slices correctly', async () => {
      const profileWithMultipleSlices: StructureDefinition = {
        ...mockUKCorePatientProfile,
        snapshot: {
          element: [
            {
              id: 'Patient.identifier',
              path: 'Patient.identifier',
              min: 0,
              max: '*',
              slicing: {
                discriminator: [{
                  type: 'value',
                  path: 'system'
                }],
                rules: 'open'
              }
            } as any,
            {
              id: 'Patient.identifier:nhsNumber',
              path: 'Patient.identifier',
              sliceName: 'nhsNumber',
              min: 0,
              max: '1',
              pattern: {
                system: 'https://fhir.nhs.uk/Id/nhs-number'
              }
            } as any,
            {
              id: 'Patient.identifier:hospitalNumber',
              path: 'Patient.identifier',
              sliceName: 'hospitalNumber',
              min: 0,
              max: '*',
              pattern: {
                system: 'http://example.org/hospital-id'
              }
            } as any
          ]
        }
      };

      const identifiers = [
        {
          system: 'https://fhir.nhs.uk/Id/nhs-number',
          value: '1234567890'
        },
        {
          system: 'http://example.org/hospital-id',
          value: 'H12345'
        },
        {
          system: 'http://example.org/hospital-id',
          value: 'H67890'
        }
      ];

      const issues = await validator.validateSlicing(
        identifiers,
        'Patient.identifier',
        profileWithMultipleSlices
      );

      // Should have no errors
      const errors = issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should detect unmatched elements in closed slicing', async () => {
      const profileWithClosed: StructureDefinition = {
        ...mockUKCorePatientProfile,
        snapshot: {
          element: [
            {
              id: 'Patient.identifier',
              path: 'Patient.identifier',
              min: 0,
              max: '*',
              slicing: {
                discriminator: [{
                  type: 'value',
                  path: 'system'
                }],
                rules: 'closed' // Closed slicing
              }
            } as any,
            {
              id: 'Patient.identifier:nhsNumber',
              path: 'Patient.identifier',
              sliceName: 'nhsNumber',
              min: 0,
              max: '1',
              pattern: {
                system: 'https://fhir.nhs.uk/Id/nhs-number'
              }
            } as any
          ]
        }
      };

      const identifiers = [
        {
          system: 'https://fhir.nhs.uk/Id/nhs-number',
          value: '1234567890'
        },
        {
          system: 'http://unknown-system.org/id', // Doesn't match any slice
          value: 'UNKNOWN123'
        }
      ];

      const issues = await validator.validateSlicing(
        identifiers,
        'Patient.identifier',
        profileWithClosed
      );

      // Should have error about unmatched element
      const unmatchedErrors = issues.filter(i =>
        i.code === 'profile-slice-closed-unmatched' && i.severity === 'error'
      );
      expect(unmatchedErrors.length).toBeGreaterThan(0);
    });

    it('should handle elements with no slicing gracefully', async () => {
      const profileWithoutSlicing: StructureDefinition = {
        ...mockUKCorePatientProfile,
        snapshot: {
          element: [
            {
              id: 'Patient.name',
              path: 'Patient.name',
              min: 0,
              max: '*'
              // No slicing
            }
          ]
        }
      };

      const names = [
        { family: 'Smith', given: ['John'] }
      ];

      const issues = await validator.validateSlicing(
        names,
        'Patient.name',
        profileWithoutSlicing
      );

      // Should have no issues (no slicing to validate)
      expect(issues).toHaveLength(0);
    });
  });

  describe('slice content validation', () => {
    it('reports extra fields on object fixed slice roots as child fixed-value errors', async () => {
      const practitionerProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://hapi.fhir.org/baseR4/StructureDefinition/PractitionerProfile',
        name: 'PractitionerProfile',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Practitioner',
        snapshot: {
          element: [
            {
              id: 'Practitioner.telecom',
              path: 'Practitioner.telecom',
              min: 1,
              max: '3',
              slicing: {
                discriminator: [{ type: 'value', path: 'use' }],
                ordered: false,
                rules: 'open',
              },
            } as any,
            {
              id: 'Practitioner.telecom:practitioner_home_phone',
              path: 'Practitioner.telecom',
              sliceName: 'practitioner_home_phone',
              min: 1,
              max: '1',
              fixedContactPoint: {
                use: 'home',
              },
            } as any,
          ],
        },
      };

      const issues = await validator.validateSlicing(
        [{
          system: 'phone',
          value: '555-101-0987',
          use: 'home',
        }],
        'Practitioner.telecom',
        practitionerProfile,
      );

      expect(issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          code: 'profile-fixed-value-mismatch',
          path: 'Practitioner.telecom[0].system',
        }),
        expect.objectContaining({
          severity: 'error',
          code: 'profile-fixed-value-mismatch',
          path: 'Practitioner.telecom[0].value',
        }),
      ]));
      expect(issues).not.toContainEqual(expect.objectContaining({
        code: 'profile-slice-fixed-value-mismatch',
        path: 'Practitioner.telecom[0]',
      }));
    });

    it('should validate fixed value in nested slice element', async () => {
      // German profile with GKV identifier slice requiring specific assigner system
      const germanProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://fhir.de/StructureDefinition/identifier-kvid-10',
        name: 'IdentifierKVID10',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Patient',
        snapshot: {
          element: [
            {
              id: 'Patient.identifier',
              path: 'Patient.identifier',
              min: 0,
              max: '*',
              slicing: {
                discriminator: [{ type: 'value', path: 'system' }],
                rules: 'open'
              }
            } as any,
            {
              id: 'Patient.identifier:gkv',
              path: 'Patient.identifier',
              sliceName: 'gkv',
              min: 0,
              max: '1',
              patternIdentifier: {
                system: 'http://fhir.de/sid/gkv/kvid-10'
              }
            } as any,
            {
              id: 'Patient.identifier:gkv.assigner.identifier.system',
              path: 'Patient.identifier:gkv.assigner.identifier.system',
              min: 1,
              max: '1',
              fixedUri: 'http://fhir.de/sid/arge-ik/iknr'
            } as any
          ]
        }
      };

      const identifiers = [{
        system: 'http://fhir.de/sid/gkv/kvid-10',
        value: 'A123456789',
        assigner: {
          identifier: {
            system: 'http://wrong-system.example.com', // Wrong system!
            value: '123456789'
          }
        }
      }];

      const issues = await validator.validateSlicing(
        identifiers,
        'Patient.identifier',
        germanProfile
      );

      // Should have issue about fixed value mismatch (warning severity for structural issues)
      const fixedValueErrors = issues.filter(i =>
        i.code.includes('fixed-value')
      );
      expect(fixedValueErrors.length).toBeGreaterThan(0);
      expect(fixedValueErrors[0].code).toBe('profile-slice-fixed-value-mismatch');
    });

    it('should pass when nested fixed value matches', async () => {
      const germanProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://fhir.de/StructureDefinition/identifier-kvid-10',
        name: 'IdentifierKVID10',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Patient',
        snapshot: {
          element: [
            {
              id: 'Patient.identifier',
              path: 'Patient.identifier',
              min: 0,
              max: '*',
              slicing: {
                discriminator: [{ type: 'value', path: 'system' }],
                rules: 'open'
              }
            } as any,
            {
              id: 'Patient.identifier:gkv',
              path: 'Patient.identifier',
              sliceName: 'gkv',
              min: 0,
              max: '1',
              patternIdentifier: {
                system: 'http://fhir.de/sid/gkv/kvid-10'
              }
            } as any,
            {
              id: 'Patient.identifier:gkv.assigner.identifier.system',
              path: 'Patient.identifier:gkv.assigner.identifier.system',
              min: 1,
              max: '1',
              fixedUri: 'http://fhir.de/sid/arge-ik/iknr'
            } as any
          ]
        }
      };

      const identifiers = [{
        system: 'http://fhir.de/sid/gkv/kvid-10',
        value: 'A123456789',
        assigner: {
          identifier: {
            system: 'http://fhir.de/sid/arge-ik/iknr', // Correct system!
            value: '123456789'
          }
        }
      }];

      const issues = await validator.validateSlicing(
        identifiers,
        'Patient.identifier',
        germanProfile
      );

      // Should have no fixed value errors
      const fixedValueErrors = issues.filter(i =>
        i.code.includes('fixed-value')
      );
      expect(fixedValueErrors).toHaveLength(0);
    });

    it('should report missing fixed value when element is absent', async () => {
      const germanProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://fhir.de/StructureDefinition/identifier-kvid-10',
        name: 'IdentifierKVID10',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Patient',
        snapshot: {
          element: [
            {
              id: 'Patient.identifier',
              path: 'Patient.identifier',
              min: 0,
              max: '*',
              slicing: {
                discriminator: [{ type: 'value', path: 'system' }],
                rules: 'open'
              }
            } as any,
            {
              id: 'Patient.identifier:gkv',
              path: 'Patient.identifier',
              sliceName: 'gkv',
              min: 0,
              max: '1',
              patternIdentifier: {
                system: 'http://fhir.de/sid/gkv/kvid-10'
              }
            } as any,
            {
              id: 'Patient.identifier:gkv.assigner.identifier.system',
              path: 'Patient.identifier:gkv.assigner.identifier.system',
              min: 1,
              max: '1',
              fixedUri: 'http://fhir.de/sid/arge-ik/iknr'
            } as any
          ]
        }
      };

      const identifiers = [{
        system: 'http://fhir.de/sid/gkv/kvid-10',
        value: 'A123456789'
        // No assigner at all!
      }];

      const issues = await validator.validateSlicing(
        identifiers,
        'Patient.identifier',
        germanProfile
      );

      // Should report missing fixed value
      const missingErrors = issues.filter(i =>
        i.code.includes('fixed-value-missing')
      );
      expect(missingErrors.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Discriminator-by-profile with reference chase
  // (PRD §6.1 "Slicing Validation" gap closure)
  // ==========================================================================

  describe('discriminator-by-profile reference chase', () => {
    const MII_PATIENT_PROFILE =
      'https://www.medizininformatik-initiative.de/fhir/core/modul-person/StructureDefinition/Patient';

    // Host profile where Encounter.subject is sliced on Reference profile:
    //   slice A: reference must conform to MII Patient
    const encounterProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/profile/encounter',
      name: 'EncounterWithProfileSlicing',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Encounter',
      snapshot: {
        element: [
          {
            id: 'Encounter.subject',
            path: 'Encounter.subject',
            min: 0,
            max: '*',
            slicing: {
              discriminator: [
                { type: 'profile', path: '$this' },
              ],
              rules: 'open',
              ordered: false,
            },
          } as any,
          {
            id: 'Encounter.subject:miiPatient',
            path: 'Encounter.subject',
            sliceName: 'miiPatient',
            min: 1,
            max: '1',
            type: [
              {
                code: 'Reference',
                profile: [MII_PATIENT_PROFILE],
              },
            ],
          } as any,
        ],
      },
    };

    it('matches a Reference when the resolved target carries the required profile', async () => {
      const referencedPatient = {
        resourceType: 'Patient',
        id: 'p1',
        meta: { profile: [MII_PATIENT_PROFILE] },
      };

      const validator = new SlicingValidator();
      validator.setReferenceResolver((ref: string) => {
        if (ref === 'Patient/p1') return referencedPatient;
        return null;
      });

      const issues = await validator.validateSlicing(
        [{ reference: 'Patient/p1' }],
        'Encounter.subject',
        encounterProfile,
      );

      // The miiPatient slice should be matched — no min-cardinality error
      const minErrors = issues.filter(
        i => i.code === 'profile-slice-min-cardinality',
      );
      expect(minErrors.length).toBe(0);
    });

    it('flags a missing slice when the resolved target does NOT carry the required profile', async () => {
      const referencedPatient = {
        resourceType: 'Patient',
        id: 'p1',
        meta: { profile: ['http://example.org/other/Patient'] },
      };

      const validator = new SlicingValidator();
      validator.setReferenceResolver((ref: string) => {
        if (ref === 'Patient/p1') return referencedPatient;
        return null;
      });

      const issues = await validator.validateSlicing(
        [{ reference: 'Patient/p1' }],
        'Encounter.subject',
        encounterProfile,
      );

      const minErrors = issues.filter(
        i => i.code === 'profile-slice-min-cardinality',
      );
      expect(minErrors.length).toBeGreaterThan(0);
    });

    it('still works without a reference resolver using inline meta.profile', async () => {
      const validator = new SlicingValidator();
      // No resolver set — falls back to inline path
      const issues = await validator.validateSlicing(
        [
          {
            // Inline reference with meta.profile directly on the object
            meta: { profile: [MII_PATIENT_PROFILE] },
          },
        ],
        'Encounter.subject',
        encounterProfile,
      );

      const minErrors = issues.filter(
        i => i.code === 'profile-slice-min-cardinality',
      );
      expect(minErrors.length).toBe(0);
    });

    it('does not crash when the resolver throws', async () => {
      const validator = new SlicingValidator();
      validator.setReferenceResolver(() => {
        throw new Error('boom');
      });

      await expect(
        validator.validateSlicing(
          [{ reference: 'Patient/broken' }],
          'Encounter.subject',
          encounterProfile,
        ),
      ).resolves.toBeDefined();
    });

    it('reports a slice miss when the resolver cannot find the target', async () => {
      const validator = new SlicingValidator();
      validator.setReferenceResolver(() => null);

      const issues = await validator.validateSlicing(
        [{ reference: 'Patient/unknown' }],
        'Encounter.subject',
        encounterProfile,
      );

      const minErrors = issues.filter(
        i => i.code === 'profile-slice-min-cardinality',
      );
      expect(minErrors.length).toBeGreaterThan(0);
    });
  });

  describe('EPS bundle slice regressions', () => {
    const COMPOSITION_EPS = 'http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps';
    const PATIENT_EPS = 'http://hl7.eu/fhir/eps/StructureDefinition/patient-eu-eps';

    const bundleProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
      name: 'BundleEuEps',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Bundle',
      snapshot: {
        element: [
          {
            id: 'Bundle.entry',
            path: 'Bundle.entry',
            min: 0,
            max: '*',
            slicing: {
              discriminator: [
                { type: 'type', path: 'resource' },
                { type: 'profile', path: 'resource' },
              ],
              rules: 'open',
              ordered: false,
            },
          } as any,
          {
            id: 'Bundle.entry:composition',
            path: 'Bundle.entry',
            sliceName: 'composition',
            min: 1,
            max: '1',
            type: [{ code: 'BackboneElement' }],
          } as any,
          {
            id: 'Bundle.entry:composition.resource',
            path: 'Bundle.entry.resource',
            type: [{ code: 'Composition', profile: [COMPOSITION_EPS] }],
          } as any,
          {
            id: 'Bundle.entry:patient',
            path: 'Bundle.entry',
            sliceName: 'patient',
            min: 1,
            max: '1',
            type: [{ code: 'BackboneElement' }],
          } as any,
          {
            id: 'Bundle.entry:patient.resource',
            path: 'Bundle.entry.resource',
            type: [{ code: 'Patient', profile: [PATIENT_EPS] }],
          } as any,
        ],
      },
    };

    it('matches Bundle.entry slices by embedded resourceType and meta.profile', async () => {
      const localValidator = new SlicingValidator();
      const issues = await localValidator.validateSlicing(
        [
          {
            fullUrl: 'urn:uuid:c1',
            resource: {
              resourceType: 'Composition',
              id: 'c1',
              meta: { profile: [COMPOSITION_EPS] },
              status: 'final',
            },
          },
          {
            fullUrl: 'urn:uuid:p1',
            resource: {
              resourceType: 'Patient',
              id: 'p1',
              meta: { profile: [PATIENT_EPS] },
            },
          },
        ],
        'Bundle.entry',
        bundleProfile,
      );

      expect(issues.filter(i => i.code === 'profile-slice-min-cardinality')).toHaveLength(0);
    });

    it('matches Reference and CodeableConcept values for closed choice-type discriminator slices', async () => {
      const medicationRequestProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/StructureDefinition/medication-request-choice',
        name: 'MedicationRequestChoice',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'MedicationRequest',
        snapshot: {
          element: [
            {
              id: 'MedicationRequest.medication[x]',
              path: 'MedicationRequest.medication[x]',
              min: 1,
              max: '1',
              slicing: {
                discriminator: [{ type: 'type', path: '$this' }],
                rules: 'closed',
                ordered: false,
              },
            } as any,
            {
              id: 'MedicationRequest.medication[x]:medicationCodeableConcept',
              path: 'MedicationRequest.medication[x]',
              sliceName: 'medicationCodeableConcept',
              min: 0,
              max: '1',
              type: [{ code: 'CodeableConcept' }],
            } as any,
            {
              id: 'MedicationRequest.medication[x]:medicationReference',
              path: 'MedicationRequest.medication[x]',
              sliceName: 'medicationReference',
              min: 0,
              max: '1',
              type: [{ code: 'Reference' }],
            } as any,
          ],
        },
      };

      const localValidator = new SlicingValidator();
      const referenceIssues = await localValidator.validateSlicing(
        [{ reference: 'Medication/med-1' }],
        'MedicationRequest.medication[x]',
        medicationRequestProfile,
      );

      expect(referenceIssues.find(i => i.code === 'profile-slice-closed-unmatched')).toBeUndefined();
      expect(referenceIssues.find(i => i.code === 'profile-slice-min-cardinality')).toBeUndefined();

      const codeableConceptIssues = await localValidator.validateSlicing(
        [{ text: '健保藥品 (BC13645100)' }],
        'MedicationRequest.medication[x]',
        medicationRequestProfile,
      );

      expect(codeableConceptIssues.find(i => i.code === 'profile-slice-closed-unmatched')).toBeUndefined();
      expect(codeableConceptIssues.find(i => i.code === 'profile-slice-min-cardinality')).toBeUndefined();
    });

    it('does not report closed unmatched when value slices only have unresolved bindings', async () => {
      const practitionerProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/StructureDefinition/practitioner-binding-slices',
        name: 'PractitionerBindingSlices',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Practitioner',
        snapshot: {
          element: [
            {
              id: 'Practitioner.qualification.code.coding',
              path: 'Practitioner.qualification.code.coding',
              min: 0,
              max: '*',
              slicing: {
                discriminator: [{ type: 'value', path: '$this' }],
                rules: 'closed',
                ordered: false,
              },
              type: [{ code: 'Coding' }],
            } as any,
            {
              id: 'Practitioner.qualification.code.coding:degreeType',
              path: 'Practitioner.qualification.code.coding',
              sliceName: 'degreeType',
              min: 0,
              max: '1',
              type: [{ code: 'Coding' }],
              patternCoding: {
                system: 'http://example.org/fhir/CodeSystem/known-degree-type',
                code: 'KNOWN',
              },
            } as any,
            {
              id: 'Practitioner.qualification.code.coding:degree',
              path: 'Practitioner.qualification.code.coding',
              sliceName: 'degree',
              min: 0,
              max: '1',
              type: [{ code: 'Coding' }],
              binding: {
                strength: 'required',
                valueSet: 'http://example.org/fhir/ValueSet/not-in-package-degree',
              },
            } as any,
            {
              id: 'Practitioner.qualification.code.coding:specialty',
              path: 'Practitioner.qualification.code.coding',
              sliceName: 'specialty',
              min: 0,
              max: '1',
              type: [{ code: 'Coding' }],
              binding: {
                strength: 'required',
                valueSet: 'http://example.org/fhir/ValueSet/not-in-package-degree',
              },
            } as any,
          ],
        },
      };

      const localValidator = new SlicingValidator();
      const issues = await localValidator.validateSlicing(
        [{
          system: 'https://mos.esante.gouv.fr/NOS/TRE_R36-AutreDiplomeObtenu/FHIR/TRE-R36-AutreDiplomeObtenu',
          code: 'AUT031',
        }],
        'Practitioner.qualification.code.coding',
        practitionerProfile,
      );

      expect(issues.find(i => i.code === 'profile-slice-closed-unmatched')).toBeUndefined();
      expect(issues.find(i => i.code === 'profile-slice-min-cardinality')).toBeUndefined();
    });

    it('accepts date-only precision for dateTime type discriminator slices', async () => {
      const conditionProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/StructureDefinition/condition-onset',
        name: 'ConditionOnset',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Condition',
        snapshot: {
          element: [
            {
              id: 'Condition.onset[x]',
              path: 'Condition.onset[x]',
              min: 0,
              max: '1',
              slicing: {
                discriminator: [{ type: 'type', path: '$this' }],
                rules: 'closed',
                ordered: false,
              },
            } as any,
            {
              id: 'Condition.onset[x]:onsetDateTime',
              path: 'Condition.onset[x]',
              sliceName: 'onsetDateTime',
              min: 0,
              max: '1',
              type: [{ code: 'dateTime' }],
            } as any,
          ],
        },
      };

      const localValidator = new SlicingValidator();
      const issues = await localValidator.validateSlicing(
        ['2003-12-18'],
        'Condition.onset[x]',
        conditionProfile,
      );

      expect(issues.find(i => i.code === 'profile-slice-closed-unmatched')).toBeUndefined();
    });

    it('matches nested Composition.section.entry slices by resolved targetProfile', async () => {
      const MEDICAL_TEST_RESULT = 'http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core';
      const compositionProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: COMPOSITION_EPS,
        name: 'CompositionEuEps',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Composition',
        snapshot: {
          element: [
            {
              id: 'Composition.section:sectionResults.entry',
              path: 'Composition.section.entry',
              min: 0,
              max: '*',
              slicing: {
                discriminator: [{ type: 'type', path: 'resolve()' }],
                rules: 'open',
                ordered: false,
              },
            } as any,
            {
              id: 'Composition.section:sectionResults.entry:results-medicalTestResult',
              path: 'Composition.section.entry',
              sliceName: 'results-medicalTestResult',
              min: 1,
              max: '*',
              type: [{ code: 'Reference', targetProfile: [MEDICAL_TEST_RESULT] }],
            } as any,
          ],
        },
      };

      const localValidator = new SlicingValidator();
      const issues = await localValidator.validateSlicing(
        [{ reference: 'urn:uuid:o1' }],
        'Composition.section.entry',
        compositionProfile,
        ref => ref === 'urn:uuid:o1'
          ? {
              resourceType: 'Observation',
              id: 'o1',
              meta: { profile: [MEDICAL_TEST_RESULT] },
            }
          : null,
        'Composition.section:sectionResults.entry',
      );

      expect(issues.filter(i => i.code === 'profile-slice-min-cardinality')).toHaveLength(0);
    });

    it('accepts extension-only complex values for type discriminator slices', async () => {
      const medicationStatementProfile: StructureDefinition = {
        resourceType: 'StructureDefinition',
        url: 'http://example.org/StructureDefinition/medication-statement-effective',
        name: 'MedicationStatementEffective',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'MedicationStatement',
        snapshot: {
          element: [
            {
              id: 'MedicationStatement.effective[x]',
              path: 'MedicationStatement.effective[x]',
              min: 0,
              max: '1',
              slicing: {
                discriminator: [{ type: 'type', path: '$this' }],
                rules: 'closed',
                ordered: false,
              },
            } as any,
            {
              id: 'MedicationStatement.effective[x]:effectivePeriod',
              path: 'MedicationStatement.effective[x]',
              sliceName: 'effectivePeriod',
              min: 0,
              max: '1',
              type: [{ code: 'Period' }],
            } as any,
          ],
        },
      };

      const localValidator = new SlicingValidator();
      const issues = await localValidator.validateSlicing(
        [{
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
            valueCode: 'unknown',
          }],
        }],
        'MedicationStatement.effective[x]',
        medicationStatementProfile,
      );

      expect(issues.find(i => i.code === 'profile-slice-closed-unmatched')).toBeUndefined();
    });
  });
});
