import { describe, expect, it } from 'vitest';
import { RemoteCodeSystemValidationBudget } from '../terminology-api-remote-budget';
import type { TerminologyResolutionConfig } from '../valueset-types';

describe('remote CodeSystem budget', () => {
  const config: TerminologyResolutionConfig = { strategy: 'server-first' };
  it('keeps checking later resources in a warm runtime by default', () => {
    const budget = new RemoteCodeSystemValidationBudget();
    for (let index = 0; index < 100; index++) expect(budget.reserve('https://tx.example.test', config)).toBe(true);
  });
  it('honors an explicitly configured request quota', () => {
    const budget = new RemoteCodeSystemValidationBudget();
    const limited = { ...config, serverDelegation: { maxRemoteCodeSystemValidations: 1 } };
    expect(budget.reserve('https://tx.example.test', limited)).toBe(true);
    expect(budget.reserve('https://tx.example.test', limited)).toBe(false);
  });
});
