import { describe, expect, it } from 'vitest';
import type { CodeSystemValidationResult } from '../../../validators/terminology-api-types';
import { buildCodeSystemResultIssues } from '../terminology-code-system-result-issues';
import { aggregateRemoteCodeSystemBudgetIssues } from '../../validation-utils';

const coding = { system: 'https://example.test/CodeSystem/completeness', code: 'known' };
const unknown: CodeSystemValidationResult[] = [
  { valid: false, reason: 'system-unresolvable' },
  { valid: false, reason: 'code-unknown', incompleteCodeSystem: true },
  { valid: true, reason: 'remote-budget-exhausted' },
  { valid: true, reason: 'national-extension-unverified' },
  { valid: true, reason: 'delegation-disabled' },
];
const resultIssues = (result: CodeSystemValidationResult, version?: string) =>
  buildCodeSystemResultIssues({ ...coding, ...(version ? { version } : {}) }, result,
    'Observation.code.coding', 2, true);

describe('CodeSystem result completeness', () => {
  it.each(unknown)('preserves unknown evidence for $reason', result => {
    const issues = resultIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0].details).toMatchObject({
      validationComplete: false, validationStatus: 'incomplete', reason: result.reason,
    });
    expect(issues[0].severity).toBe(result.valid ? 'information' : 'warning');
    expect(issues[0].path).toBe(`Observation.code.coding[2].${result.reason === 'system-unresolvable' ? 'system' : 'code'}`);
    expect(issues[0].details).not.toHaveProperty('codeSystemVersion');
  });

  it.each(unknown)('retains the requested business version for $reason', result => {
    expect(resultIssues(result, 'business-edition-A')[0].details).toHaveProperty('codeSystemVersion', 'business-edition-A');
  });

  it.each([false, true])('does not invent unknown for a proven fragment member: %s', incompleteCodeSystem => {
    expect(resultIssues({ valid: true, incompleteCodeSystem })).toEqual([]);
  });

  it('retains an independently proved complete-code rejection', () => {
    const issues = resultIssues({ valid: false, reason: 'code-unknown' });
    expect(issues[0]).toMatchObject({ code: 'terminology-code-invalid', severity: 'error' });
    expect(issues[0].details).not.toHaveProperty('validationComplete');
  });

  it('does not hide a display rejection beside unknown membership', () => {
    const issues = buildCodeSystemResultIssues({ ...coding, display: 'Unrelated rejected label' }, {
      valid: false, reason: 'system-unresolvable', display: 'Preferred source label',
      issues: [{ code: 'invalid-display', severity: 'error', message: 'Explicit source mismatch' }],
    }, 'Observation.code.coding', 0, true);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch', severity: 'error' }));
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', details: expect.objectContaining({ validationComplete: false }) }));
  });

  it.each(unknown.slice(0, 2))('keeps local-only warnings incomplete for $reason', result => {
    const issues = buildCodeSystemResultIssues(coding, result, 'Observation.code.coding[0]', 0, false, false);
    expect(issues[0]).toMatchObject({ severity: 'warning', details: { validationComplete: false } });
  });

  it('keeps budget completeness after aggregation', () => {
    const issues = Array.from({ length: 6 }, (_, index) => buildCodeSystemResultIssues(
      { ...coding, code: `c${index}` }, { valid: true, reason: 'remote-budget-exhausted' },
      'Observation.code.coding', index, true,
    )[0]);
    expect(aggregateRemoteCodeSystemBudgetIssues(issues)).toEqual([
      expect.objectContaining({ details: expect.objectContaining({ count: 6, validationComplete: false }) }),
    ]);
  });
});
