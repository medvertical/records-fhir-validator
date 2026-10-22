import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCustomRulesSource } from '../../persistence';
import { CustomRuleExecutor } from './custom-rule-executor';

const context = {
  resource: { resourceType: 'Patient', id: 'p1' },
  structureDef: {} as never,
  organizationId: 7,
};

describe('custom rule source consistency', () => {
  afterEach(() => {
    vi.useRealTimers();
    setCustomRulesSource({ async getRulesByResourceType() { return []; } });
  });

  it('delegates cache ownership to the host and reloads on every execution', async () => {
    const getRulesByResourceType = vi.fn().mockResolvedValue([]);
    setCustomRulesSource({ getRulesByResourceType });
    const executor = new CustomRuleExecutor();

    await executor.validate(context);
    await executor.validate(context);

    expect(getRulesByResourceType).toHaveBeenCalledTimes(2);
  });
  it('executes only matching profiles and FHIR versions, preserving the authored path', async () => {
    setCustomRulesSource({ async getRulesByResourceType() { return [{ ruleId: 'scoped', name: 'Scoped', expression: 'false', severity: 'error',
      profilesAny: ['https://example.test/Patient|2026'], fhirVersions: ['R5'], path: 'Patient.identifier' }]; } });
    const executor = new CustomRuleExecutor();
    expect(await executor.validate({ ...context, fhirVersion: 'R4', selectedRelease: 'R4', resource: { ...context.resource, meta: { profile: ['https://example.test/Patient|2026'] } } })).toEqual([]);
    expect(await executor.validate({ ...context, fhirVersion: 'R5', selectedRelease: 'R5', structureDef: { type: 'Patient', url: 'https://example.test/Patient', version: '2025' } as never, resource: { ...context.resource, meta: { profile: ['https://example.test/Patient|2025'] } } })).toEqual([]);
    expect(await executor.validate({ ...context, fhirVersion: 'R5', selectedRelease: 'R5', structureDef: { type: 'Patient', url: 'https://example.test/Patient', version: '2026' } as never, resource: { ...context.resource, meta: { profile: ['https://example.test/Patient|2026'] } } })).toEqual([expect.objectContaining({ code: 'custom-rule-violation', path: 'Patient.identifier' })]);
  });
  it('accepts an explicitly resolved profile and canonical scopes across versions', async () => {
    setCustomRulesSource({ async getRulesByResourceType() { return [{ ruleId: 'scoped', name: 'Scoped', expression: 'false', severity: 'warning', profilesAny: ['https://example.test/Patient'] }]; } });
    const issues = await new CustomRuleExecutor().validate({ ...context, selectedRelease: 'R4', structureDef: { type: 'Patient', url: 'https://example.test/Patient', version: '2026' } as never });
    expect(issues).toEqual([expect.objectContaining({ code: 'custom-rule-violation' })]);
    expect(await new CustomRuleExecutor().validate(context)).toEqual([expect.objectContaining({
      code: 'custom-rule-applicability-unknown', details: expect.objectContaining({ validationComplete: false }),
    })]);
  });

  it('marks validation incomplete when the rule source fails', async () => {
    setCustomRulesSource({
      async getRulesByResourceType() { throw new Error('database unavailable'); },
    });

    const issues = await new CustomRuleExecutor().validate(context);

    expect(issues).toEqual([expect.objectContaining({
      aspect: 'custom_rule',
      severity: 'warning',
      code: 'custom-rule-source-unavailable',
      details: expect.objectContaining({ selectedRelease: null, checkOutcome: 'execution-failure', validationComplete: false }),
    })]);
  });

  it('marks validation incomplete when tenant scope is missing', async () => {
    const getRulesByResourceType = vi.fn().mockResolvedValue([]);
    setCustomRulesSource({ getRulesByResourceType });

    const issues = await new CustomRuleExecutor().validate({
      resource: context.resource,
      structureDef: context.structureDef,
    });

    expect(getRulesByResourceType).not.toHaveBeenCalled();
    expect(issues).toEqual([expect.objectContaining({
      code: 'custom-rule-source-unavailable',
      severity: 'warning',
      aspect: 'custom_rule',
    })]);
  });

  it('allows a cold rule load to finish inside the two-second budget', async () => {
    vi.useFakeTimers();
    setCustomRulesSource({
      getRulesByResourceType: () => new Promise((resolve) => {
        setTimeout(() => resolve([]), 500);
      }),
    });
    const validation = new CustomRuleExecutor().validate(context);

    await vi.advanceTimersByTimeAsync(500);

    await expect(validation).resolves.toEqual([]);
  });

  it('marks validation incomplete when rule loading exceeds its bound', async () => {
    vi.useFakeTimers();
    setCustomRulesSource({
      getRulesByResourceType: () => new Promise(() => undefined),
    });
    const validation = new CustomRuleExecutor().validate(context);

    await vi.advanceTimersByTimeAsync(2000);

    await expect(validation).resolves.toEqual([expect.objectContaining({
      code: 'custom-rule-source-unavailable',
      severity: 'warning',
    })]);
  });
});
