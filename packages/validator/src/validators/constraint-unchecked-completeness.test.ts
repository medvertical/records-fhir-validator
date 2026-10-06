import { describe, expect, it, vi } from 'vitest';
import { handleConstraintEvaluationFailure } from './constraint-evaluation-failure';
import { handleSDFHIRPathEvaluationFailure } from './sd-fhirpath-evaluation-failure';
import { createConstraintEvaluationError } from './sd-fhirpath-issue-factory';
import { evaluateSimpleMemberOfExists } from './fhirpath-memberof-precheck';

const profileUrl = 'https://example.test/Profile|1.0';
const constraint = { key: 'parity-1', severity: 'error' as const, human: 'A checked constraint', expression: 'code.memberOf(\'https://example.test/ValueSet\')' };

describe('case-bound unchecked constraint evidence', () => {
  it('preserves unsupported general evaluator checks on the affected instance', () => {
    const record = vi.fn();
    const issues = handleConstraintEvaluationFailure({ constraint, diagnosticTracker: { record }, elementPath: 'Observation.component[2].code',
      error: new Error('asynchronous function memberOf is not allowed'), profileUrl, resourceType: 'Observation' });
    expect(issues).toEqual([expect.objectContaining({ severity: 'information', code: 'profile-constraint-evaluation-error',
      path: 'Observation.component[2].code', profile: profileUrl, ruleId: 'parity-1',
      details: expect.objectContaining({ validationComplete: false, validationStatus: 'incomplete', constraintKey: 'parity-1' }) })]);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('preserves unsupported StructureDefinition checks on the affected instance', () => {
    const issues = handleSDFHIRPathEvaluationFailure({ constraint, path: 'Observation.component[3].code',
      error: new Error('asynchronous function memberOf is not allowed'), profileUrl, resourceType: 'Observation', phase: 'matched' });
    expect(issues).toEqual([expect.objectContaining({ severity: 'information', code: 'profile-constraint-evaluation-error',
      path: 'Observation.component[3].code', profile: profileUrl, ruleId: 'parity-1',
      details: expect.objectContaining({ validationComplete: false }) })]);
  });

  it('marks every failed constraint evaluation explicitly incomplete', () => {
    expect(createConstraintEvaluationError(constraint, 'Observation.code', 'Observation', new Error('compile failed'), profileUrl))
      .toMatchObject({ details: { validationComplete: false, validationStatus: 'incomplete' } });
  });
});

describe('memberOf exists with local evidence', () => {
  const expression = "where(code.memberOf('https://example.test/ValueSet')).exists()";
  it('accepts a known member and rejects a known non-member', async () => {
    const loader = { hasIncompleteExpansion: vi.fn().mockResolvedValue(false), loadValueSet: vi.fn().mockResolvedValue(['known']) };
    expect(await evaluateSimpleMemberOfExists(expression, { code: 'known' }, 'Observation', loader)).toBe(true);
    expect(await evaluateSimpleMemberOfExists(expression, { code: 'other' }, 'Observation', loader)).toBe(false);
  });

  it.each([null, []])('does not turn unavailable or unproven expansion %j into a pass', async codes => {
    const loader = { hasIncompleteExpansion: vi.fn().mockResolvedValue(false), loadValueSet: vi.fn().mockResolvedValue(codes) };
    await expect(evaluateSimpleMemberOfExists(expression, { code: 'other' }, 'Observation', loader))
      .rejects.toMatchObject({ name: 'FHIRPathTerminologyUnverifiedError' });
  });

  it('defers unknown membership to the configured authoritative resolver', async () => {
    const loader = { hasIncompleteExpansion: vi.fn().mockResolvedValue(false), loadValueSet: vi.fn().mockResolvedValue(null) };
    expect(await evaluateSimpleMemberOfExists(expression, { code: 'other' }, 'Observation', loader, 'R4', true)).toBeNull();
  });

  it('decides an empty selection without claiming terminology was checked', async () => {
    const loader = { hasIncompleteExpansion: vi.fn().mockResolvedValue(false), loadValueSet: vi.fn().mockResolvedValue(null) };
    expect(await evaluateSimpleMemberOfExists(expression, {}, 'Observation', loader)).toBe(false);
    expect(loader.loadValueSet).not.toHaveBeenCalled();
  });
});
