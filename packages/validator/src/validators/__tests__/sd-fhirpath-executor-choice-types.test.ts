import { describe, expect, it } from 'vitest';
import { sdFHIRPathExecutor } from '../sd-fhirpath-executor';
import { MustSupportValidator } from '../must-support-validator';
import { valueSetCache } from '../valueset-cache';
import type { StructureDefinition } from '../../core/structure-definition-types';

const bloodPressureObservation = {
  resourceType: 'Observation',
  id: 'bp-panel',
  component: [
    {
      code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
      valueQuantity: { value: 79, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
    },
    {
      code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
      valueQuantity: { value: 93, system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
    },
  ],
};

const vitalsProfile = {
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/StructureDefinition/vitalsigns',
  name: 'Vitalsigns',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Observation',
  snapshot: {
    element: [
      { id: 'Observation', path: 'Observation' },
      {
        id: 'Observation.component',
        path: 'Observation.component',
        mustSupport: true,
        type: [{ code: 'BackboneElement' }],
        constraint: [
          {
            key: 'vs-3',
            severity: 'error',
            human: 'If there is no a value a data absent reason must be present',
            expression: 'value.exists() or dataAbsentReason.exists()',
          },
        ],
      },
      { id: 'Observation.value[x]', path: 'Observation.value[x]', mustSupport: true },
      { id: 'Observation.dataAbsentReason', path: 'Observation.dataAbsentReason', mustSupport: true },
      { id: 'Observation.component.dataAbsentReason', path: 'Observation.component.dataAbsentReason', mustSupport: true },
    ],
  },
} satisfies StructureDefinition;

describe('SD FHIRPath choice-type handling', () => {
  it('does not flag vs-3 when Observation.component has valueQuantity', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: bloodPressureObservation,
      resourceType: 'Observation',
      structureDef: vitalsProfile,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.code === 'constraint-violation-vs-3')).toHaveLength(0);
  });

  it('still flags vs-3 when an Observation.component has neither value[x] nor dataAbsentReason', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'bp-panel-missing-value',
        component: [{ code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] } }],
      },
      resourceType: 'Observation',
      structureDef: vitalsProfile,
      fhirVersion: 'R4',
    });

    expect(issues.some(issue => issue.code === 'constraint-violation-vs-3')).toBe(true);
  });
});

describe('SD FHIRPath issue provenance', () => {
  it('keeps profile URL and constraint key on dynamic constraint violations', async () => {
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/strict-patient',
      name: 'StrictPatient',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient',
            path: 'Patient',
            constraint: [{
              key: 'example-1',
              severity: 'warning',
              human: 'Patient must be marked active',
              expression: 'active = true',
            }],
          },
        ],
      },
    };

    const issues = await sdFHIRPathExecutor.execute({
      resource: { resourceType: 'Patient', id: 'inactive', active: false },
      resourceType: 'Patient',
      structureDef: profile,
      fhirVersion: 'R4',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-example-1',
      profile: profile.url,
      ruleId: 'example-1',
    }));
  });
});

describe('SD FHIRPath evaluation diagnostics', () => {
  it('surfaces compile failures as information instead of silently passing', async () => {
    const profile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/patient-broken-expression',
      name: 'PatientBrokenExpression',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient',
      snapshot: {
        element: [
          {
            id: 'Patient',
            path: 'Patient',
            constraint: [{
              key: 'broken-fhirpath',
              severity: 'error',
              human: 'Broken expression should be visible as an engine diagnostic',
              expression: 'name.',
            }],
          },
        ],
      },
    };

    const issues = await sdFHIRPathExecutor.execute({
      resource: { resourceType: 'Patient', id: 'p1' },
      resourceType: 'Patient',
      structureDef: profile,
      fhirVersion: 'R4',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-constraint-evaluation-error',
      severity: 'information',
      ruleId: 'broken-fhirpath',
    }));
  });
});

describe('SD FHIRPath resolve() bundle context', () => {
  const subjectActiveProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/observation-subject-active',
    name: 'ObservationSubjectActive',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Observation',
    snapshot: {
      element: [
        {
          id: 'Observation',
          path: 'Observation',
          constraint: [{
            key: 'obs-subject-active',
            severity: 'error',
            human: 'Observation subject must resolve to an active Patient',
            expression: 'subject.resolve().where(active = true).exists()',
          }],
        },
      ],
    },
  } satisfies StructureDefinition;

  it('resolves fullUrl references from the supplied bundle', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          fullUrl: 'urn:uuid:patient-1',
          resource: { resourceType: 'Patient', id: 'p1', active: true },
        },
      ],
    };

    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'obs-1',
        subject: { reference: 'urn:uuid:patient-1' },
      },
      resourceType: 'Observation',
      structureDef: subjectActiveProfile,
      bundle,
      fhirVersion: 'R4',
    });

    expect(issues.find(issue => issue.ruleId === 'obs-subject-active')).toBeUndefined();
  });

  it('resolves fullUrl references from supplied bundleResources map keys', async () => {
    const bundleResources = new Map<string, any>([
      ['urn:uuid:patient-1', { resourceType: 'Patient', id: 'p1', active: true }],
    ]);

    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'obs-1',
        subject: { reference: 'urn:uuid:patient-1' },
      },
      resourceType: 'Observation',
      structureDef: subjectActiveProfile,
      bundleResources,
      fhirVersion: 'R4',
    });

    expect(issues.find(issue => issue.ruleId === 'obs-subject-active')).toBeUndefined();
  });

  it('reports the constraint when the resolved fullUrl target fails it', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [
        {
          fullUrl: 'urn:uuid:patient-1',
          resource: { resourceType: 'Patient', id: 'p1', active: false },
        },
      ],
    };

    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'obs-1',
        subject: { reference: 'urn:uuid:patient-1' },
      },
      resourceType: 'Observation',
      structureDef: subjectActiveProfile,
      bundle,
      fhirVersion: 'R4',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-obs-subject-active',
      path: 'Observation',
    }));
  });
});

describe('SD FHIRPath array element constraint handling', () => {
  const compositionProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/composition-section',
    name: 'CompositionSection',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Composition',
    snapshot: {
      element: [
        { id: 'Composition', path: 'Composition' },
        {
          id: 'Composition.section',
          path: 'Composition.section',
          type: [{ code: 'BackboneElement' }],
          constraint: [
            {
              key: 'cmp-2',
              severity: 'error',
              human: 'A section can only have an emptyReason if it is empty',
              expression: 'emptyReason.empty() or entry.empty()',
            },
          ],
        },
      ],
    },
  } satisfies StructureDefinition;

  it('evaluates cmp-2 per section item, not on the aggregate section array', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Composition',
        status: 'final',
        section: [
          { title: 'Problems', entry: [{ reference: 'Condition/1' }] },
          {
            title: 'Procedures',
            emptyReason: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/list-empty-reason',
                code: 'nilknown',
              }],
            },
          },
        ],
      },
      resourceType: 'Composition',
      structureDef: compositionProfile,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.code === 'constraint-violation-cmp-2')).toHaveLength(0);
  });

  it('still reports cmp-2 when the same section has entries and emptyReason', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Composition',
        status: 'final',
        section: [
          {
            title: 'Procedures',
            entry: [{ reference: 'Procedure/1' }],
            emptyReason: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/list-empty-reason',
                code: 'nilknown',
              }],
            },
          },
        ],
      },
      resourceType: 'Composition',
      structureDef: compositionProfile,
      fhirVersion: 'R4',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-cmp-2',
      path: 'Composition.section[0]',
    }));
  });
});

describe('SD FHIRPath boolean collection handling', () => {
  const patientNameProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/patient-name-given',
    name: 'PatientNameGiven',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Patient',
    snapshot: {
      element: [
        {
          id: 'Patient',
          path: 'Patient',
          constraint: [
            {
              key: 'pat-name-given',
              severity: 'error',
              human: 'Every name must have a given value',
              expression: 'name.select(given.exists())',
            },
          ],
        },
      ],
    },
  } satisfies StructureDefinition;

  it('fails constraints whose FHIRPath result is a boolean collection containing false', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Patient',
        id: 'mixed-names',
        name: [
          { given: ['Ada'] },
          { family: 'Lovelace' },
        ],
      },
      resourceType: 'Patient',
      structureDef: patientNameProfile,
      fhirVersion: 'R4',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-pat-name-given',
      path: 'Patient',
    }));
  });
});

describe('SD FHIRPath memberOf handling', () => {
  const patientCountryProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/patient-country',
    name: 'PatientCountry',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Patient',
    snapshot: {
      element: [
        {
          id: 'Patient',
          path: 'Patient',
          constraint: [
            {
              key: 'pat-country-iso',
              severity: 'error',
              human: 'Patient country must be ISO-3166 alpha-2',
              expression: "address.country.memberOf('http://hl7.org/fhir/ValueSet/iso3166-1-2')",
            },
          ],
        },
      ],
    },
  } satisfies StructureDefinition;

  it('does not silently pass invalid deterministic memberOf results', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Patient',
        id: 'invalid-country',
        address: [{ country: 'XX' }],
      },
      resourceType: 'Patient',
      structureDef: patientCountryProfile,
      fhirVersion: 'R4',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-pat-country-iso',
      path: 'Patient',
    }));
  });

  it('passes valid deterministic memberOf results', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Patient',
        id: 'valid-country',
        address: [{ country: 'DE' }],
      },
      resourceType: 'Patient',
      structureDef: patientCountryProfile,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.code === 'constraint-violation-pat-country-iso')).toHaveLength(0);
  });
});

describe('SD FHIRPath resource-root expression handling', () => {
  const patientRootExpressionProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/patient-root-expression',
    name: 'PatientRootExpression',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Patient',
    snapshot: {
      element: [
        { id: 'Patient', path: 'Patient' },
        {
          id: 'Patient.name',
          path: 'Patient.name',
          type: [{ code: 'HumanName' }],
          constraint: [
            {
              key: 'root-active',
              severity: 'error',
              human: 'Patient must be active',
              expression: 'Patient.active = true',
            },
          ],
        },
      ],
    },
  } satisfies StructureDefinition;

  it('evaluates absolute resource-root expressions from nested matches once', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Patient',
        active: false,
        name: [
          { family: 'Curie' },
          { family: 'Meitner' },
        ],
      },
      resourceType: 'Patient',
      structureDef: patientRootExpressionProfile,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.code === 'constraint-violation-root-active')).toHaveLength(1);
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-root-active',
      path: 'Patient.name[0]',
    }));
  });
});

describe('MustSupport choice-type handling', () => {
  it('does not request dataAbsentReason when component valueQuantity is present', async () => {
    const validator = new MustSupportValidator();
    const issues = await validator.validateAllMustSupportElements(
      bloodPressureObservation,
      vitalsProfile,
      vitalsProfile.url,
      () => undefined,
    );

    expect(issues).toHaveLength(0);
  });
});

describe('MustSupport contextual applicability', () => {
  const encounterProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/encounter-ms',
    name: 'EncounterMustSupport',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Encounter',
    snapshot: {
      element: [
        { id: 'Encounter', path: 'Encounter' },
        { id: 'Encounter.hospitalization', path: 'Encounter.hospitalization', mustSupport: true },
        { id: 'Encounter.reasonCode', path: 'Encounter.reasonCode', mustSupport: true },
      ],
    },
  } satisfies StructureDefinition;

  const patientAddressProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/patient-address-ms',
    name: 'PatientAddressMustSupport',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Patient',
    snapshot: {
      element: [
        { id: 'Patient', path: 'Patient' },
        { id: 'Patient.address', path: 'Patient.address', mustSupport: true },
        { id: 'Patient.address.period', path: 'Patient.address.period', mustSupport: true },
      ],
    },
  } satisfies StructureDefinition;

  const observationPublicRunProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/observation-public-run-ms',
    name: 'ObservationPublicRunMustSupport',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Observation',
    snapshot: {
      element: [
        { id: 'Observation', path: 'Observation' },
        { id: 'Observation.performer', path: 'Observation.performer', mustSupport: true },
        { id: 'Observation.specimen', path: 'Observation.specimen', mustSupport: true },
        { id: 'Observation.interpretation', path: 'Observation.interpretation', mustSupport: true },
        { id: 'Observation.referenceRange', path: 'Observation.referenceRange', mustSupport: true },
      ],
    },
  } satisfies StructureDefinition;

  const diagnosticReportPublicRunProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/diagnostic-report-public-run-ms',
    name: 'DiagnosticReportPublicRunMustSupport',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'DiagnosticReport',
    snapshot: {
      element: [
        { id: 'DiagnosticReport', path: 'DiagnosticReport' },
        { id: 'DiagnosticReport.resultsInterpreter', path: 'DiagnosticReport.resultsInterpreter', mustSupport: true },
      ],
    },
  } satisfies StructureDefinition;

  const getValueAtPath = (resource: any, path: string) => {
    if (path === 'Encounter.hospitalization') return resource.hospitalization;
    if (path === 'Encounter.reasonCode') return resource.reasonCode;
    if (path === 'Encounter.type') return resource.type;
    if (path === 'Patient.address') return resource.address;
    if (path === 'Patient.address.period') {
      return resource.address?.flatMap((address: any) => address.period ?? []);
    }
    if (path === 'Patient.address.postalCode') {
      return resource.address?.flatMap((address: any) => address.postalCode ?? []);
    }
    return undefined;
  };

  it('does not report hospitalization MustSupport missing for ambulatory Encounters', async () => {
    const validator = new MustSupportValidator();

    const issues = await validator.validateAllMustSupportElements(
      {
        resourceType: 'Encounter',
        status: 'finished',
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'AMB',
        },
      },
      encounterProfile,
      encounterProfile.url,
      getValueAtPath,
    );

    expect(issues.filter(issue => issue.path === 'Encounter.hospitalization')).toHaveLength(0);
  });

  it('still reports hospitalization MustSupport missing for inpatient Encounters', async () => {
    const validator = new MustSupportValidator();

    const issues = await validator.validateAllMustSupportElements(
      {
        resourceType: 'Encounter',
        status: 'finished',
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'IMP',
        },
      },
      encounterProfile,
      encounterProfile.url,
      getValueAtPath,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
      path: 'Encounter.hospitalization',
    }));
  });

  it('does not report reasonCode MustSupport missing for typed Encounters', async () => {
    const validator = new MustSupportValidator();

    const issues = await validator.validateAllMustSupportElements(
      {
        resourceType: 'Encounter',
        status: 'finished',
        type: [{
          coding: [{
            system: 'http://snomed.info/sct',
            code: '162673000',
            display: 'General examination of patient',
          }],
        }],
      },
      encounterProfile,
      encounterProfile.url,
      getValueAtPath,
    );

    expect(issues.filter(issue => issue.path === 'Encounter.reasonCode')).toHaveLength(0);
  });

  it('still reports reasonCode MustSupport missing when no encounter reason context exists', async () => {
    const validator = new MustSupportValidator();

    const issues = await validator.validateAllMustSupportElements(
      {
        resourceType: 'Encounter',
        status: 'finished',
      },
      encounterProfile,
      encounterProfile.url,
      getValueAtPath,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
      path: 'Encounter.reasonCode',
    }));
  });

  it('does not report address.period MustSupport missing for current Patient addresses', async () => {
    const validator = new MustSupportValidator();

    const issues = await validator.validateAllMustSupportElements(
      {
        resourceType: 'Patient',
        address: [{
          line: ['513 Schoen Run Apt 62'],
          city: 'Marshfield',
          state: 'MA',
          postalCode: '02050',
          country: 'US',
        }],
      },
      patientAddressProfile,
      patientAddressProfile.url,
      getValueAtPath,
    );

    expect(issues.filter(issue => issue.path === 'Patient.address.period')).toHaveLength(0);
  });

  it('does not report public-run optional Observation MustSupport elements as missing', async () => {
    const validator = new MustSupportValidator();

    const issues = await validator.validateAllMustSupportElements(
      {
        resourceType: 'Observation',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '8302-2' }],
        },
        valueQuantity: {
          value: 170,
          unit: 'cm',
          system: 'http://unitsofmeasure.org',
          code: 'cm',
        },
      },
      observationPublicRunProfile,
      observationPublicRunProfile.url,
      getValueAtPath,
    );

    expect(issues.filter(issue =>
      [
        'Observation.performer',
        'Observation.specimen',
        'Observation.interpretation',
        'Observation.referenceRange',
      ].includes(issue.path ?? '')
    )).toHaveLength(0);
  });

  it('does not report resultsInterpreter MustSupport missing for DiagnosticReport instances', async () => {
    const validator = new MustSupportValidator();

    const issues = await validator.validateAllMustSupportElements(
      {
        resourceType: 'DiagnosticReport',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '11502-2' }],
        },
      },
      diagnosticReportPublicRunProfile,
      diagnosticReportPublicRunProfile.url,
      getValueAtPath,
    );

    expect(issues.filter(issue => issue.path === 'DiagnosticReport.resultsInterpreter')).toHaveLength(0);
  });

  it('does not report postalCode MustSupport missing for Patient address instances', async () => {
    const validator = new MustSupportValidator();

    const issues = await validator.validateAllMustSupportElements(
      {
        resourceType: 'Patient',
        address: [{
          city: 'Berlin',
          country: 'DE',
        }],
      },
      {
        ...patientAddressProfile,
        snapshot: {
          element: [
            ...patientAddressProfile.snapshot.element,
            { id: 'Patient.address.postalCode', path: 'Patient.address.postalCode', mustSupport: true },
          ],
        },
      },
      patientAddressProfile.url,
      getValueAtPath,
    );

    expect(issues.filter(issue => issue.path === 'Patient.address.postalCode')).toHaveLength(0);
  });

  it('still reports address.period MustSupport missing for old Patient addresses', async () => {
    const validator = new MustSupportValidator();

    const issues = await validator.validateAllMustSupportElements(
      {
        resourceType: 'Patient',
        address: [{
          use: 'old',
          line: ['513 Schoen Run Apt 62'],
          city: 'Marshfield',
          state: 'MA',
          postalCode: '02050',
          country: 'US',
        }],
      },
      patientAddressProfile,
      patientAddressProfile.url,
      getValueAtPath,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-mustsupport-missing',
      path: 'Patient.address.period',
    }));
  });
});

describe('SD FHIRPath choice-type casts', () => {
  it('does not apply dateTime precision constraints to effectivePeriod values', async () => {
    const observationProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-lab',
      name: 'UsCoreObservationLab',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Observation',
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation' },
          {
            id: 'Observation.effective[x]',
            path: 'Observation.effective[x]',
            type: [{ code: 'dateTime' }, { code: 'Period' }],
            constraint: [
              {
                key: 'us-core-1',
                severity: 'error',
                human: 'Datetime must be at least to day.',
                expression: '($this as dateTime).toString().length() >= 8',
              },
            ],
          },
        ],
      },
    };

    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'period-effective',
        effectivePeriod: {
          start: '2022-01-25T00:00:00-05:00',
          end: '2022-01-26T00:00:00-05:00',
        },
      },
      resourceType: 'Observation',
      structureDef: observationProfile,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.code === 'constraint-violation-us-core-1')).toHaveLength(0);
  });

  const effectiveCastProfile = (expression: string): StructureDefinition => ({
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/effective-cast',
    name: 'EffectiveCast',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Observation',
    snapshot: {
      element: [
        { id: 'Observation', path: 'Observation' },
        {
          id: 'Observation.effective[x]',
          path: 'Observation.effective[x]',
          type: [{ code: 'dateTime' }, { code: 'Period' }, { code: 'string' }],
          constraint: [
            { key: 'eff-cast', severity: 'error', human: 'cast', expression },
          ],
        },
      ],
    },
  });

  it('skips a primitive-typed cast constraint when the instance is a different primitive', async () => {
    // valueString-style: effectiveString present, constraint casts to dateTime.
    // Structural inference is blind to primitives — path-based derivation is not.
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'string-effective',
        effectiveString: 'roughly noon',
      },
      resourceType: 'Observation',
      structureDef: effectiveCastProfile('($this as dateTime).toString().length() >= 8'),
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.code === 'constraint-violation-eff-cast')).toHaveLength(0);
  });

  it('skips an ofType() constraint when the instance type does not match', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'period-effective-oftype',
        effectivePeriod: { start: '2022-01-25', end: '2022-01-26' },
      },
      resourceType: 'Observation',
      structureDef: effectiveCastProfile('effective.ofType(dateTime).toString().length() >= 8'),
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.code === 'constraint-violation-eff-cast')).toHaveLength(0);
  });

  it('still evaluates a cast constraint when the instance type matches', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'short-datetime',
        effectiveDateTime: '2022',
      },
      resourceType: 'Observation',
      structureDef: effectiveCastProfile('($this as dateTime).toString().length() >= 8'),
      fhirVersion: 'R4',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-eff-cast',
    }));
  });

  const typeNameProfile = (expression: string): StructureDefinition => ({
    resourceType: 'StructureDefinition',
    url: 'http://example.org/StructureDefinition/value-type-name',
    name: 'ValueTypeName',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Observation',
    snapshot: {
      element: [
        { id: 'Observation', path: 'Observation' },
        {
          id: 'Observation.value[x]',
          path: 'Observation.value[x]',
          type: [{ code: 'Quantity' }, { code: 'string' }, { code: 'CodeableConcept' }],
          constraint: [
            { key: 'vtn-1', severity: 'error', human: 'type guard', expression },
          ],
        },
      ],
    },
  });

  // P-1 full type-annotation injection: for a polymorphic value[x] element the
  // SD lists every choice type, so resolveElementType is null and fhirpath.js
  // resolves `.type()` on the raw object to 'Object'. The concrete type derived
  // from resourcePath (valueQuantity → Quantity) is injected into the
  // preprocessor so `%context.type().name` resolves to the real type.
  it('resolves %context.type().name against the concrete choice type (match → passes)', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'qty-value',
        valueQuantity: { value: 5, system: 'http://unitsofmeasure.org', code: 'mg' },
      },
      resourceType: 'Observation',
      structureDef: typeNameProfile("%context.type().name = 'Quantity'"),
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.code === 'constraint-violation-vtn-1')).toHaveLength(0);
  });

  it('resolves %context.type().name against the concrete choice type (mismatch → violation)', async () => {
    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Observation',
        id: 'string-value',
        valueString: 'free text',
      },
      resourceType: 'Observation',
      structureDef: typeNameProfile("%context.type().name = 'Quantity'"),
      fhirVersion: 'R4',
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'constraint-violation-vtn-1',
    }));
  });

  it('evaluates simple memberOf exists constraints against cached ValueSets', async () => {
    const valueSetUrl = 'http://example.org/fhir/ValueSet/condition-category';
    valueSetCache.setValueSetFile(`${valueSetUrl}|R4`, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      compose: {
        include: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-category',
          concept: [
            { code: 'problem-list-item' },
            { code: 'encounter-diagnosis' },
          ],
        }],
      },
    } as any);

    const conditionProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/fhir/StructureDefinition/condition',
      name: 'ConditionProfile',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Condition',
      snapshot: {
        element: [
          {
            id: 'Condition',
            path: 'Condition',
            constraint: [{
              key: 'cat-1',
              severity: 'warning',
              human: 'A category should be from the local category value set.',
              expression: `where(category.memberOf('${valueSetUrl}')).exists()`,
            }],
          },
        ],
      },
    };

    const validIssues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Condition',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
          }],
        }],
      },
      resourceType: 'Condition',
      structureDef: conditionProfile,
      fhirVersion: 'R4',
    });

    expect(validIssues.filter(issue => issue.ruleId === 'cat-1')).toHaveLength(0);

    const invalidIssues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Condition',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'unsupported-category',
          }],
        }],
      },
      resourceType: 'Condition',
      structureDef: conditionProfile,
      fhirVersion: 'R4',
    });

    expect(invalidIssues.filter(issue => issue.ruleId === 'cat-1')).toHaveLength(1);
  });

  it('treats legacy ValueSet in-exists constraints as ValueSet membership checks', async () => {
    const valueSetUrl = 'http://example.org/fhir/ValueSet/condition-category-in';
    valueSetCache.setValueSetFile(`${valueSetUrl}|R4`, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      compose: {
        include: [{
          system: 'http://terminology.hl7.org/CodeSystem/condition-category',
          concept: [
            { code: 'problem-list-item' },
            { code: 'encounter-diagnosis' },
          ],
        }],
      },
    } as any);

    const conditionProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/fhir/StructureDefinition/condition-in',
      name: 'ConditionProfileIn',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Condition',
      snapshot: {
        element: [
          {
            id: 'Condition',
            path: 'Condition',
            constraint: [{
              key: 'cat-in-1',
              severity: 'warning',
              human: 'A category should be from the local category value set.',
              expression: `where(category in '${valueSetUrl}').exists()`,
            }],
          },
        ],
      },
    };

    const validIssues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Condition',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
          }],
        }],
      },
      resourceType: 'Condition',
      structureDef: conditionProfile,
      fhirVersion: 'R4',
    });

    expect(validIssues.filter(issue => issue.ruleId === 'cat-in-1')).toHaveLength(0);

    const invalidIssues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Condition',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'unsupported-category',
          }],
        }],
      },
      resourceType: 'Condition',
      structureDef: conditionProfile,
      fhirVersion: 'R4',
    });

    expect(invalidIssues.filter(issue => issue.ruleId === 'cat-in-1')).toHaveLength(1);
  });

  it('does not fail simple memberOf constraints when the ValueSet is unavailable', async () => {
    const missingValueSetUrl = 'http://example.org/fhir/ValueSet/not-installed';
    valueSetCache.setValueSetFile(`${missingValueSetUrl}|R4`, null);

    const conditionProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/fhir/StructureDefinition/condition-missing-valueset',
      name: 'ConditionProfileMissingValueSet',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Condition',
      snapshot: {
        element: [
          {
            id: 'Condition',
            path: 'Condition',
            constraint: [{
              key: 'cat-missing-vs',
              severity: 'warning',
              human: 'A category should be from a ValueSet that is not installed.',
              expression: `where(category in '${missingValueSetUrl}').exists()`,
            }],
          },
        ],
      },
    };

    const issues = await sdFHIRPathExecutor.execute({
      resource: {
        resourceType: 'Condition',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
          }],
        }],
      },
      resourceType: 'Condition',
      structureDef: conditionProfile,
      fhirVersion: 'R4',
    });

    expect(issues.filter(issue => issue.ruleId === 'cat-missing-vs')).toHaveLength(0);
  });
});
