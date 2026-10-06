import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { NarrativeValidator } from '../../validators/narrative-validator.js';
import { normalizeIssuesByAspect } from '../multi-aspect-issue-normalization.js';
import { carryPatientNarrativeOrigins, recordPatientNarrativeOrigins } from '../patient-narrative-issue-reconciliation.js';
import { dedupeIssuesWithTrace } from '../validation-issue-dedupe.js';
import {
  canonicalNarrative, generatedNarrative, narrativeDetails,
  PATIENT_PROFILE, patientDefinition, patientWithoutNarrative,
} from './patient-narrative-fixtures.js';

function missingDiv(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  const returned = new NarrativeValidator().validateNarrative({
    ...patientWithoutNarrative, text: { status: 'generated' },
  }, 'Patient');
  const actual = returned.find(issue => issue.code === 'narrative-missing-div');
  if (!actual) throw new Error('The actual narrative owner must report the missing div');
  return { ...actual, profile: PATIENT_PROFILE, ...overrides };
}

function expectRetained(issues: ValidationIssue[]): void {
  const before = JSON.stringify(issues);
  const result = dedupeIssuesWithTrace(issues);
  expect(result.issues).toEqual(issues);
  result.issues.forEach((issue, index) => expect(issue).toBe(issues[index]));
  expect(result.suppressions.some(row => row.ruleId === 'narrative-text-over-dom6')).toBe(false);
  expect(JSON.stringify(issues)).toBe(before);
}

interface BoundaryCase {
  label: string;
  issue: () => ValidationIssue;
  missing?: () => ValidationIssue;
  owner?: 'generated' | 'canonical';
  loseReceipt?: boolean;
}

const boundaries: BoundaryCase[] = [
  { label: 'a different profile constraint expression', owner: 'canonical', issue: () => {
    const actual = canonicalNarrative();
    return { ...actual, details: { ...narrativeDetails(actual), expression: 'text.exists()' } };
  } },
  { label: 'a different constraint source signal', owner: 'canonical', issue: () => {
    const actual = canonicalNarrative();
    return { ...actual, details: { ...narrativeDetails(actual), source: 'https://example.org/custom' } };
  } },
  { label: 'a different constraint profile', owner: 'canonical', issue: () => ({
    ...canonicalNarrative(), profile: 'https://example.org/custom-patient',
  }) },
  { label: 'a strict canonical error', owner: 'canonical', issue: () => canonicalNarrative(true) },
  { label: 'a canonical warning', owner: 'canonical', issue: () => canonicalNarrative() },
  { label: 'an unowned generated lookalike', issue: () => generatedNarrative() },
  { label: 'a generator receipt lost through a plain array copy', owner: 'generated', loseReceipt: true, issue: () => generatedNarrative() },
  { label: 'a generated row governed to error', owner: 'generated', issue: () => ({ ...generatedNarrative(), severity: 'error' }) },
  { label: 'a generated row governed to fatal', owner: 'generated', issue: () => ({ ...generatedNarrative(), severity: 'fatal' }) },
  { label: 'an explicit policy message override', owner: 'generated', issue: () => ({ ...generatedNarrative(), message: 'A separate policy explanation' }) },
  { label: 'a missing div under a different profile', owner: 'generated', issue: () => generatedNarrative(),
    missing: () => missingDiv({ profile: 'https://example.org/other-patient' }) },
  { label: 'a missing div on a different resource type', owner: 'generated', issue: () => generatedNarrative(),
    missing: () => missingDiv({ resourceType: 'Condition', path: 'Condition.text' }) },
];

describe('Missing div suppression respects actual Patient narrative ownership', () => {
  it.each(boundaries)('retains $label', boundary => {
    const issue = boundary.issue();
    const missing = boundary.missing?.() ?? missingDiv();
    const issues = recordPatientNarrativeOrigins([issue, missing], {
      generated: boundary.owner === 'generated' ? [issue] : [],
      canonical: boundary.owner === 'canonical' ? [issue] : [],
    });
    expectRetained(boundary.loseReceipt ? [...issues] : issues);
  });

  it.each(['information', 'info', 'warning'] as const)(
    'suppresses only a real generated %s row at the same occurrence', severity => {
      const generated = { ...generatedNarrative(), severity };
      const missing = missingDiv();
      for (const ordered of [[generated, missing], [missing, generated]]) {
        const issues = recordPatientNarrativeOrigins(ordered, { generated: [generated] });
        const before = JSON.stringify(issues);
        const result = dedupeIssuesWithTrace(issues);
        expect(result.issues).toEqual([missing]);
        expect(result.issues[0]).toBe(missing);
        expect(result.suppressions).toEqual([{ ruleId: 'narrative-text-over-dom6', issue: generated }]);
        expect(result.suppressions[0].issue).toBe(generated);
        expect(JSON.stringify(issues)).toBe(before);
      }
    },
  );

  it('retains distinct indexed resource occurrences', () => {
    const generated = { ...generatedNarrative(), path: 'Bundle.entry[1].resource/Patient.text' };
    const missing = missingDiv({ path: 'Bundle.entry[0].resource/Patient.text' });
    expectRetained(recordPatientNarrativeOrigins([generated, missing], { generated: [generated] }));
  });

  it('retains ambiguous shared canonical and generated ownership', () => {
    const generated = generatedNarrative();
    expectRetained(recordPatientNarrativeOrigins([generated, missingDiv()], {
      generated: [generated], canonical: [generated],
    }));
  });

  it('retains a conflicting concrete details path', () => {
    const generated = generatedNarrative();
    expectRetained(recordPatientNarrativeOrigins([
      generated, missingDiv({ details: { fieldPath: 'Patient.contained[0].text' } }),
    ], { generated: [generated] }));
  });

  it('retains generated advice without a concrete missing-div finding', () => {
    const generated = generatedNarrative();
    expectRetained(recordPatientNarrativeOrigins([generated], { generated: [generated] }));
  });

  it('retains a custom business rule with its actual distinct issue code', () => {
    const custom: ValidationIssue = {
      ...canonicalNarrative(true), code: 'custom-rule-violation', aspect: 'custom_rule',
      ruleId: 'dom-6', path: 'Patient.text',
    };
    expectRetained([custom, missingDiv()]);
  });

  it('keeps batch invalidity when a separate hard dom-6 fails beside capped narrative output', () => {
    const canonical = canonicalNarrative(true);
    const missing = missingDiv({ severity: 'information' });
    const raw = recordPatientNarrativeOrigins([canonical, missing], { canonical: [canonical] });
    const published = carryPatientNarrativeOrigins([raw], [...raw]);
    const aspects = normalizeIssuesByAspect([{
      aspect: 'structural', validationTime: 0, isValid: false,
      issues: published, evidenceIssues: raw,
    }], patientDefinition(), 'R4');
    expect(aspects.flatMap(aspect => aspect.issues)).toContain(canonical);
    expect(aspects.every(aspect => aspect.isValid)).toBe(false);
    expect(aspects.flatMap(aspect => aspect.evidenceIssues ?? [])).toEqual(raw);
  });
});
