import { describe, expect, it } from 'vitest';
import { validateBinding, type BindingValidationDeps } from '../valueset-binding-validator';
import type { Binding } from '../../core/structure-definition-types';

const VALUE_SET = 'https://example.test/ValueSet/codes';

function deps(outcome: 'valid' | 'invalid' | 'unverified'): BindingValidationDeps {
  return {
    resolutionConfig: { reportUnverifiedBindings: false } as never,
    cache: {} as never,
    packageLoader: { loadValueSetResource: async () => ({ resourceType: 'ValueSet', url: VALUE_SET,
      expansion: { contains: [{ system: 'http://example.test/codes', code: 'M' }] } }) } as never,
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

  it.each([['extensible', 'warning'], ['preferred', 'info']] as const)(
    'does not count a systemless Coding as a member of a %s value set whose codes include its text',
    async (strength, severity) => {
      const issues = await validateBinding(
        deps('valid'),
        { coding: [{ code: 'M' }] },
        { strength, valueSet: VALUE_SET },
        'Patient.maritalStatus',
      );
      expect(issues).toEqual([expect.objectContaining({ code: `terminology-binding-${strength}-code`, severity })]);
    },
  );

  it('does not establish required CodeableConcept membership from an unqualified coding in an expansion', async () => {
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

  it('keeps required membership of a lone systemless Coding unverified rather than rejecting its code', async () => {
    const collaborators = deps('invalid');
    collaborators.resolutionConfig = { ...collaborators.resolutionConfig, reportUnverifiedBindings: true };
    const issues = await validateBinding(collaborators, { code: 'IMP' }, required, 'Encounter.class');
    expect(issues.some(issue => issue.code === 'terminology-binding-required-code')).toBe(false);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-unverified',
      details: expect.objectContaining({ validationComplete: false }) }));
    expect(await validateBinding(deps('valid'), { code: 'IMP', system: 'http://example.test/classes' }, required, 'Encounter.class'))
      .toEqual([]);
    expect(await validateBinding(deps('invalid'), { code: 'IMPX', system: 'http://example.test/classes' }, required, 'Encounter.class'))
      .toContainEqual(expect.objectContaining({ code: 'terminology-binding-required', severity: 'error' }));
  });

  it('does not reject a systemless CodeableConcept when its ValueSet cannot be loaded', async () => {
    const collaborators = deps('invalid');
    collaborators.resolutionConfig = { ...collaborators.resolutionConfig, reportUnverifiedBindings: true };
    collaborators.packageLoader = { loadValueSetResource: async () => null } as never;
    expect(await validateBinding(collaborators, { coding: [{ code: 'M' }] }, required, 'Observation.code'))
      .toEqual([expect.objectContaining({ code: 'terminology-binding-unverified',
        details: expect.objectContaining({ validationComplete: false }) })]);
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
