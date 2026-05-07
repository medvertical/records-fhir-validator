import { describe, expect, it } from 'vitest';
import { ConstraintValidator } from '../constraint-validator';
import type { ElementDefinition } from '../../core/structure-definition-types';

describe('ConstraintValidator slice constraints', () => {
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
});
