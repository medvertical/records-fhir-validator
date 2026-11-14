import { describe, expect, it } from 'vitest';
import { buildCodeSystemResultIssues } from '../../core/executors/terminology-code-system-result-issues.js';
import { isVerifiedCodeSystemResult } from '../code-system-validation-evidence.js';
import { parseCodeSystemValidationParameters } from '../terminology-code-system-result.js';
import { extractSubsumptionOutcome, validateCodeSucceeded, valueSetValidationOutcome } from '../terminology-parameters.js';

const coding = { code: '123456', system: 'http://snomed.info/sct', display: 'Synthetic display' };
const parameters = (parameter: unknown[]) => ({ resourceType: 'Parameters', parameter });
const rejectedDisplay = { name: 'issues', resource: { resourceType: 'OperationOutcome', issue: [{
  severity: 'error', code: 'invalid', details: { text: 'Synthetic display rejected', coding: [{
    system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'invalid-display',
  }] },
}] } };

describe('terminology scalar response authority', () => {
  const ambiguous = [
    ['contradictory positive first', [{ name: 'result', valueBoolean: true }, { name: 'result', valueBoolean: false }]],
    ['contradictory negative first', [{ name: 'result', valueBoolean: false }, { name: 'result', valueBoolean: true }]],
    ['duplicate positive', [{ name: 'result', valueBoolean: true }, { name: 'result', valueBoolean: true }]],
    ['duplicate negative', [{ name: 'result', valueBoolean: false }, { name: 'result', valueBoolean: false }]],
    ['multiple value choices', [{ name: 'result', valueBoolean: true, valueString: 'false' }]],
    ['value beside a resource', [{ name: 'result', valueBoolean: false, resource: { resourceType: 'Patient' } }]],
    ['value beside parts', [{ name: 'result', valueBoolean: true, part: [] }]],
    ['malformed entry', [{ name: 'result', valueBoolean: true }, null]],
    ['unnamed entry', [{ name: 'result', valueBoolean: true }, {}]],
    ['modified result', [{ name: 'result', valueBoolean: true, modifierExtension: [{ url: 'https://example.org/unknown' }] }]],
  ] as const;

  it.each(ambiguous)('does not turn %s into code or binding authority', (_name, entries) => {
    const response = parameters([...entries, rejectedDisplay]);
    expect(valueSetValidationOutcome(response)).toBe('unverified');
    expect(validateCodeSucceeded(response)).toBe(false);
    const result = parseCodeSystemValidationParameters(response, coding.code, coding.system);
    expect(result).toMatchObject({ valid: false, reason: 'server-failure' });
    expect(isVerifiedCodeSystemResult(result)).toBe(false);
    const issues = buildCodeSystemResultIssues(coding, result, 'Observation.code.coding', 0, true);
    expect(issues.map(issue => issue.code)).toEqual(['terminology-server-failure']);
    expect(issues[0].details).toMatchObject({ validationComplete: false });
  });

  it.each([true, false])('preserves an unambiguous membership result %s', valid => {
    const response = parameters([{ name: 'result', valueBoolean: valid }]);
    expect(valueSetValidationOutcome(response)).toBe(valid ? 'valid' : 'invalid');
    expect(validateCodeSucceeded(response)).toBe(valid);
    const result = parseCodeSystemValidationParameters(response, coding.code, coding.system);
    expect(result.valid).toBe(valid);
    expect(isVerifiedCodeSystemResult(result)).toBe(true);
  });

  it('preserves an unambiguous independent display rejection', () => {
    const result = parseCodeSystemValidationParameters(parameters([
      { name: 'result', valueBoolean: false }, rejectedDisplay,
    ]), coding.code, coding.system);
    expect(buildCodeSystemResultIssues(coding, result, 'Observation.code.coding', 0, true))
      .toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch' }));
  });

  it.each([true, false])('does not publish semantic claims when the source is unresolved despite result %s', valid => {
    const response = parameters([
      { name: 'result', valueBoolean: valid },
      { name: 'message', valueString: 'CodeSystem could not be found in the requested edition' },
      rejectedDisplay,
    ]);
    expect(valueSetValidationOutcome(response)).toBe('unverified');
    expect(validateCodeSucceeded(response)).toBe(false);
    const result = parseCodeSystemValidationParameters(response, coding.code, coding.system);
    expect(result.reason).toBe('system-unresolvable');
    expect(buildCodeSystemResultIssues(coding, result, 'Observation.code.coding', 0, true).map(issue => issue.code))
      .toEqual(['terminology-codesystem-unresolvable']);
  });

  it.each(['implicitRules', 'modifierExtension'])('rejects unknown root interpretation through %s', key => {
    const response = { ...parameters([{ name: 'result', valueBoolean: true }]),
      [key]: key === 'implicitRules' ? 'https://example.org/unknown-rules' : [{ url: 'https://example.org/unknown' }] };
    expect(valueSetValidationOutcome(response)).toBe('unverified');
    expect(parseCodeSystemValidationParameters(response, coding.code, coding.system).reason).toBe('server-failure');
  });

  it.each(['system-unresolvable', 'server-failure'] as const)('keeps %s visible despite compatibility acceptance', reason => {
    const issues = buildCodeSystemResultIssues(coding, { valid: true, reason, inactive: true,
      issues: [{ code: 'invalid-display', severity: 'error', message: 'Unattested display claim' }],
    }, 'Observation.code.coding', 0, true);
    expect(issues.map(issue => issue.code)).toEqual([
      reason === 'server-failure' ? 'terminology-server-failure' : 'terminology-codesystem-unresolvable',
    ]);
    expect(issues[0].severity).toBe('warning');
  });

  it('does not choose a subsumption answer by parameter order', () => {
    for (const outcomes of [['subsumes', 'not-subsumed'], ['not-subsumed', 'subsumes']]) {
      expect(extractSubsumptionOutcome(parameters(outcomes.map(valueCode => ({ name: 'outcome', valueCode })))))
        .toBeUndefined();
    }
    expect(extractSubsumptionOutcome(parameters([{ name: 'outcome', valueCode: 'subsumes' }]))).toBe('subsumes');
  });
});
