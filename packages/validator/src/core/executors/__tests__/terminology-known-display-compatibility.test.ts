import { describe, expect, it } from 'vitest';
import { buildCodeSystemResultIssues } from '../terminology-code-system-result-issues';

describe('remote display validation and known historical designations', () => {
  it('still reports a SNOMED display rejected by authoritative terminology validation', () => {
    expect(buildCodeSystemResultIssues({
      system: 'http://snomed.info/sct', code: '322236009', display: 'Unrelated medicine',
    }, {
      valid: false, reason: 'display-mismatch', display: 'Acetaminophen 500 mg oral tablet',
      issues: [{ code: 'invalid-display', severity: 'error', message: 'Wrong display' }],
    }, 'Medication.code.coding', 0, true)).toContainEqual(expect.objectContaining({
      code: 'terminology-display-mismatch',
    }));
  });

  const result = { valid: false, reason: 'display-mismatch' as const,
    display: 'Hospital discharge procedure note',
    issues: [{ code: 'invalid-display', severity: 'error' as const, message: 'Wrong display' }],
  };
  const coding = { system: 'http://loinc.org', code: '10185-7', display: 'Hospital discharge procedures Narrative' };

  it('accepts a verified historical designation for an unversioned coding', () => {
    expect(buildCodeSystemResultIssues(coding, result, 'Composition.section.code.coding', 0, true)).toEqual([]);
  });

  it('preserves the rejection when the coding explicitly pins the newer edition', () => {
    expect(buildCodeSystemResultIssues({ ...coding, version: '2.82' }, result,
      'Composition.section.code.coding', 0, true)).toContainEqual(expect.objectContaining({
      code: 'terminology-display-mismatch',
    }));
  });

  it('preserves a clinically different display', () => {
    expect(buildCodeSystemResultIssues({ ...coding, display: 'Hospital admission diagnoses' }, result,
      'Composition.section.code.coding', 0, true)).toContainEqual(expect.objectContaining({
      code: 'terminology-display-mismatch',
    }));
  });
});
