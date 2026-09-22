import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAdvisorRules, resetAdvisorRuleDiagnostics, type AdvisorRule } from '../advisor-rules';
import { logger } from '../../logger';
import type { ValidationIssue } from '@records-fhir/validation-types';

const issue = (message: string): ValidationIssue => ({
  severity: 'error',
  code: 'test-code',
  message,
  path: 'Patient.name',
});

const rule = (messageRegex: string): AdvisorRule => ({
  id: 'broken-pattern',
  action: 'suppress',
  match: { messageRegex },
  enabled: true,
});

describe('advisor rules with an uncompilable messageRegex', () => {
  beforeEach(() => {
    resetAdvisorRuleDiagnostics();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not apply the rule and leaves the issue untouched', () => {
    const result = applyAdvisorRules([issue('Test message')], [rule('^[0-9')]);
    expect(result.resultIssues).toHaveLength(1);
    expect(result.suppressedCount).toBe(0);
  });

  it('reports the pattern instead of failing silently', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    applyAdvisorRules([issue('Test message')], [rule('^[0-9')]);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('not a valid regular expression'),
      { messageRegex: '^[0-9' },
    );
  });

  it('reports each broken pattern once, not once per issue', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);

    applyAdvisorRules(
      [issue('one'), issue('two'), issue('three')],
      [rule('^[0-9')],
    );

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('still applies a rule whose pattern compiles', () => {
    const result = applyAdvisorRules([issue('Test message')], [rule('^Test')]);
    expect(result.resultIssues).toHaveLength(0);
    expect(result.suppressedCount).toBe(1);
  });
});
