import { describe, expect, it } from 'vitest';
import { dedupeIssues, getValueAtPath, suppressRedundantBindingWarnings } from '../validation-utils';
import type { ValidationIssue } from '../../types';

function issue(overrides: Partial<ValidationIssue>): ValidationIssue {
  return {
    id: Math.random().toString(36),
    aspect: 'profile',
    severity: 'error',
    code: 'profile-slice-min-cardinality',
    message: 'missing slice',
    path: 'Observation.referenceRange',
    timestamp: new Date(),
    ...overrides,
  } as ValidationIssue;
}

describe('dedupeIssues', () => {
  it('preserves distinct slice issues on the same path', () => {
    const deduped = dedupeIssues([
      issue({ ruleId: 'slice-min-Slice1', details: { sliceName: 'Slice1' } }),
      issue({ ruleId: 'slice-min-Slice2', details: { sliceName: 'Slice2' } }),
      issue({ ruleId: 'slice-min-Slice1', details: { sliceName: 'Slice1' } }),
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map(i => i.ruleId)).toEqual([
      'slice-min-Slice1',
      'slice-min-Slice2',
    ]);
  });

  it('preserves same slice issues that originate from different imposed profiles', () => {
    const deduped = dedupeIssues([
      issue({
        ruleId: 'slice-min-composition-conformance',
        path: 'Bundle',
        details: {
          sliceName: 'composition',
          sourceProfile: 'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
        },
      }),
      issue({
        ruleId: 'slice-min-composition-conformance',
        path: 'Bundle',
        details: {
          sliceName: 'composition',
          sourceProfile: 'http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips',
        },
      }),
    ]);

    expect(deduped).toHaveLength(2);
  });

  it('dedupes equivalent resource-prefixed and relative paths', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'terminology-code-invalid',
        severity: 'warning',
        path: 'Organization.meta.tag',
        resourceType: 'Organization',
        details: { resourceType: 'Organization' },
      }),
      issue({
        code: 'terminology-code-invalid',
        severity: 'warning',
        path: 'meta.tag',
        resourceType: 'Organization',
        details: { resourceType: 'Organization' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
  });

  it('dedupes generic and concrete choice-type paths on resources', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'terminology-coding-missing-system',
        path: 'MedicationRequest.medication[x].coding',
        resourceType: 'MedicationRequest',
        message: 'Coding has no system',
      }),
      issue({
        code: 'terminology-coding-missing-system',
        path: 'MedicationRequest.medicationCodeableConcept.coding',
        resourceType: 'MedicationRequest',
        message: 'Coding has no system',
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].path).toBe('MedicationRequest.medication[x].coding');
  });

  it('dedupes generic and concrete choice-type paths in bundle entries', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'terminology-coding-missing-system',
        path: 'Bundle.entry.resource/*MedicationDispense/d1*/.medication[x].coding',
        resourceType: 'Bundle',
        message: 'Coding has no system',
      }),
      issue({
        code: 'terminology-coding-missing-system',
        path: 'Bundle.entry.resource/*MedicationDispense/d1*/.medicationCodeableConcept.coding',
        resourceType: 'Bundle',
        message: 'Coding has no system',
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].path).toBe('Bundle.entry.resource/*MedicationDispense/d1*/.medication[x].coding');
  });

  it('suppresses generic constraint issues when a specific constraint issue exists', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'constraint-violation-us-core-7',
        path: 'Procedure',
        resourceType: 'Procedure',
        message: 'Procedure performed is required',
      }),
      issue({
        code: 'profile-constraint-violation',
        path: 'Procedure',
        resourceType: 'Procedure',
        message: "Constraint 'us-core-7' failed",
        ruleId: 'us-core-7',
        details: { constraintKey: 'us-core-7' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('constraint-violation-us-core-7');
  });

  it('suppresses generic profile constraints when a specific invariant violation code exists', () => {
    const deduped = dedupeIssues([
      issue({
        aspect: 'invariant',
        code: 'pat-1-violation',
        severity: 'error',
        path: 'Patient.contact[0]',
        resourceType: 'Patient',
        message: 'pat-1: contact SHALL have at least one of name, telecom, address, or organization',
      }),
      issue({
        aspect: 'profile',
        code: 'profile-constraint-violation',
        severity: 'error',
        path: 'Patient.contact[0]',
        resourceType: 'Patient',
        message: "Constraint 'pat-1' failed",
        ruleId: 'pat-1',
        details: { constraintKey: 'pat-1', fieldPath: 'Patient.contact[0]' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('pat-1-violation');
  });

  it('suppresses generic warning constraints when a specific constraint issue exists', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'constraint-violation-us-core-1',
        severity: 'warning',
        path: 'Condition',
        resourceType: 'Condition',
        message: 'Condition category should be US Core',
        ruleId: 'us-core-1',
      }),
      issue({
        code: 'profile-constraint-warning',
        severity: 'information',
        path: 'Condition',
        resourceType: 'Condition',
        message: "Constraint 'us-core-1' failed",
        ruleId: 'us-core-1',
        details: { constraintKey: 'us-core-1' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('constraint-violation-us-core-1');
  });

  it('suppresses generic dom-6 root warnings when the concrete dom-6 issue exists', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'dom-6',
        severity: 'info',
        path: 'Patient.text',
        resourceType: 'Patient',
        message: 'A resource should have narrative for robust management',
      }),
      issue({
        code: 'profile-constraint-warning',
        severity: 'info',
        path: 'Patient',
        resourceType: 'Patient',
        message: "Constraint 'dom-6' failed: A resource should have narrative for robust management",
        ruleId: 'dom-6',
        details: { constraintKey: 'dom-6' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('dom-6');
  });

  it('keeps generic dom-6 warnings for distinct bundle entries', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'dom-6',
        severity: 'info',
        path: 'Bundle.entry.resource/*Patient/p1*/.text',
        resourceType: 'Bundle',
        message: 'A resource should have narrative for robust management',
      }),
      issue({
        code: 'profile-constraint-warning',
        severity: 'info',
        path: 'Bundle.entry.resource/*Patient/p1*/',
        resourceType: 'Bundle',
        message: "Constraint 'dom-6' failed: A resource should have narrative for robust management",
        ruleId: 'dom-6',
        details: { constraintKey: 'dom-6' },
      }),
      issue({
        code: 'profile-constraint-warning',
        severity: 'info',
        path: 'Bundle.entry.resource/*Condition/c1*/',
        resourceType: 'Bundle',
        message: "Constraint 'dom-6' failed: A resource should have narrative for robust management",
        ruleId: 'dom-6',
        details: { constraintKey: 'dom-6' },
      }),
    ]);

    expect(deduped.map(i => i.path)).toEqual([
      'Bundle.entry.resource/*Patient/p1*/.text',
      'Bundle.entry.resource/*Condition/c1*/',
    ]);
  });

  it('dedupes specific constraint issues when ruleId is missing on one copy', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'constraint-violation-us-core-1',
        severity: 'warning',
        path: 'Condition',
        resourceType: 'Condition',
        message: 'Condition category should be US Core',
        ruleId: 'us-core-1',
      }),
      issue({
        code: 'constraint-violation-us-core-1',
        severity: 'warning',
        path: 'Condition',
        resourceType: 'Condition',
        message: 'Condition category should be US Core',
        ruleId: undefined,
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].ruleId).toBe('us-core-1');
  });

  it('prefers the explicit German gender extension issue over mii-pat-1 constraints', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'constraint-violation-mii-pat-1',
        path: 'Patient',
        resourceType: 'Patient',
      }),
      issue({
        code: 'profile-constraint-violation',
        path: 'Patient',
        resourceType: 'Patient',
        ruleId: 'mii-pat-1',
        details: { constraintKey: 'mii-pat-1' },
      }),
      issue({
        code: 'profile-extension-missing',
        path: 'Patient.gender',
        resourceType: 'Patient',
        details: {
          expectedExtension: 'http://fhir.de/StructureDefinition/gender-amtlich-de',
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('profile-extension-missing');
  });

  it('suppresses required and mustSupport copies when cardinality min already reports the same path', () => {
    const deduped = dedupeIssues([
      issue({
        code: 'structural-cardinality-min',
        path: 'Patient.identifier.system',
        resourceType: 'Patient',
        details: { fieldPath: 'Patient.identifier.system' },
      }),
      issue({
        code: 'structural-required-element-missing',
        path: 'Patient.identifier[0].system',
        resourceType: 'Patient',
        details: { fieldPath: 'Patient.identifier[0].system' },
      }),
      issue({
        code: 'structural-required-element-missing',
        path: 'Patient.identifier[0]:memberid.system',
        resourceType: 'Patient',
        details: { fieldPath: 'Patient.identifier[0]:memberid.system' },
      }),
      issue({
        code: 'profile-mustsupport-missing',
        path: 'Patient.identifier.system',
        resourceType: 'Patient',
        details: { fieldPath: 'Patient.identifier.system' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('structural-cardinality-min');
  });

  it('prefers profile extension minimum issues over generic structural extension cardinality', () => {
    const deduped = dedupeIssues([
      issue({
        aspect: 'structural',
        code: 'structural-cardinality-min',
        path: 'ServiceRequest.extension',
        resourceType: 'ServiceRequest',
        details: { fieldPath: 'ServiceRequest.extension' },
      }),
      issue({
        aspect: 'profile',
        code: 'profile-extension-min-cardinality',
        path: 'ServiceRequest.extension',
        resourceType: 'ServiceRequest',
        message: "extension 'http://hl7.org.au/fhir/ereq/StructureDefinition/au-erequesting-displaysequence' requires at least 1 instance(s), found 0",
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('profile-extension-min-cardinality');
  });

  it('prefers profile slice minimum issues over generic structural cardinality', () => {
    const deduped = dedupeIssues([
      issue({
        aspect: 'structural',
        code: 'structural-cardinality-min',
        path: 'Bundle.entry[0].resource/*Composition*/.section',
        resourceType: 'Bundle',
        details: {
          fieldPath: 'Bundle.entry[0].resource/*Composition*/.section',
        },
      }),
      issue({
        aspect: 'profile',
        code: 'profile-slice-min-cardinality',
        path: 'Bundle.entry[0].resource/*Composition*/.section',
        resourceType: 'Bundle',
        details: {
          fieldPath: 'Bundle.entry[0].resource/*Composition*/.section',
        },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('profile-slice-min-cardinality');
  });

  it('prefers ref-1 invariant errors over duplicate structural reference format warnings', () => {
    const path = 'Bundle.entry[7].resource/*Claim/c1*/.provider.reference';
    const deduped = dedupeIssues([
      issue({
        aspect: 'invariant',
        code: 'ref-1-violation',
        severity: 'error',
        path,
        resourceType: 'Claim',
        details: { fieldPath: path },
      }),
      issue({
        aspect: 'structural',
        code: 'reference-invalid-format',
        severity: 'warning',
        path,
        resourceType: 'Claim',
        details: { fieldPath: path, reference: 'provider-1' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('ref-1-violation');
  });

  it('prefers structural invalid URI issues over duplicate terminology not-found warnings on the same system path', () => {
    const path = 'Condition.clinicalStatus.coding[0].system';
    const deduped = dedupeIssues([
      issue({
        aspect: 'structural',
        code: 'structural-invalid-uri',
        severity: 'error',
        path,
        resourceType: 'Condition',
        details: { fieldPath: path, value: 'idk' },
      }),
      issue({
        aspect: 'terminology',
        code: 'not-found',
        severity: 'warning',
        path,
        resourceType: 'Condition',
        details: { fieldPath: path },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('structural-invalid-uri');
  });

  it('matches structural invalid URI and terminology not-found across choice-type path aliases', () => {
    const structuralPath = 'MedicationRequest.medicationCodeableConcept.coding[0].system';
    const terminologyPath = 'MedicationRequest.medication[x].coding[0].system';
    const deduped = dedupeIssues([
      issue({
        aspect: 'structural',
        code: 'structural-invalid-uri',
        severity: 'error',
        path: structuralPath,
        resourceType: 'MedicationRequest',
        details: { fieldPath: structuralPath, value: 'Metaformin' },
      }),
      issue({
        aspect: 'terminology',
        code: 'not-found',
        severity: 'warning',
        path: terminologyPath,
        resourceType: 'MedicationRequest',
        details: { fieldPath: terminologyPath },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('structural-invalid-uri');
  });

  it('keeps the stronger contained-resource invariant over contained-unreferenced warnings', () => {
    const deduped = dedupeIssues([
      issue({
        aspect: 'structural',
        code: 'invalid',
        severity: 'error',
        path: 'Patient.contained[0]',
        resourceType: 'Patient',
        message: "The contained resource 'covert' is not referenced to from elsewhere in the containing resource",
        details: { fieldPath: 'Patient.contained[0]' },
      }),
      issue({
        aspect: 'invariant',
        code: 'contained-unreferenced',
        severity: 'warning',
        path: 'Patient.contained',
        resourceType: 'Patient',
        message: "Contained resource 'covert' is not referenced",
        details: { fieldPath: 'Patient.contained' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('invalid');
  });

  it('keeps required binding violations over redundant AllergyIntolerance presence invariants', () => {
    const path = 'AllergyIntolerance.clinicalStatus';
    const deduped = dedupeIssues([
      issue({
        aspect: 'invariant',
        code: 'ait-1-violation',
        severity: 'error',
        path,
        resourceType: 'AllergyIntolerance',
        message: 'ait-1: AllergyIntolerance.clinicalStatus SHALL be present',
        details: { fieldPath: path },
      }),
      issue({
        aspect: 'profile',
        code: 'profile-required-binding-violation',
        severity: 'error',
        path,
        resourceType: 'AllergyIntolerance',
        message: 'Value does not satisfy required binding',
        details: { fieldPath: path, textValue: 'active' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('profile-required-binding-violation');
  });

  it('keeps extension no-value issues over generic ext-1 constraint rows', () => {
    const path = 'Encounter.extension[2].extension[1]';
    const deduped = dedupeIssues([
      issue({
        aspect: 'structural',
        code: 'profile-constraint-violation',
        severity: 'error',
        path,
        resourceType: 'Extension',
        message: 'ext-1 violation: Extension must have either extensions or value[x]',
        details: { fieldPath: path, constraintKey: 'ext-1' },
      }),
      issue({
        aspect: 'profile',
        code: 'profile-extension-no-value',
        severity: 'error',
        path,
        resourceType: 'Encounter',
        message: "Extension 'valor' must have either a value or nested extensions",
        details: { fieldPath: path, url: 'valor' },
      }),
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].code).toBe('profile-extension-no-value');
  });
});

describe('getValueAtPath', () => {
  it('treats primitive sidecar extensions as present values', () => {
    const patient = {
      resourceType: 'Patient',
      identifier: [{
        system: 'http://fhir.de/sid/gkv/kvid-10',
        _value: {
          extension: [{
            url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
            valueCode: 'masked',
          }],
        },
      }],
    };

    expect(getValueAtPath(patient, 'Patient.identifier.value')).toEqual({
      extension: [{
        url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
        valueCode: 'masked',
      }],
    });
  });

  it('resolves primitive choice sidecars for value[x] paths', () => {
    const observation = {
      resourceType: 'Observation',
      _valueString: {
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
          valueCode: 'unknown',
        }],
      },
    };

    expect(getValueAtPath(observation, 'Observation.value[x]')).toEqual({
      extension: [{
        url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
        valueCode: 'unknown',
      }],
    });
  });
});

describe('suppressRedundantBindingWarnings', () => {
  it('suppresses missing required binding issues when structural min cardinality already reports the same path', () => {
    const structuralIssue = issue({
      aspect: 'structural',
      code: 'structural-cardinality-min',
      path: 'Encounter.status',
      message: 'Element Encounter.status has too few values: expected at least 1, found 0',
    });
    const terminologyIssue = issue({
      aspect: 'terminology',
      code: 'binding-required-missing',
      path: 'Encounter.status',
      message: "Required binding for 'Encounter.status' is missing (binding strength: required)",
    });

    expect(suppressRedundantBindingWarnings([
      structuralIssue,
      terminologyIssue,
    ])).toEqual([structuralIssue]);
  });
});
