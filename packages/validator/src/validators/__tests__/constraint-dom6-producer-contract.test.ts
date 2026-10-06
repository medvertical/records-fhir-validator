import { describe, expect, it } from 'vitest';
import type { Constraint } from '../../core/structure-definition-types.js';
import type { ConstraintValidationState } from '../constraint-validation-input.js';
import { buildConstraintViolationIssue } from '../constraint-violation-issue.js';

const profileUrl = 'https://records.test/StructureDefinition/active-patient';
const resource = { resourceType: 'Patient', id: 'producer-control', active: false, text: { status: 'generated' } };
const controls: Array<{
  original: Constraint['severity']; mode: ConstraintValidationState['strictnessMode'];
  expected: 'error' | 'warning'; escalated: boolean;
}> = [
  { original: 'warning', mode: 'standard', expected: 'warning', escalated: false },
  { original: 'warning', mode: 'strict', expected: 'error', escalated: true },
  { original: 'error', mode: 'standard', expected: 'error', escalated: false },
  { original: 'error', mode: 'strict', expected: 'error', escalated: false },
];

function constraint(severity: Constraint['severity'], key = 'dom-6'): Constraint {
  return { key, severity, human: 'Controlled Patient must be active', expression: 'active = true', source: profileUrl };
}

describe('real dom-6 producer severity independent of publication policy', () => {
  it.each(controls)('keeps $original in $mode with escalation=$escalated', row => {
    const input = constraint(row.original);
    const before = JSON.stringify(input);
    const issue = buildConstraintViolationIssue(resource, 'Patient', input, profileUrl, row.mode);
    console.info('DOM6_PRODUCER_SEVERITY_OBSERVATION', JSON.stringify({ row, resource, input, issue }));
    expect(issue.severity).toBe(row.expected);
    expect(issue).toMatchObject({
      code: 'dom-6', ruleId: 'dom-6', path: 'Patient.text', profile: profileUrl,
      details: { expression: input.expression, constraintKey: input.key,
        originalSeverity: row.original, escalated: row.escalated },
    });
    expect(issue.message).toBe(input.human + (row.escalated ? ' [escalated from warning in strict mode]' : ''));
    expect(JSON.stringify(input)).toBe(before);
    expect(typeof issue.id).toBe('string');
    expect(issue.id?.length).toBeGreaterThan(0);
  });
});

describe('real dom-6 producer preserves the structural semantic projection contract', () => {
  it.each(controls)('attributes $original in $mode to the structural bucket', row => {
    const issue = buildConstraintViolationIssue(resource, 'Patient', constraint(row.original), profileUrl, row.mode);
    expect(issue.aspect).toBe('structural');
    expect(issue.validationMethod).toBe('structural-validation');
    expect(issue.details).toMatchObject({ validationType: 'structural-validation' });
  });
});

describe('non-dom producer controls remain independent', () => {
  it.each(controls)('preserves non-dom code for $original in $mode', row => {
    const issue = buildConstraintViolationIssue(resource, 'Patient', constraint(row.original, 'active-1'), profileUrl, row.mode);
    const advisory = row.original === 'warning' && row.mode === 'standard';
    expect(issue.code).toBe(advisory ? 'profile-constraint-warning' : 'profile-constraint-violation');
    expect(issue.aspect).toBe(advisory ? 'structural' : 'profile');
    expect(issue.severity).toBe(row.expected);
    expect(issue.path).toBe('Patient');
    expect(issue.ruleId).toBe('active-1');
  });
});
