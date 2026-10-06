import { describe, expect, it } from 'vitest';
import { buildCodeSystemResultIssues } from '../terminology-code-system-result-issues';
import type { CodeSystemValidationResult } from '../../../validators/terminology-api-types';

const coding = { system: 'http://loinc.org', code: '11369-6', display: 'History of Immunization Narrative' };
const result: CodeSystemValidationResult = {
  valid: false, reason: 'display-mismatch', display: 'History of Immunization note',
  issues: [{ code: 'invalid-display', severity: 'error', message: 'Wrong display for the resolved edition' }],
};
const validate = (response: CodeSystemValidationResult, display = coding.display, version?: string) => (
  buildCodeSystemResultIssues({ ...coding, display, ...(version ? { version } : {}) },
    response, 'Observation.code.coding', 0, true)
);

describe('resolved CodeSystem display authority', () => {
  it.each([undefined, '2.77', '2.82'])('keeps an explicit rejection with coding version %s', version => {
    expect(validate(result, coding.display, version)).toEqual([expect.objectContaining({
      code: 'terminology-display-mismatch', severity: 'error',
      path: 'Observation.code.coding[0].display',
      details: expect.objectContaining({ acceptedDisplays: ['History of Immunization note'] }),
    })]);
  });

  it('preserves local complete definition evidence before compatibility hints', () => {
    expect(validate({ ...result, issues: [{
      code: 'invalid-display', severity: 'error', source: 'local-code-system',
      message: 'The local edition does not include the historical designation',
    }] })).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
  });

  it('retains a source display warning without escalating it', () => {
    expect(validate({ ...result, issues: [{
      code: 'invalid-display', severity: 'warning', message: 'Wrong display for this source',
    }] })).toContainEqual(expect.objectContaining({
      code: 'terminology-display-mismatch', severity: 'warning',
    }));
  });

  it.each([coding.display, 'Hx of Immunization note', 'Impfanamnese Freitext'])(
    'accepts a display confirmed by the source: %s', display => {
      expect(validate({ valid: true, display: 'History of Immunization note' }, display)).toEqual([]);
    },
  );

  it('accepts a designation explicitly listed by the source', () => {
    expect(validate({ ...result, issues: [{
      code: 'invalid-display', severity: 'error',
      message: "Valid display is one of 2 choices: 'History of Immunization note' (en-US) or 'Hx of Immunization note' (en-US)",
    }] }, 'Hx of Immunization note')).toEqual([]);
  });

  it('keeps existing case normalization for a source designation', () => {
    expect(validate(result, 'HISTORY OF IMMUNIZATION NOTE')).toEqual([]);
  });

  it('does not manufacture a display error when the source edition is unavailable', () => {
    const issues = validate({ valid: false, reason: 'system-unresolvable' });
    expect(issues.some(issue => issue.code === 'terminology-display-mismatch')).toBe(false);
  });

  it('retains a known code-invalid finding independently of display compatibility', () => {
    expect(validate({ valid: false, reason: 'code-unknown' })).toContainEqual(expect.objectContaining({
      code: 'terminology-code-invalid', severity: 'error',
    }));
  });
});
