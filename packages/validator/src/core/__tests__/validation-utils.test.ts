import { describe, expect, it } from 'vitest';
import { dedupeIssues } from '../validation-utils';
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
});
