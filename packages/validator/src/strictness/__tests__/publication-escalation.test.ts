import { describe, expect, it } from 'vitest';
import type { ValidationIssue, ValidationSeverity } from '@records-fhir/validation-types';
import { applyPublicationEscalation, isForPublication } from '../publication-escalation';

function issue(severity: ValidationSeverity, code: string): ValidationIssue {
  return {
    id: `${code}-${severity}`,
    aspect: 'profile',
    severity,
    code,
    message: `${code} message`,
    path: 'Resource.field',
    timestamp: new Date(),
  } as ValidationIssue;
}

describe('isForPublication', () => {
  it('is false when unset or off', () => {
    expect(isForPublication(undefined)).toBe(false);
    expect(isForPublication({} as never)).toBe(false);
    expect(isForPublication({ forPublication: false } as never)).toBe(false);
  });

  it('is true when the flag is set', () => {
    expect(isForPublication({ forPublication: true } as never)).toBe(true);
  });
});

describe('applyPublicationEscalation', () => {
  it('is a no-op when forPublication is false', () => {
    const issues = [issue('warning', 'x'), issue('information', 'best-practice-y')];
    expect(applyPublicationEscalation(issues, false)).toBe(issues);
  });

  it('escalates warning to error', () => {
    const [out] = applyPublicationEscalation([issue('warning', 'profile-card')], true);
    expect(out.severity).toBe('error');
    expect((out.details as { originalSeverity?: string }).originalSeverity).toBe('warning');
    expect((out.details as { publicationEscalated?: boolean }).publicationEscalated).toBe(true);
  });

  it('escalates best-practice info to warning', () => {
    const [out] = applyPublicationEscalation([issue('information', 'best-practice-missing-effective')], true);
    expect(out.severity).toBe('warning');
  });

  it('leaves non-best-practice info untouched', () => {
    const input = issue('information', 'r6-reference-limited');
    const [out] = applyPublicationEscalation([input], true);
    expect(out.severity).toBe('information');
    expect(out).toBe(input);
  });

  it('never downgrades error or fatal', () => {
    const out = applyPublicationEscalation([issue('error', 'e'), issue('fatal', 'f')], true);
    expect(out.map(i => i.severity)).toEqual(['error', 'fatal']);
  });

  it('preserves the earliest originalSeverity when an earlier layer already recorded one', () => {
    const downgraded: ValidationIssue = {
      ...issue('warning', 'profile-card'),
      details: { originalSeverity: 'error' as ValidationSeverity },
    } as ValidationIssue;
    const [out] = applyPublicationEscalation([downgraded], true);
    expect(out.severity).toBe('error');
    expect((out.details as { originalSeverity?: string }).originalSeverity).toBe('error');
  });
});
