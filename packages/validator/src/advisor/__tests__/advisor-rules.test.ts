import { describe, it, expect } from 'vitest';
import { applyAdvisorRules, type AdvisorRule } from '../advisor-rules';
import type { ValidationIssue } from '@records-fhir/validation-types';

const issue = (overrides: Partial<ValidationIssue> = {}): ValidationIssue => ({
  severity: 'error',
  code: 'test-code',
  message: 'Test message',
  path: 'Patient.name',
  ...overrides,
});

describe('applyAdvisorRules', () => {
  it('suppresses issues matching by code', () => {
    const rules: AdvisorRule[] = [{
      id: 'r1',
      action: 'suppress',
      match: { code: 'test-code' },
      enabled: true,
    }];
    const result = applyAdvisorRules([issue()], rules);
    expect(result.resultIssues).toHaveLength(0);
    expect(result.suppressedCount).toBe(1);
    expect(result.appliedRules[0].action).toBe('suppress');
  });

  it('overrides severity with override-severity action', () => {
    const rules: AdvisorRule[] = [{
      id: 'r1',
      action: 'override-severity',
      match: { code: 'test-code' },
      transform: { severity: 'warning' },
      enabled: true,
    }];
    const result = applyAdvisorRules([issue({ severity: 'error' })], rules);
    expect(result.resultIssues).toHaveLength(1);
    expect(result.resultIssues[0].severity).toBe('warning');
    expect(result.overriddenCount).toBe(1);
  });

  it('skips disabled rules', () => {
    const rules: AdvisorRule[] = [{
      id: 'r1',
      action: 'suppress',
      match: { code: 'test-code' },
      enabled: false,
    }];
    const result = applyAdvisorRules([issue()], rules);
    expect(result.resultIssues).toHaveLength(1);
    expect(result.suppressedCount).toBe(0);
    expect(result.appliedRules).toHaveLength(0);
  });

  it('passes issues through unchanged when no rules match', () => {
    const rules: AdvisorRule[] = [{
      id: 'r1',
      action: 'suppress',
      match: { code: 'nonexistent-code' },
      enabled: true,
    }];
    const issues = [issue({ code: 'other-code' })];
    const result = applyAdvisorRules(issues, rules);
    expect(result.resultIssues).toHaveLength(1);
    expect(result.resultIssues[0]).toEqual(issues[0]);
    expect(result.suppressedCount).toBe(0);
    expect(result.overriddenCount).toBe(0);
  });

  it('applies multiple rules in order', () => {
    const rules: AdvisorRule[] = [
      {
        id: 'r1',
        action: 'override-severity',
        match: { code: 'keep-me' },
        transform: { severity: 'information' },
        enabled: true,
      },
      {
        id: 'r2',
        action: 'suppress',
        match: { code: 'remove-me' },
        enabled: true,
      },
    ];
    const issues = [
      issue({ code: 'keep-me', severity: 'error' }),
      issue({ code: 'remove-me' }),
    ];
    const result = applyAdvisorRules(issues, rules);
    expect(result.resultIssues).toHaveLength(1);
    expect(result.resultIssues[0].severity).toBe('information');
    expect(result.suppressedCount).toBe(1);
    expect(result.overriddenCount).toBe(1);
    expect(result.appliedRules).toHaveLength(2);
  });
});
