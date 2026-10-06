import { describe, expect, it } from 'vitest';
import { applyBestPracticeSeverity } from '../../strictness/best-practice-severity.js';
import { BestPracticeValidator, validateBestPractices } from '../../validators/best-practice-validator.js';
import {
  carryPatientNarrativeOrigins, reconcilePatientNarrativeIssues,
  recordPatientNarrativeOrigins,
} from '../patient-narrative-issue-reconciliation.js';
import {
  canonicalNarrative, generatedNarrative, ownedPair, patientDefinition,
  patientWithoutNarrative, PATIENT_PROFILE,
} from './patient-narrative-fixtures.js';

function governedPair(configured: 'info' | 'warning' | undefined) {
  const raw = ownedPair();
  const before = JSON.stringify(raw);
  const governed = carryPatientNarrativeOrigins([raw], applyBestPracticeSeverity(raw, configured));
  return { raw, before, governed };
}

describe('actual Patient narrative owners after policy', () => {
  it.each([undefined, 'info', 'warning'] as const)(
    'keeps the richer canonical occurrence after %s policy without mutating raw issues', configured => {
      const { raw, before, governed } = governedPair(configured);
      const canonical = governed[0];
      const result = reconcilePatientNarrativeIssues(governed, patientDefinition(), 'R4');
      expect(result).toEqual([canonical]);
      expect(result[0]).toBe(canonical);
      expect(result[0].id).toBe(raw[0].id);
      expect(result[0].details).toBe(raw[0].details);
      expect(result[0]).toMatchObject({ ruleId: 'dom-6', path: 'Patient.text', profile: PATIENT_PROFILE });
      expect(JSON.stringify(raw)).toBe(before);
    },
  );

  it.each(['R4', 'R5'] as const)('recognizes the actual canonical root metadata for %s', release => {
    const { governed } = governedPair(undefined);
    expect(reconcilePatientNarrativeIssues(governed, patientDefinition(release), release)).toEqual([governed[0]]);
  });

  it('does not reconcile before canonical and advisory severities agree', () => {
    const issues = ownedPair();
    expect(reconcilePatientNarrativeIssues(issues, patientDefinition(), 'R4')).toEqual(issues);
  });

  it('preserves a strict error beside the independent advice', () => {
    const raw = ownedPair(canonicalNarrative(true));
    const governed = carryPatientNarrativeOrigins([raw], applyBestPracticeSeverity(raw, 'warning'));
    expect(governed[0]).toMatchObject({ severity: 'error', details: { escalated: true } });
    expect(reconcilePatientNarrativeIssues(governed, patientDefinition(), 'R4')).toEqual(governed);
  });

  it('requires both actual owner receipts, even for copied lookalike fields', () => {
    const canonical = canonicalNarrative();
    const generated = generatedNarrative();
    for (const selected of [{ canonical: [canonical] }, { generated: [generated] }, {}]) {
      const raw = recordPatientNarrativeOrigins([canonical, generated], selected);
      const governed = carryPatientNarrativeOrigins([raw], applyBestPracticeSeverity(raw, 'warning'));
      expect(reconcilePatientNarrativeIssues(governed, patientDefinition(), 'R4')).toHaveLength(2);
    }
  });

  it('keeps each enabled owner when the other owner is absent', () => {
    for (const selected of [canonicalNarrative(), generatedNarrative()]) {
      const issues = recordPatientNarrativeOrigins([selected], { canonical: [selected], generated: [selected] });
      expect(reconcilePatientNarrativeIssues(issues, patientDefinition(), 'R4')).toEqual([selected]);
    }
    expect(validateBestPractices(new BestPracticeValidator(), {
      resource: patientWithoutNarrative, resourceType: 'Patient', profileUrl: PATIENT_PROFILE,
    }, { enableBestPracticeChecks: false })).toEqual([]);
  });

  it('carries only surviving IDs through policy arrays and never invents ownership', () => {
    const raw = ownedPair();
    const replacements = raw.map(issue => ({ ...issue, id: `replacement-${issue.id}`, severity: 'warning' as const }));
    const carried = carryPatientNarrativeOrigins([raw], replacements);
    expect(reconcilePatientNarrativeIssues(carried, patientDefinition(), 'R4')).toHaveLength(2);
    expect(reconcilePatientNarrativeIssues(applyBestPracticeSeverity(ownedPair(), 'warning'), patientDefinition(), 'R4'))
      .toHaveLength(2);
  });

  it('retains the existing empty-versus-whitespace recommendation semantics', () => {
    const validator = new BestPracticeValidator();
    for (const [div, count] of [['', 1], ['   ', 0], ['<div xmlns="http://www.w3.org/1999/xhtml">Test</div>', 0]] as const) {
      const result = validator.validate({
        resource: { ...patientWithoutNarrative, text: { status: 'generated', div } },
        resourceType: 'Patient', profileUrl: PATIENT_PROFILE,
      });
      expect(result.filter(issue => issue.code === 'dom-6')).toHaveLength(count);
    }
  });
});
