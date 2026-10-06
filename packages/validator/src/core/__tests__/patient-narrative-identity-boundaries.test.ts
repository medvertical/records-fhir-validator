import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { applyBestPracticeSeverity } from '../../strictness/best-practice-severity.js';
import {
  carryPatientNarrativeOrigins, reconcilePatientNarrativeIssues,
} from '../patient-narrative-issue-reconciliation.js';
import { dedupeExactIssues, dedupeIssues, dedupeResourceTreeIssues } from '../validation-issue-dedupe.js';
import { canonicalNarrative, generatedNarrative, narrativeDetails, ownedPair, patientDefinition } from './patient-narrative-fixtures.js';

function publishedPair(canonical = canonicalNarrative(), generated = generatedNarrative()) {
  const raw = ownedPair(canonical, generated);
  return carryPatientNarrativeOrigins([raw], applyBestPracticeSeverity(raw, 'warning'));
}

function expectIndependent(canonical: ValidationIssue, generated = generatedNarrative()) {
  const published = publishedPair(canonical, generated);
  expect(reconcilePatientNarrativeIssues(published, patientDefinition(), 'R4')).toEqual(published);
}

describe('Patient narrative identity boundaries', () => {
  it.each([
    ['custom expression', { details: { expression: 'text.exists()', constraintKey: 'dom-6', originalSeverity: 'warning' } }],
    ['custom constraint source', { details: { expression: 'text.`div`.exists()', constraintKey: 'dom-6', originalSeverity: 'warning', source: 'https://example.org/custom' } }],
    ['different policy message', { message: 'A separate policy explanation' }],
    ['different profile', { profile: 'https://example.org/custom-patient' }],
    ['missing profile', { profile: undefined }],
    ['nested occurrence', { path: 'Bundle.entry[0].resource/Patient.text' }],
    ['different rule owner', { ruleId: 'custom-dom-6' }],
    ['different resource type', { resourceType: 'Condition', path: 'Condition.text' }],
  ] satisfies Array<[string, Partial<ValidationIssue>]>)(
    'preserves %s beside actual generated advice', (_label, changed) => {
      expectIndependent({ ...canonicalNarrative(), ...changed });
    },
  );

  it('preserves two nested lookalikes even with matching nested paths', () => {
    const path = 'Bundle.entry[0].resource/Patient.text';
    expectIndependent({ ...canonicalNarrative(), path }, { ...generatedNarrative(), path });
  });

  it.each(['expression', 'source', 'human', 'severity'] as const)(
    'requires the selected definition to retain canonical %s', field => {
      const definition = patientDefinition();
      const constraint = definition.snapshot!.element[0].constraint![0];
      if (field === 'severity') constraint.severity = 'error';
      else constraint[field] = 'custom';
      const issues = publishedPair();
      expect(reconcilePatientNarrativeIssues(issues, definition, 'R4')).toEqual(issues);
    },
  );

  it('requires one known root constraint and a supported selected version', () => {
    const missing = patientDefinition();
    missing.snapshot!.element[0].constraint = [];
    const multiple = patientDefinition();
    multiple.snapshot!.element[0].constraint!.push({ ...multiple.snapshot!.element[0].constraint![0] });
    const unknown = patientDefinition();
    delete unknown.fhirVersion;
    const wrongVersion = patientDefinition();
    wrongVersion.fhirVersion = '6.0.0';
    for (const definition of [missing, multiple, unknown, wrongVersion, undefined]) {
      const issues = publishedPair();
      expect(reconcilePatientNarrativeIssues(issues, definition, 'R4')).toEqual(issues);
    }
    const issues = publishedPair();
    expect(reconcilePatientNarrativeIssues(issues, wrongVersion, 'R4')).toEqual(issues);
    expect(reconcilePatientNarrativeIssues(issues, patientDefinition(), 'R6')).toEqual(issues);
    expect(reconcilePatientNarrativeIssues(issues, patientDefinition('R5'), 'R4')).toEqual(issues);
    expect(reconcilePatientNarrativeIssues(issues, patientDefinition(), undefined)).toEqual(issues);
  });

  it.each([undefined, null, 4, '', 'R4', '4.bad', '5.bad', '7.0.0'])(
    'preserves advice for unknown or malformed selected version %s even with an explicit request', version => {
      for (const release of ['R4', 'R5'] as const) {
        const definition = patientDefinition(release);
        definition.fhirVersion = version;
        const issues = publishedPair();
        expect(reconcilePatientNarrativeIssues(issues, definition, release)).toEqual(issues);
      }
    },
  );

  it('accepts source-less normative DomainResource but preserves source-less custom Patient', () => {
    const definition = patientDefinition();
    delete definition.snapshot!.element[0].constraint![0].source;
    const issues = publishedPair();
    expect(reconcilePatientNarrativeIssues(issues, definition, 'R4')).toEqual(issues);
    definition.url = 'http://hl7.org/fhir/StructureDefinition/DomainResource';
    definition.type = 'DomainResource';
    definition.snapshot!.element[0].path = 'DomainResource';
    expect(reconcilePatientNarrativeIssues(issues, definition, 'R4')).toEqual([issues[0]]);
  });

  it('keeps Condition and Observation canonical warnings independently', () => {
    for (const resourceType of ['Condition', 'Observation']) {
      const canonical = { ...canonicalNarrative(), resourceType, path: `${resourceType}.text` };
      const issues = publishedPair(canonical);
      const definition = patientDefinition();
      definition.type = resourceType;
      definition.snapshot!.element[0].path = resourceType;
      expect(reconcilePatientNarrativeIssues(issues, definition, 'R4')).toEqual(issues);
    }
  });
});

describe('dom-6 dedupe preserves distinct findings', () => {
  it.each([dedupeIssues, dedupeExactIssues, dedupeResourceTreeIssues])(
    'retains changed expression, source, profile, aspect and occurrence with %s', dedupe => {
      const original = canonicalNarrative();
      const variants: ValidationIssue[] = [
        original,
        { ...original, id: 'expression', details: { ...narrativeDetails(original), expression: 'text.exists()' } },
        { ...original, id: 'source', details: { ...narrativeDetails(original), source: 'https://example.org/custom' } },
        { ...original, id: 'profile', profile: 'https://example.org/custom-patient' },
        { ...original, id: 'aspect', aspect: 'profile' },
        { ...original, id: 'nested-one', path: 'Bundle.entry[0].resource/Patient.text' },
        { ...original, id: 'nested-two', path: 'Bundle.entry[1].resource/Patient.text' },
        { ...original, id: 'contained-one', path: 'Patient.contained[0].text' },
        { ...original, id: 'contained-two', path: 'Patient.contained[1].text' },
      ];
      const before = JSON.stringify(variants);
      expect(dedupe(variants)).toEqual(variants);
      expect(JSON.stringify(variants)).toBe(before);
      expect(dedupe([original, { ...original, id: 'exact-copy' }])).toEqual([original]);
    },
  );
});
