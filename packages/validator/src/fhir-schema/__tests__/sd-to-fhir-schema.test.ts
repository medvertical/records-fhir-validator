import { describe, it, expect } from 'vitest';
import {
  convertToFHIRSchema,
  summarizeConversion,
  mergeDifferentialWithBase,
  extractAllBindings,
  extractExtensionDefs,
} from '../sd-to-fhir-schema';

describe('convertToFHIRSchema', () => {
  it('converts a minimal Patient SD', () => {
    const sd = {
      url: 'http://hl7.org/fhir/StructureDefinition/Patient',
      name: 'Patient',
      type: 'Patient',
      kind: 'resource',
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/DomainResource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          { path: 'Patient.identifier', min: 0, max: '*', type: [{ code: 'Identifier' }] },
          { path: 'Patient.active', min: 0, max: '1', type: [{ code: 'boolean' }] },
          { path: 'Patient.name', min: 0, max: '*', type: [{ code: 'HumanName' }] },
          {
            path: 'Patient.gender', min: 0, max: '1',
            type: [{ code: 'code' }],
            binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender' },
          },
          { path: 'Patient.birthDate', min: 0, max: '1', type: [{ code: 'date' }] },
          {
            path: 'Patient.managingOrganization', min: 0, max: '1',
            type: [{ code: 'Reference', targetProfile: ['http://hl7.org/fhir/StructureDefinition/Organization'] }],
          },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);

    expect(schema.url).toBe('http://hl7.org/fhir/StructureDefinition/Patient');
    expect(schema.type).toBe('Patient');
    expect(schema.kind).toBe('resource');
    expect(schema.base).toBe('http://hl7.org/fhir/StructureDefinition/DomainResource');

    expect(schema.elements).toBeDefined();
    expect(schema.elements!.identifier).toBeDefined();
    expect(schema.elements!.identifier.type).toBe('Identifier');
    expect(schema.elements!.identifier.collection).toBe(true);

    expect(schema.elements!.active.type).toBe('boolean');
    expect(schema.elements!.active.collection).toBeUndefined();

    expect(schema.elements!.gender.binding).toEqual({
      valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender',
      strength: 'required',
    });

    expect(schema.elements!.managingOrganization.type).toBe('Reference');
    expect(schema.elements!.managingOrganization.refers).toEqual([
      'http://hl7.org/fhir/StructureDefinition/Organization',
    ]);
  });

  it('handles required fields', () => {
    const sd = {
      url: 'http://test/Observation',
      name: 'Observation',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          { path: 'Observation.status', min: 1, max: '1', type: [{ code: 'code' }] },
          { path: 'Observation.code', min: 1, max: '1', type: [{ code: 'CodeableConcept' }] },
          { path: 'Observation.subject', min: 0, max: '1', type: [{ code: 'Reference' }] },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.required).toContain('status');
    expect(schema.required).toContain('code');
    expect(schema.required).not.toContain('subject');
    expect(schema.elements!.status.required).toBe(true);
  });

  it('handles choice types (value[x])', () => {
    const sd = {
      url: 'http://test/Observation',
      name: 'Observation',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          {
            path: 'Observation.value[x]', min: 0, max: '1',
            type: [
              { code: 'Quantity' },
              { code: 'CodeableConcept' },
              { code: 'string' },
              { code: 'boolean' },
              { code: 'integer' },
              { code: 'dateTime' },
            ],
          },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.value).toBeDefined();
    expect(schema.elements!.value.choices).toEqual([
      'valueQuantity', 'valueCodeableConcept', 'valueString',
      'valueBoolean', 'valueInteger', 'valueDateTime',
    ]);
  });

  it('normalizes choice-type slices under the base choice element', () => {
    const sd = {
      url: 'http://test/ObservationProfile',
      name: 'ObservationProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          { path: 'Observation.value[x]', min: 0, max: '1' },
          {
            path: 'Observation.value[x]',
            min: 0,
            max: '1',
            sliceName: 'valueQuantity',
            type: [{ code: 'Quantity' }],
          },
          { path: 'Observation.value[x].unit', min: 0, max: '1', type: [{ code: 'string' }] },
          { path: 'Observation.value[x].system', min: 0, max: '1', type: [{ code: 'uri' }] },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.value).toBeDefined();
    expect(schema.elements!['value[x]']).toBeUndefined();
    expect(schema.elements!.value.choices).toContain('valueQuantity');
    expect(schema.elements!.value.slices!.valueQuantity).toBeDefined();
    expect(schema.elements!.value.elements!.unit.type).toBe('string');
    expect(schema.elements!.value.elements!.system.type).toBe('uri');
  });

  it('handles constraints (FHIRPath)', () => {
    const sd = {
      url: 'http://test/Patient',
      name: 'Patient',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          {
            path: 'Patient', min: 0, max: '*',
            constraint: [{
              key: 'pat-1',
              severity: 'error',
              human: 'SHALL at least contain a contact detail or a reference to an organization',
              expression: "name.exists() or telecom.exists() or address.exists() or contact.organization.exists()",
            }],
          },
          { path: 'Patient.name', min: 0, max: '*', type: [{ code: 'HumanName' }] },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.constraints).toHaveLength(1);
    expect(schema.constraints![0].key).toBe('pat-1');
    expect(schema.constraints![0].severity).toBe('error');
    expect(schema.constraints![0].expression).toContain('name.exists()');
  });

  it('converts sliced elements with slicing metadata + slice entries', () => {
    const sd = {
      url: 'http://test/Patient',
      name: 'Patient',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          {
            path: 'Patient.identifier', min: 0, max: '*',
            type: [{ code: 'Identifier' }],
            slicing: {
              discriminator: [{ type: 'value', path: 'system' }],
              rules: 'open',
              ordered: false,
            },
          },
          {
            path: 'Patient.identifier', min: 0, max: '1',
            sliceName: 'nhsNumber',
            type: [{ code: 'Identifier' }],
            patternIdentifier: { system: 'https://fhir.nhs.uk/Id/nhs-number' },
          },
          {
            path: 'Patient.identifier', min: 0, max: '1',
            sliceName: 'localId',
            type: [{ code: 'Identifier' }],
          },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.identifier).toBeDefined();
    expect(schema.elements!.identifier.slicing).toBeDefined();
    expect(schema.elements!.identifier.slicing!.discriminator).toEqual([{ type: 'value', path: 'system' }]);
    expect(schema.elements!.identifier.slicing!.rules).toBe('open');
    expect(schema.elements!.identifier.slices).toBeDefined();
    expect(schema.elements!.identifier.slices!.nhsNumber).toBeDefined();
    expect(schema.elements!.identifier.slices!.nhsNumber.max).toBe(1);
    expect(schema.elements!.identifier.slices!.nhsNumber.pattern).toEqual({ system: 'https://fhir.nhs.uk/Id/nhs-number' });
    expect(schema.elements!.identifier.slices!.localId).toBeDefined();
  });

  it('preserves slicing metadata even when no concrete slices are present', () => {
    const sd = {
      url: 'http://test/PatientProfile',
      name: 'PatientProfile',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          {
            path: 'Patient.extension',
            min: 0,
            max: '*',
            type: [{ code: 'Extension' }],
            slicing: {
              discriminator: [{ type: 'value', path: 'url' }],
              rules: 'open',
              ordered: false,
            },
          },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.extension.slicing).toEqual({
      discriminator: [{ type: 'value', path: 'url' }],
      rules: 'open',
      ordered: false,
    });
  });

  it('handles fixed values', () => {
    const sd = {
      url: 'http://test/Profile',
      name: 'TestProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          { path: 'Observation.status', min: 1, max: '1', type: [{ code: 'code' }], fixedCode: 'final' },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.status.fixed).toBe('final');
  });

  it('handles arbitrary fixed[x] and pattern[x] values', () => {
    const sd = {
      url: 'http://test/ObservationProfile',
      name: 'ObservationProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          {
            path: 'Observation.value[x]',
            min: 0,
            max: '1',
            type: [{ code: 'Quantity' }],
            patternQuantity: { system: 'http://unitsofmeasure.org', code: '/min' },
          },
          {
            path: 'Observation.subject',
            min: 0,
            max: '1',
            type: [{ code: 'Reference' }],
            patternReference: { reference: 'Patient/example' },
          },
          {
            path: 'Observation.status',
            min: 1,
            max: '1',
            type: [{ code: 'code' }],
            fixedCode: 'final',
          },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.value.pattern).toEqual({ system: 'http://unitsofmeasure.org', code: '/min' });
    expect(schema.elements!.subject.pattern).toEqual({ reference: 'Patient/example' });
    expect(schema.elements!.status.fixed).toBe('final');
  });

  it('preserves binding and constraints on slice definitions', () => {
    const sd = {
      url: 'http://test/ObservationProfile',
      name: 'ObservationProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          {
            path: 'Observation.code.coding',
            min: 0,
            max: '*',
            type: [{ code: 'Coding' }],
            slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' },
          },
          {
            path: 'Observation.code.coding',
            min: 1,
            max: '1',
            sliceName: 'loinc',
            type: [{ code: 'Coding' }],
            binding: { strength: 'required', valueSet: 'http://loinc.org/vs' },
            constraint: [{
              key: 'loinc-1',
              severity: 'error',
              human: 'Must be LOINC',
              expression: "system = 'http://loinc.org'",
            }],
          },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    const slice = schema.elements!.code.elements!.coding.slices!.loinc;
    expect(slice.binding).toEqual({ strength: 'required', valueSet: 'http://loinc.org/vs' });
    expect(slice.constraints).toHaveLength(1);
  });

  it('places nested slice children inside their parent slice elements', () => {
    const sd = {
      url: 'http://test/BloodPressureProfile',
      name: 'BloodPressureProfile',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { id: 'Observation', path: 'Observation', min: 0, max: '*' },
          {
            id: 'Observation.component',
            path: 'Observation.component',
            min: 0,
            max: '*',
            type: [{ code: 'BackboneElement' }],
            slicing: { discriminator: [{ type: 'pattern', path: 'code' }], rules: 'open' },
          },
          {
            id: 'Observation.component:SystolicBP',
            path: 'Observation.component',
            min: 1,
            max: '1',
            sliceName: 'SystolicBP',
          },
          {
            id: 'Observation.component:SystolicBP.code',
            path: 'Observation.component.code',
            min: 1,
            max: '1',
            type: [{ code: 'CodeableConcept' }],
          },
          {
            id: 'Observation.component:SystolicBP.code.coding',
            path: 'Observation.component.code.coding',
            min: 0,
            max: '*',
            type: [{ code: 'Coding' }],
            slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' },
          },
          {
            id: 'Observation.component:SystolicBP.code.coding:SCT',
            path: 'Observation.component.code.coding',
            min: 0,
            max: '1',
            sliceName: 'SCT',
            patternCoding: { system: 'http://snomed.info/sct', code: '271649006' },
          },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    const systolic = schema.elements!.component.slices!.SystolicBP;
    expect(systolic.elements!.code.type).toBe('CodeableConcept');
    expect(systolic.elements!.code.elements!.coding.slicing).toEqual({
      discriminator: [{ type: 'pattern', path: '$this' }],
      rules: 'open',
      ordered: undefined,
    });
    expect(systolic.elements!.code.elements!.coding.slices!.SCT.pattern).toEqual({
      system: 'http://snomed.info/sct',
      code: '271649006',
    });
  });

  it('handles empty SD gracefully', () => {
    const sd = {
      url: 'http://test/Empty',
      name: 'Empty',
      type: 'Basic',
      kind: 'resource',
    };

    const schema = convertToFHIRSchema(sd as any);
    expect(schema.url).toBe('http://test/Empty');
    expect(schema.elements).toBeUndefined();
  });

  it('handles nested elements (Patient.contact.name)', () => {
    const sd = {
      url: 'http://test/Patient',
      name: 'Patient',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          { path: 'Patient.contact', min: 0, max: '*', type: [{ code: 'BackboneElement' }] },
          { path: 'Patient.contact.relationship', min: 0, max: '*', type: [{ code: 'CodeableConcept' }] },
          { path: 'Patient.contact.name', min: 0, max: '1', type: [{ code: 'HumanName' }] },
          { path: 'Patient.contact.telecom', min: 0, max: '*', type: [{ code: 'ContactPoint' }] },
          { path: 'Patient.contact.organization', min: 0, max: '1', type: [{ code: 'Reference', targetProfile: ['http://hl7.org/fhir/StructureDefinition/Organization'] }] },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.contact).toBeDefined();
    expect(schema.elements!.contact.collection).toBe(true);
    expect(schema.elements!.contact.elements).toBeDefined();
    expect(schema.elements!.contact.elements!.name).toBeDefined();
    expect(schema.elements!.contact.elements!.name.type).toBe('HumanName');
    expect(schema.elements!.contact.elements!.telecom.collection).toBe(true);
    expect(schema.elements!.contact.elements!.organization.refers).toEqual([
      'http://hl7.org/fhir/StructureDefinition/Organization',
    ]);
  });

  it('handles 3-level nesting (Patient.contact.name.given)', () => {
    const sd = {
      url: 'http://test/Patient',
      name: 'Patient',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          { path: 'Patient.contact', min: 0, max: '*', type: [{ code: 'BackboneElement' }] },
          { path: 'Patient.contact.name', min: 0, max: '1', type: [{ code: 'HumanName' }] },
          { path: 'Patient.contact.name.given', min: 0, max: '*', type: [{ code: 'string' }] },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.contact.elements!.name.elements!.given).toBeDefined();
    expect(schema.elements!.contact.elements!.name.elements!.given.type).toBe('string');
    expect(schema.elements!.contact.elements!.name.elements!.given.collection).toBe(true);
  });
});

describe('summarizeConversion', () => {
  it('produces correct stats', () => {
    const sd = {
      url: 'http://test/Obs',
      name: 'Obs',
      type: 'Observation',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          { path: 'Observation.status', min: 1, max: '1', type: [{ code: 'code' }], binding: { strength: 'required', valueSet: 'http://vs' } },
          { path: 'Observation.code', min: 1, max: '1', type: [{ code: 'CodeableConcept' }] },
          { path: 'Observation.value[x]', min: 0, max: '1', type: [{ code: 'Quantity' }, { code: 'string' }] },
          { path: 'Observation.identifier', min: 0, max: '*', type: [{ code: 'Identifier' }], slicing: {} },
          { path: 'Observation.identifier', min: 0, max: '1', sliceName: 'accession', type: [{ code: 'Identifier' }] },
        ],
      },
    };

    const { stats } = summarizeConversion(sd);
    expect(stats.totalElements).toBe(6);
    expect(stats.convertedElements).toBe(4); // status, code, value, identifier
    expect(stats.convertedSlices).toBe(1);
    expect(stats.requiredFields).toBe(2);
    expect(stats.boundFields).toBe(1);
    expect(stats.choiceTypes).toBe(1);
  });

  it('counts nested schema elements recursively', () => {
    const sd = {
      url: 'http://test/Patient',
      name: 'Patient',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          { path: 'Patient.contact', min: 0, max: '*', type: [{ code: 'BackboneElement' }] },
          { path: 'Patient.contact.name', min: 0, max: '1', type: [{ code: 'HumanName' }] },
          { path: 'Patient.contact.name.given', min: 0, max: '*', type: [{ code: 'string' }] },
        ],
      },
    };

    const { stats } = summarizeConversion(sd);
    expect(stats.convertedElements).toBe(3);
    expect(stats.maxDepth).toBe(3);
  });
});

describe('mergeDifferentialWithBase', () => {
  it('overrides base cardinality with differential', () => {
    const base = [
      { path: 'Patient', min: 0, max: '*' },
      { path: 'Patient.name', min: 0, max: '*', type: [{ code: 'HumanName' }] },
      { path: 'Patient.gender', min: 0, max: '1', type: [{ code: 'code' }] },
    ];
    const diff = [
      { path: 'Patient.name', min: 1 },
    ];

    const merged = mergeDifferentialWithBase(diff, base);
    const nameEl = merged.find(e => e.path === 'Patient.name')!;
    expect(nameEl.min).toBe(1);
    expect(nameEl.type![0].code).toBe('HumanName');
  });

  it('adds new elements from differential', () => {
    const base = [
      { path: 'Patient', min: 0, max: '*' },
      { path: 'Patient.name', min: 0, max: '*', type: [{ code: 'HumanName' }] },
    ];
    const diff = [
      { path: 'Patient.identifier:nhsNumber', min: 1, max: '1', sliceName: 'nhsNumber' },
    ];

    const merged = mergeDifferentialWithBase(diff, base);
    expect(merged.length).toBe(3);
    expect(merged.find(e => e.path === 'Patient.identifier:nhsNumber')).toBeDefined();
  });
});

describe('convertToFHIRSchema with resolveBase', () => {
  it('merges differential against base SD snapshot', () => {
    const baseSd = {
      url: 'http://hl7.org/fhir/StructureDefinition/Patient',
      name: 'Patient', type: 'Patient', kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          { path: 'Patient.name', min: 0, max: '*', type: [{ code: 'HumanName' }] },
          { path: 'Patient.gender', min: 0, max: '1', type: [{ code: 'code' }] },
          { path: 'Patient.birthDate', min: 0, max: '1', type: [{ code: 'date' }] },
        ],
      },
    };

    const profileSd = {
      url: 'http://example.com/ISiKPatient',
      name: 'ISiKPatient', type: 'Patient', kind: 'resource',
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
      differential: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          { path: 'Patient.name', min: 1 },
          { path: 'Patient.gender', min: 1 },
        ],
      },
    };

    const resolver = (url: string) => url === baseSd.url ? baseSd : undefined;
    const schema = convertToFHIRSchema(profileSd, resolver);

    expect(schema.required).toContain('name');
    expect(schema.required).toContain('gender');
    expect(schema.elements!['birthDate']).toBeDefined();
  });

  it('falls back to differential-only when base not found', () => {
    const sd = {
      url: 'http://example.com/MyProfile',
      name: 'MyProfile', type: 'Patient', kind: 'resource',
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
      differential: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          { path: 'Patient.name', min: 1, max: '*', type: [{ code: 'HumanName' }] },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd, () => undefined);
    expect(schema.elements!['name']).toBeDefined();
    expect(schema.required).toContain('name');
  });
});

describe('extractAllBindings', () => {
  it('extracts bindings from nested elements', () => {
    const sd = {
      url: 'http://test/Observation', name: 'Obs', type: 'Observation', kind: 'resource',
      snapshot: {
        element: [
          { path: 'Observation', min: 0, max: '*' },
          { path: 'Observation.status', min: 1, max: '1', type: [{ code: 'code' }],
            binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/observation-status' } },
          { path: 'Observation.code', min: 1, max: '1', type: [{ code: 'CodeableConcept' }],
            binding: { strength: 'example', valueSet: 'http://hl7.org/fhir/ValueSet/observation-codes' } },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    const bindings = extractAllBindings(schema);
    expect(bindings.size).toBe(2);
    expect(bindings.get('Observation.status')!.strength).toBe('required');
    expect(bindings.get('Observation.code')!.strength).toBe('example');
  });
});

describe('extractExtensionDefs', () => {
  it('returns empty map when no extensions', () => {
    const sd = {
      url: 'http://test/Simple', name: 'Simple', type: 'Patient', kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          { path: 'Patient.active', min: 0, max: '1', type: [{ code: 'boolean' }] },
        ],
      },
    };
    const schema = convertToFHIRSchema(sd);
    expect(extractExtensionDefs(schema).size).toBe(0);
  });
});

describe('extension handling', () => {
  it('captures extensionUrl when Extension type has a profile URL', () => {
    const sd = {
      url: 'http://test/PatientProfile',
      name: 'PatientProfile',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          {
            path: 'Patient.extension', min: 0, max: '*',
            type: [{ code: 'Extension', profile: ['http://hl7.org/fhir/StructureDefinition/patient-birthPlace'] }],
          },
          { path: 'Patient.active', min: 0, max: '1', type: [{ code: 'boolean' }] },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.extension).toBeDefined();
    expect(schema.elements!.extension.type).toBe('Extension');
    expect(schema.elements!.extension.extensionUrl).toBe(
      'http://hl7.org/fhir/StructureDefinition/patient-birthPlace',
    );
  });

  it('captures extensionUrl for modifierExtension with a profile URL', () => {
    const sd = {
      url: 'http://test/AllergyProfile',
      name: 'AllergyProfile',
      type: 'AllergyIntolerance',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'AllergyIntolerance', min: 0, max: '*' },
          {
            path: 'AllergyIntolerance.modifierExtension', min: 0, max: '*',
            type: [{ code: 'Extension', profile: ['http://example.org/fhir/StructureDefinition/allergy-certainty'] }],
          },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.modifierExtension).toBeDefined();
    expect(schema.elements!.modifierExtension.type).toBe('Extension');
    expect(schema.elements!.modifierExtension.extensionUrl).toBe(
      'http://example.org/fhir/StructureDefinition/allergy-certainty',
    );
  });

  it('does not set extensionUrl when Extension type has no profile', () => {
    const sd = {
      url: 'http://test/Patient',
      name: 'Patient',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          {
            path: 'Patient.extension', min: 0, max: '*',
            type: [{ code: 'Extension' }],
          },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.extension).toBeDefined();
    expect(schema.elements!.extension.extensionUrl).toBeUndefined();
  });

  it('captures extensionUrl on extension slices (e.g. birthPlace)', () => {
    const sd = {
      url: 'http://test/PatientProfile',
      name: 'PatientProfile',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          {
            path: 'Patient.extension', min: 0, max: '*',
            type: [{ code: 'Extension' }],
            slicing: {
              discriminator: [{ type: 'value', path: 'url' }],
              rules: 'open',
            },
          },
          {
            path: 'Patient.extension', min: 0, max: '1',
            sliceName: 'birthPlace',
            type: [{ code: 'Extension', profile: ['http://hl7.org/fhir/StructureDefinition/patient-birthPlace'] }],
          },
          {
            path: 'Patient.extension', min: 0, max: '*',
            sliceName: 'citizenship',
            type: [{ code: 'Extension', profile: ['http://hl7.org/fhir/StructureDefinition/patient-citizenship'] }],
          },
          { path: 'Patient.active', min: 0, max: '1', type: [{ code: 'boolean' }] },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.extension).toBeDefined();
    expect(schema.elements!.extension.slicing).toBeDefined();
    expect(schema.elements!.extension.slicing!.discriminator).toEqual([{ type: 'value', path: 'url' }]);

    // Slices should exist with extensionUrl captured
    expect(schema.elements!.extension.slices).toBeDefined();
    expect(schema.elements!.extension.slices!.birthPlace).toBeDefined();
    expect(schema.elements!.extension.slices!.birthPlace.max).toBe(1);
    expect(schema.elements!.extension.slices!.birthPlace.extensionUrl).toBe(
      'http://hl7.org/fhir/StructureDefinition/patient-birthPlace',
    );
    expect(schema.elements!.extension.slices!.citizenship).toBeDefined();
    expect(schema.elements!.extension.slices!.citizenship.extensionUrl).toBe(
      'http://hl7.org/fhir/StructureDefinition/patient-citizenship',
    );
  });

  it('captures extensionUrl on nested extensions (e.g. Patient.name.extension)', () => {
    const sd = {
      url: 'http://test/PatientProfile',
      name: 'PatientProfile',
      type: 'Patient',
      kind: 'resource',
      snapshot: {
        element: [
          { path: 'Patient', min: 0, max: '*' },
          { path: 'Patient.name', min: 0, max: '*', type: [{ code: 'HumanName' }] },
          {
            path: 'Patient.name.extension', min: 0, max: '*',
            type: [{ code: 'Extension', profile: ['http://example.org/fhir/StructureDefinition/name-qualifier'] }],
          },
        ],
      },
    };

    const schema = convertToFHIRSchema(sd);
    expect(schema.elements!.name.elements!.extension).toBeDefined();
    expect(schema.elements!.name.elements!.extension.type).toBe('Extension');
    expect(schema.elements!.name.elements!.extension.extensionUrl).toBe(
      'http://example.org/fhir/StructureDefinition/name-qualifier',
    );
  });
});
