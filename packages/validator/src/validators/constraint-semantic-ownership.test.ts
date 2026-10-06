import { describe, expect, it } from 'vitest';
import { createConstraintEvaluationError, createConstraintViolation } from './sd-fhirpath-issue-factory';
import { interpretConstraintResult } from './constraint-result-policy';

const constraint = { key: 'parity-ownership-1', expression: 'true', human: 'Known rule', severity: 'error' as const };
const profile = 'https://example.test/StructureDefinition/ownership';

describe('constraint evidence semantic ownership', () => {
  it('owns dynamically named invariant violations in the profile aspect', () => {
    expect(createConstraintViolation(constraint, 'Patient', 'Patient', profile)).toMatchObject({
      aspect: 'profile', code: 'constraint-violation-parity-ownership-1', ruleId: constraint.key,
    });
  });

  it('owns unchecked evaluations in the profile aspect', () => {
    expect(createConstraintEvaluationError(constraint, 'Patient', 'Patient', new Error('unavailable'), profile))
      .toMatchObject({ aspect: 'profile', ruleId: constraint.key, details: { validationComplete: false } });
  });

  it('marks a non-Boolean constraint result unchecked with its defining rule', () => {
    const result = interpretConstraintResult(['not a Boolean'], {
      constraint, elementPath: 'Patient', resourceType: 'Patient', profileUrl: profile,
    });
    expect(result).toMatchObject({ passed: null, issue: {
      aspect: 'profile', ruleId: constraint.key,
      details: { validationComplete: false, validationStatus: 'incomplete' },
    } });
  });
});
