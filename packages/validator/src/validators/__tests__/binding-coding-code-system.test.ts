import { describe, expect, it } from 'vitest';
import { validateBinding, type BindingValidationDeps } from '../valueset-binding-validator';
import type { Binding } from '../../core/structure-definition-types';

const VALUE_SET = 'https://example.test/ValueSet/codes';

function deps(outcome: 'valid' | 'invalid' | 'unverified'): BindingValidationDeps {
  return {
    resolutionConfig: { reportUnverifiedBindings: false } as never,
    cache: {} as never,
    packageLoader: {} as never,
    resolveCodeBindingForBinding: async () => outcome as never,
    isValueSetAvailable: async () => true,
  };
}

const preferred: Binding = { strength: 'preferred', valueSet: VALUE_SET };
const required: Binding = { strength: 'required', valueSet: VALUE_SET };

function undeterminedSystemIssues(issues: Array<{ code?: string }>) {
  return issues.filter(issue => issue.code === 'terminology-system-undetermined');
}

describe('system determination for a bound code primitive', () => {
  it.each(['extensible', 'preferred'] as const)(
    'does not turn a %s binding advisory into an error for a systemless Coding',
    async strength => {
      const issues = await validateBinding(
        deps('invalid'),
        { coding: [{ code: 'EUR' }] },
        { strength, valueSet: VALUE_SET },
        'ResearchStudy.location[0]',
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe(strength === 'extensible' ? 'warning' : 'info');
      expect(undeterminedSystemIssues(issues)).toEqual([]);
    },
  );

  it('still rejects required membership without a Coding.system', async () => {
    const issues = await validateBinding(
      deps('valid'),
      { coding: [{ code: 'final' }] },
      required,
      'Observation.code',
    );
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'terminology-binding-required-code', severity: 'error',
    }));
    expect(undeterminedSystemIssues(issues)).toEqual([]);
  });

  it('does not escalate a non-required primitive binding to error', async () => {
    const issues = await validateBinding(deps('invalid'), 'local', preferred, 'Example.code');
    expect(issues.map(issue => issue.severity)).toEqual(['info']);
  });

  // A profile that binds `X.coding.code` hands the walk the bare primitive,
  // but the system is on the sibling `Coding.system` — never unknown.
  it('does not claim the system is undetermined under a Coding', async () => {
    const issues = await validateBinding(
      deps('invalid'),
      '385361009',
      preferred,
      'Observation.code.coding[0].code',
    );
    expect(undeterminedSystemIssues(issues)).toEqual([]);
  });

  it('applies to the unindexed element path as well', async () => {
    const issues = await validateBinding(
      deps('invalid'),
      '385361009',
      required,
      'Observation.code.coding.code',
    );
    expect(undeterminedSystemIssues(issues)).toEqual([]);
  });

  // A `code` element with no Coding around it has no system anywhere, which is
  // what the issue was written for; the reference validator reports it too.
  it('still reports a bare code element with no Coding above it', async () => {
    const issues = await validateBinding(
      deps('invalid'),
      'draft',
      required,
      'Observation.status',
    );
    expect(undeterminedSystemIssues(issues)).toHaveLength(1);
  });

  it('says nothing when the Coding carries its system', async () => {
    const issues = await validateBinding(
      deps('invalid'),
      { system: 'http://snomed.info/sct', code: '385361009' },
      required,
      'Observation.code.coding[0]',
    );
    expect(undeterminedSystemIssues(issues)).toEqual([]);
  });
});
