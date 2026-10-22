import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { MultiAspectValidateResult, ValidateOneFn } from '../multi-aspect-types.js';
import { BatchValidationAbortedError } from '../batch-validator.js';
import { validateDeclaredProfiles } from '../multi-aspect-embedded-profiles.js';

const FIRST_PROFILE = 'https://example.org/StructureDefinition/PatientA';
const SECOND_PROFILE = 'https://example.org/StructureDefinition/PatientB';
const MESSAGE = 'A resource should have narrative for robust management';

function narrative(id: string, changed: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    id, aspect: 'profile', code: 'dom-6', severity: 'information', message: MESSAGE,
    path: 'Patient.text', resourceType: 'Patient', profile: FIRST_PROFILE, ruleId: 'dom-6',
    details: { expression: 'text.exists()', source: FIRST_PROFILE, constraintKey: 'dom-6', originalSeverity: 'warning' },
    ...changed,
  };
}

function result(issues: ValidationIssue[], evidence = issues): MultiAspectValidateResult {
  const isValid = issues.every(issue => !['error', 'fatal'].includes(issue.severity));
  return { isValid, aspects: [{ aspect: 'profile', issues, evidenceIssues: evidence, validationTime: 1, isValid }] };
}

async function mergeTwo(primary: MultiAspectValidateResult, secondary: MultiAspectValidateResult) {
  const resource = { resourceType: 'Patient', id: 'declared-narrative', meta: { profile: [FIRST_PROFILE, SECOND_PROFILE] } };
  const before = JSON.stringify({ resource, primary, secondary });
  const validateOne = vi.fn<ValidateOneFn>().mockImplementation(async (_resource, profile) => {
    if (profile === FIRST_PROFILE) return primary;
    if (profile === SECOND_PROFILE) return secondary;
    throw new Error(`Unexpected declared profile ${profile}`);
  });
  const merged = await validateDeclaredProfiles(validateOne, undefined, resource, FIRST_PROFILE, 'R4', 0);
  expect(validateOne.mock.calls.map(call => call[1])).toEqual([FIRST_PROFILE, SECOND_PROFILE]);
  expect(validateOne).toHaveBeenNthCalledWith(1, resource, FIRST_PROFILE, 'R4', 0);
  expect(validateOne).toHaveBeenNthCalledWith(2, resource, SECOND_PROFILE, 'R4', 0, undefined, undefined, undefined, true);
  expect(JSON.stringify({ resource, primary, secondary })).toBe(before);
  expect(merged.aspects).toHaveLength(1);
  expect(merged.aspects[0].aspect).toBe('profile');
  return merged;
}

function expectSameOccurrences(actual: ValidationIssue[] | undefined, expected: ValidationIssue[]) {
  expect(actual).toEqual(expected);
  for (const [index, issue] of expected.entries()) {
    expect(actual![index]).toBe(issue);
    expect(actual![index].id).toBe(issue.id);
    expect(actual![index].details).toBe(issue.details);
  }
}

describe('declared profile narrative merge through the actual caller', () => {
  it('retains same-aspect custom findings with different expression, source and profile in final and evidence arrays', async () => {
    const first = narrative('first-custom');
    const second = narrative('second-custom', {
      profile: SECOND_PROFILE,
      details: { expression: 'text.`div`.exists()', source: SECOND_PROFILE, constraintKey: 'dom-6', originalSeverity: 'warning' },
    });
    const merged = await mergeTwo(result([first]), result([second]));
    expectSameOccurrences(merged.aspects[0].issues, [first, second]);
    expectSameOccurrences(merged.aspects[0].evidenceIssues, [first, second]);
  });

  it.each([
    ['expression', { details: { expression: 'text.`div`.exists()', source: FIRST_PROFILE, constraintKey: 'dom-6', originalSeverity: 'warning' } }],
    ['source', { details: { expression: 'text.exists()', source: SECOND_PROFILE, constraintKey: 'dom-6', originalSeverity: 'warning' } }],
    ['profile', { profile: SECOND_PROFILE }],
    ['advisory severity', { severity: 'warning' }],
    ['hard error', { severity: 'error', details: { expression: 'text.exists()', source: FIRST_PROFILE, constraintKey: 'dom-6', originalSeverity: 'warning', escalated: true } }],
    ['rule identity', { ruleId: 'custom-dom-6' }],
    ['occurrence', { path: 'Bundle.entry[1].resource/Patient.text' }],
  ] satisfies Array<[string, Partial<ValidationIssue>]>)(
    'preserves a distinct %s in both arrays', async (_label, changed) => {
      const first = narrative('first');
      const second = narrative('second', changed);
      const merged = await mergeTwo(result([first]), result([second]));
      expectSameOccurrences(merged.aspects[0].issues, [first, second]);
      expectSameOccurrences(merged.aspects[0].evidenceIssues, [first, second]);
      expect(merged.isValid).toBe(!('severity' in changed && changed.severity === 'error'));
    },
  );

  it('deduplicates an exact semantic repeat while preserving the first identity and every raw input', async () => {
    const first = narrative('first');
    const second = { ...first, id: 'second', timestamp: '2026-10-03T00:00:00.000Z' };
    const merged = await mergeTwo(result([first]), result([second]));
    expectSameOccurrences(merged.aspects[0].issues, [first]);
    expectSameOccurrences(merged.aspects[0].evidenceIssues, [first]);
  });

  it('keeps the information/info alias repeat contract', async () => {
    const first = narrative('first');
    const second = { ...first, id: 'second', severity: 'info' as const };
    const merged = await mergeTwo(result([first]), result([second]));
    expectSameOccurrences(merged.aspects[0].issues, [first]);
    expectSameOccurrences(merged.aspects[0].evidenceIssues, [first]);
  });

  it('preserves two indexed occurrences with the same narrative identity', async () => {
    const first = narrative('first', { path: 'Bundle.entry[0].resource/Patient.text' });
    const second = narrative('second', { path: 'Bundle.entry[1].resource/Patient.text' });
    const merged = await mergeTwo(result([first]), result([second]));
    expectSameOccurrences(merged.aspects[0].issues, [first, second]);
    expectSameOccurrences(merged.aspects[0].evidenceIssues, [first, second]);
  });

  it('preserves ordinary non-dom-6 strictest-severity merging independently in final and evidence arrays', async () => {
    const first = narrative('ordinary-first', { code: 'profile-constraint-violation', severity: 'warning' });
    const second = narrative('ordinary-second', { code: 'profile-constraint-violation', severity: 'error', profile: SECOND_PROFILE, details: { expression: 'custom', source: SECOND_PROFILE } });
    const firstEvidence = { ...first, id: 'evidence-first', severity: 'information' as const };
    const secondEvidence = { ...second, id: 'evidence-second', severity: 'warning' as const };
    const merged = await mergeTwo(result([first], [firstEvidence]), result([second], [secondEvidence]));
    expectSameOccurrences(merged.aspects[0].issues, [second]);
    expectSameOccurrences(merged.aspects[0].evidenceIssues, [secondEvidence]);
    expect(merged.isValid).toBe(false);
  });

  it('stops before a secondary declared profile without mutating the primary or resource', async () => {
    const resource = { resourceType: 'Patient', meta: { profile: [FIRST_PROFILE, SECOND_PROFILE] } };
    const primary = result([narrative('primary')]);
    const before = JSON.stringify({ resource, primary });
    const validateOne = vi.fn<ValidateOneFn>().mockResolvedValue(primary);
    const shouldStop = vi.fn(() => true);
    await expect(validateDeclaredProfiles(validateOne, shouldStop, resource, FIRST_PROFILE, 'R4', 0))
      .rejects.toBeInstanceOf(BatchValidationAbortedError);
    expect(validateOne).toHaveBeenCalledTimes(1);
    expect(validateOne).toHaveBeenCalledWith(resource, FIRST_PROFILE, 'R4', 0);
    expect(shouldStop).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({ resource, primary })).toBe(before);
  });

  it('returns the unchanged primary result for repeated identical profile claims', async () => {
    const resource = { resourceType: 'Patient', meta: { profile: [FIRST_PROFILE, FIRST_PROFILE] } };
    const primary = result([narrative('primary')]);
    const before = JSON.stringify({ resource, primary });
    const validateOne = vi.fn<ValidateOneFn>().mockResolvedValue(primary);
    expect(await validateDeclaredProfiles(validateOne, undefined, resource, FIRST_PROFILE, 'R4', 0)).toBe(primary);
    expect(validateOne).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({ resource, primary })).toBe(before);
  });
});
