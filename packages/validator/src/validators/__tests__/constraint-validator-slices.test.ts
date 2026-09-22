import { describe, expect, it } from 'vitest';
import { ConstraintValidator } from '../constraint-validator';
import type { ElementDefinition } from '../../core/structure-definition-types';

describe('ConstraintValidator slice constraints', () => {
  it('rebuilds slice lookups when the same profile definitions change between validations', async () => {
    const validator = new ConstraintValidator();
    const resource = { resourceType: 'Patient', identifier: [{ system: 'urn:first', value: 'invalid' }] };
    const system: ElementDefinition = { id: 'Patient.identifier:scoped.system',
      path: 'Patient.identifier.system', fixedUri: 'urn:first' };
    const elements: ElementDefinition[] = [
      { id: 'Patient.identifier:scoped', path: 'Patient.identifier', sliceName: 'scoped',
        constraint: [{ key: 'scoped-value', severity: 'error', human: 'Value must be numeric',
          expression: "value.matches('^[0-9]+$')" }] }, system,
    ];
    expect((await validator.validate(resource, elements, 'urn:profile')).map(issue => issue.ruleId)).toEqual(['scoped-value']);
    system.fixedUri = 'urn:second';
    expect(await validator.validate(resource, elements, 'urn:profile')).toEqual([]);
    system.fixedUri = 'urn:first';
    expect((await validator.validate(resource, elements, 'urn:profile')).map(issue => issue.ruleId)).toEqual(['scoped-value']);
  });

  it('evaluates patternIdentifier slice constraints only for matching slice instances', async () => {
    const validator = new ConstraintValidator();
    const resource = {
      resourceType: 'Organization',
      identifier: [
        {
          system: 'https://www.test.com/fhir/resource/identifier/organization',
          value: 'Organization-Description-SpecialChar',
        },
        {
          system: 'http://hl7.org/fhir/sid/us-npi',
          value: 'Organization-NPI-00023',
        },
        {
          system: 'urn:oid:2.16.840.1.113883.4.7',
          value: 'Organization-CLIA-00023',
        },
      ],
    };

    const elements: ElementDefinition[] = [
      {
        id: 'Organization.identifier:NPI',
        path: 'Organization.identifier',
        sliceName: 'NPI',
        patternIdentifier: { system: 'http://hl7.org/fhir/sid/us-npi' },
        constraint: [{
          key: 'us-core-16',
          severity: 'error',
          human: 'NPI must be 10 digits',
          expression: "value.matches('^[0-9]{10}$')",
        }],
      },
      {
        id: 'Organization.identifier:CLIA',
        path: 'Organization.identifier',
        sliceName: 'CLIA',
        patternIdentifier: { system: 'urn:oid:2.16.840.1.113883.4.7' },
        constraint: [{
          key: 'us-core-18',
          severity: 'error',
          human: 'CLIA number must be 10 digits with a letter "D" in third position',
          expression: "value.matches('^[0-9]{2}D[0-9]{7}$')",
        }],
      },
      {
        id: 'Organization.identifier:NAIC',
        path: 'Organization.identifier',
        sliceName: 'NAIC',
        patternIdentifier: { system: 'urn:oid:2.16.840.1.113883.6.300' },
        constraint: [{
          key: 'us-core-19',
          severity: 'error',
          human: 'NAIC must be 5 digits',
          expression: "value.matches('^[0-9]{5}$')",
        }],
      },
    ];

    const issues = await validator.validate(resource, elements, 'test-profile');

    expect(issues.map(issue => issue.ruleId)).toEqual(['us-core-16', 'us-core-18']);
    expect(issues.map(issue => issue.path)).toEqual([
      'Organization.identifier[1]',
      'Organization.identifier[2]',
    ]);
  });

  it('uses child fixed values to identify matching sliced array instances', async () => {
    const validator = new ConstraintValidator();
    const resource = {
      resourceType: 'Organization',
      identifier: [
        {
          system: 'https://www.test.com/fhir/resource/identifier/organization',
          value: 'Organization-Description-SpecialChar',
        },
        {
          system: 'http://hl7.org/fhir/sid/us-npi',
          value: 'Organization-NPI-00023',
        },
        {
          system: 'urn:oid:2.16.840.1.113883.4.7',
          value: 'Organization-CLIA-00023',
        },
      ],
    };

    const elements: ElementDefinition[] = [
      {
        id: 'Organization.identifier:NPI',
        path: 'Organization.identifier',
        sliceName: 'NPI',
        constraint: [{
          key: 'us-core-16',
          severity: 'error',
          human: 'NPI must be 10 digits',
          expression: "value.matches('^[0-9]{10}$')",
        }],
      },
      {
        id: 'Organization.identifier:NPI.system',
        path: 'Organization.identifier.system',
        fixedUri: 'http://hl7.org/fhir/sid/us-npi',
      },
      {
        id: 'Organization.identifier:CLIA',
        path: 'Organization.identifier',
        sliceName: 'CLIA',
        constraint: [{
          key: 'us-core-18',
          severity: 'error',
          human: 'CLIA number must be 10 digits with a letter "D" in third position',
          expression: "value.matches('^[0-9]{2}D[0-9]{7}$')",
        }],
      },
      {
        id: 'Organization.identifier:CLIA.system',
        path: 'Organization.identifier.system',
        fixedUri: 'urn:oid:2.16.840.1.113883.4.7',
      },
    ];

    const issues = await validator.validate(resource, elements, 'test-profile');

    expect(issues.map(issue => issue.ruleId)).toEqual(['us-core-16', 'us-core-18']);
    expect(issues.map(issue => issue.path)).toEqual([
      'Organization.identifier[1]',
      'Organization.identifier[2]',
    ]);
  });

  it('does not apply child constraints from a non-matching parent identifier slice', async () => {
    const validator = new ConstraintValidator();
    const resource = {
      resourceType: 'Patient',
      identifier: [
        {
          type: {
            coding: [{
              system: 'http://fhir.de/CodeSystem/identifier-type-de-basis',
              code: 'GKV',
            }],
          },
          system: 'http://fhir.de/sid/gkv/kvid-10',
          value: 'X234567890',
        },
      ],
    };

    const elements: ElementDefinition[] = [
      {
        id: 'Patient.identifier:versichertennummer_kvk',
        path: 'Patient.identifier',
        sliceName: 'versichertennummer_kvk',
      },
      {
        id: 'Patient.identifier:versichertennummer_kvk.system',
        path: 'Patient.identifier.system',
        fixedUri: 'http://fhir.de/sid/gkv/kvk-versichertennummer',
      },
      {
        id: 'Patient.identifier:versichertennummer_kvk.value',
        path: 'Patient.identifier.value',
        constraint: [{
          key: 'kvk-1',
          severity: 'error',
          human: 'KVK must be numeric',
          expression: "matches('^[0-9]{6,12}$')",
        }],
      },
    ];

    const issues = await validator.validate(resource, elements, 'test-profile');

    expect(issues.map(issue => issue.ruleId)).not.toContain('kvk-1');
  });

  it('requires matching ancestor slices before applying nested slice constraints', async () => {
    const validator = new ConstraintValidator();
    const resource = {
      resourceType: 'Patient',
      address: [{
        type: 'both',
        extension: [{
          url: 'http://example.org/fhir/StructureDefinition/stadtteil',
          valueString: 'Charlottenburg',
        }],
      }],
    };

    const elements: ElementDefinition[] = [
      {
        id: 'Patient.address:Postfach',
        path: 'Patient.address',
        sliceName: 'Postfach',
      },
      {
        id: 'Patient.address:Postfach.type',
        path: 'Patient.address.type',
        patternCode: 'postal',
      },
      {
        id: 'Patient.address:Postfach.extension:Stadtteil',
        path: 'Patient.address.extension',
        sliceName: 'Stadtteil',
        constraint: [{
          key: 'postfach-stadtteil-closed',
          severity: 'error',
          human: 'District extension is not allowed on post box addresses',
          expression: 'url.empty()',
        }],
      },
      {
        id: 'Patient.address:Postfach.extension:Stadtteil.url',
        path: 'Patient.address.extension.url',
        fixedUri: 'http://example.org/fhir/StructureDefinition/stadtteil',
      },
    ];

    const issues = await validator.validate(resource, elements, 'test-profile');

    expect(issues.map(issue => issue.ruleId)).not.toContain('postfach-stadtteil-closed');
  });
});
