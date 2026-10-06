import type { ValidationIssue } from '@records-fhir/validation-types';
import { BestPracticeValidator } from '../../validators/best-practice-validator.js';
import { buildConstraintViolationIssue } from '../../validators/constraint-violation-issue.js';
import type { Constraint, StructureDefinition } from '../structure-definition-types.js';
import { recordPatientNarrativeOrigins } from '../patient-narrative-issue-reconciliation.js';

export const PATIENT_PROFILE = 'http://hl7.org/fhir/StructureDefinition/Patient';
export const DOMAIN_PROFILE = 'http://hl7.org/fhir/StructureDefinition/DomainResource';
export const NARRATIVE_EXPRESSION = 'text.`div`.exists()';
export const patientWithoutNarrative = {
  resourceType: 'Patient', id: 'narrative-test',
  identifier: [{ system: 'urn:example:narrative', value: '123' }],
  name: [{ family: 'Test' }],
};
export const narrativeConstraint: Constraint = {
  key: 'dom-6', severity: 'warning',
  human: 'A resource should have narrative for robust management',
  expression: NARRATIVE_EXPRESSION, source: DOMAIN_PROFILE,
};

export function patientDefinition(release: 'R4' | 'R5' = 'R4'): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: PATIENT_PROFILE, name: 'Patient',
    status: 'active', kind: 'resource', abstract: false, type: 'Patient',
    fhirVersion: release === 'R4' ? '4.0.1' : '5.0.0',
    snapshot: { element: [{ id: 'Patient', path: 'Patient', constraint: [{ ...narrativeConstraint }] }] },
  };
}

export function canonicalNarrative(strict = false): ValidationIssue {
  return buildConstraintViolationIssue(
    patientWithoutNarrative, 'Patient', narrativeConstraint, PATIENT_PROFILE,
    strict ? 'strict' : 'standard',
  );
}

export function generatedNarrative(): ValidationIssue {
  const issues = new BestPracticeValidator().validate({
    resource: patientWithoutNarrative, resourceType: 'Patient', profileUrl: PATIENT_PROFILE,
  });
  const issue = issues.find(candidate => candidate.code === 'dom-6');
  if (!issue) throw new Error('Real Patient best-practice owner must produce narrative advice');
  return issue;
}

export function ownedPair(
  canonical = canonicalNarrative(), generated = generatedNarrative(),
): ValidationIssue[] {
  return recordPatientNarrativeOrigins([canonical, generated], {
    canonical: [canonical], generated: [generated],
  });
}

export function narrativeDetails(issue: ValidationIssue): Record<string, unknown> {
  if (!issue.details || typeof issue.details !== 'object' || Array.isArray(issue.details)) {
    throw new Error('The actual narrative owner must supply object details');
  }
  return issue.details;
}
