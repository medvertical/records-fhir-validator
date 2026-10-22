import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { SlicingValidator } from '../slicing-validator.js';

const rootCanonical = 'https://example.test/StructureDefinition/report';
const targetCanonical = 'https://example.test/StructureDefinition/result';
const resultPath = 'DiagnosticReport.result';
const profile: StructureDefinition = {
  resourceType: 'StructureDefinition', url: rootCanonical,
  name: 'SyntheticReport', status: 'active', kind: 'resource', abstract: false,
  type: 'DiagnosticReport', fhirVersion: '4.0.1',
  snapshot: { element: [
    { id: 'DiagnosticReport', path: 'DiagnosticReport', min: 0, max: '*' },
    { id: resultPath, path: resultPath, min: 0, max: '*', type: [{ code: 'Reference' }],
      slicing: { discriminator: [{ type: 'profile', path: 'resolve()' }], rules: 'open' } },
    { id: `${resultPath}:selected`, path: resultPath, sliceName: 'selected', min: 0, max: '*',
      type: [{ code: 'Reference', targetProfile: [targetCanonical] }] },
  ] },
};
const targetProfile: StructureDefinition = {
  resourceType: 'StructureDefinition', url: targetCanonical,
  name: 'SyntheticResult', status: 'active', kind: 'resource', abstract: false,
  type: 'Observation', fhirVersion: '4.0.1',
  snapshot: { element: [
    { id: 'Observation', path: 'Observation', min: 0, max: '*' },
  ] },
};

async function validateReferenceSlices(
  references: string[],
  targets: Map<string, { resourceType: string; id: string; accepted: boolean }>,
  resolverPresent: boolean,
  conformancePresent: boolean,
  rules: 'open' | 'openAtEnd' | 'closed' = 'open',
) {
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(async canonical => canonical === targetCanonical ? targetProfile : null);
  const definition = structuredClone(profile);
  definition.snapshot!.element[1].slicing!.rules = rules;
  const elements = references.map(reference => ({ reference }));
  const resource = { resourceType: 'DiagnosticReport', result: elements };
  return validator.validateSlicing(
    elements, resultPath, definition,
    resolverPresent ? reference => targets.get(reference) ?? null : null,
    resultPath, 'R4', resource, resultPath,
    conformancePresent ? async target => {
      if (!target || typeof target !== 'object' || !('accepted' in target)) return undefined;
      return target.accepted === true;
    } : undefined,
  );
}

describe('open target-profile slices preserve missing-reference uncertainty', () => {
  it.each([false, true])('does not turn an unread target into an open-slice nonmember (resolver %s)', async resolverPresent => {
    const issues = await validateReferenceSlices(['Observation/missing'], new Map(), resolverPresent, true);
    expect(issues.some(issue => issue.code === 'profile-slice-open-unmatched')).toBe(false);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'profile-slice-validation-incomplete',
      details: expect.objectContaining({ validationComplete: false, reason: 'unresolved-reference-discriminator' }),
    })]));
    expect(issues.some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(false);
  });

  it('retains the missing-target state when a conformance callback is unavailable', async () => {
    const issues = await validateReferenceSlices(['Observation/missing'], new Map(), false, false);
    expect(issues.some(issue => issue.code === 'profile-slice-open-unmatched')).toBe(false);
    expect(issues.some(issue => issue.code === 'profile-slice-validation-incomplete')).toBe(true);
  });

  it.each(['open', 'openAtEnd', 'closed'] as const)('keeps proved nonmembers beside unknown targets for %s slicing', async rules => {
    const targets = new Map([['Observation/rejected', {
      resourceType: 'Observation', id: 'rejected', accepted: false,
    }]]);
    const issues = await validateReferenceSlices(['Observation/rejected', 'Observation/missing'], targets, true, true, rules);
    expect(issues.some(issue => issue.code === 'profile-slice-validation-incomplete')).toBe(true);
    const openAdvice = issues.filter(issue => issue.code === 'profile-slice-open-unmatched');
    expect(openAdvice.map(issue => issue.path)).toEqual(rules === 'closed' ? [] : [`${resultPath}[0]`]);
    expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(rules === 'closed');
  });

  it.each([false, true])('keeps a complete target conformance verdict when the target is available (accepted %s)', async accepted => {
    const targets = new Map([['Observation/available', {
      resourceType: 'Observation', id: 'available', accepted,
    }]]);
    const issues = await validateReferenceSlices(['Observation/available'], targets, true, true);
    expect(issues.some(issue => issue.code === 'profile-slice-validation-incomplete')).toBe(false);
    expect(issues.filter(issue => issue.code === 'profile-slice-open-unmatched')).toHaveLength(accepted ? 0 : 1);
  });
});
