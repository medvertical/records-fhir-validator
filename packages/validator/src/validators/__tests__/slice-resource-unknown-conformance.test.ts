import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { SlicingValidator } from '../slicing-validator.js';

const canonical = 'https://profiles.ihe.net/ITI/MHD/StructureDefinition/IHE.MHD.Minimal.SubmissionSet';
const path = 'Bundle.entry';
const host: StructureDefinition = {
  resourceType: 'StructureDefinition', url: 'https://example.test/StructureDefinition/Loop90ResourceUnknownHost',
  name: 'ResourceUnknownHost', status: 'active', kind: 'resource', abstract: false, type: 'Bundle', fhirVersion: '4.0.1',
  snapshot: { element: [
    { id: 'Bundle', path: 'Bundle' },
    { id: path, path, min: 0, max: '*', type: [{ code: 'BackboneElement' }],
      slicing: { discriminator: [{ type: 'profile', path: 'resource' }], rules: 'closed' } },
    { id: `${path}:SubmissionSet`, path, sliceName: 'SubmissionSet', min: 1, max: '1', type: [{ code: 'BackboneElement' }] },
    { id: `${path}:SubmissionSet.resource`, path: `${path}.resource`, min: 1, max: '1',
      type: [{ code: 'Resource', profile: [canonical] }] },
  ] },
};
const readable = (expression: string): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: canonical, name: 'ReadableUnknownList', status: 'active',
  kind: 'resource', abstract: false, type: 'List', fhirVersion: '4.0.1', snapshot: { element: [
    { id: 'List', path: 'List', constraint: [{ key: 'own-unknown-1', severity: 'error',
      human: 'The imported root invariant must be evaluated before conformance can be known', expression }] },
    { id: 'List.code', path: 'List.code', min: 1, max: '1',
      patternCodeableConcept: { coding: [{ code: 'submissionset' }] } },
  ] },
});
async function run(count: number, expression: string, claimProfile: boolean, suppliedCallback: boolean | 'P' | 'N') {
  const entries = Array.from({ length: count }, () => ({ resource: {
    resourceType: 'List', code: { coding: [{ code: 'submissionset' }] },
    ...(claimProfile ? { meta: { profile: [canonical] } } : {}),
  } }));
  const bundle = { resourceType: 'Bundle', entry: entries };
  let callbackCalls = 0;
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(async requested => requested === canonical ? readable(expression) : null);
  const issues = await validator.validateSlicing(entries, path, host, null, path, 'R4', bundle, path,
    suppliedCallback ? async () => { callbackCalls++; return suppliedCallback === 'P' ? true : suppliedCallback === 'N' ? false : undefined; } : undefined);
  return { issues, callbackCalls };
}
const incomplete = (issues: Awaited<ReturnType<typeof run>>['issues']) =>
  issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false);
const sliceErrors = (issues: Awaited<ReturnType<typeof run>>['issues']) => issues.filter(issue =>
  issue.severity === 'error' && ['profile-slice-min-cardinality', 'profile-slice-max-cardinality',
    'profile-slice-closed-unmatched'].includes(issue.code ?? ''));

describe('Resource profile unknown conformance', () => {
  it('keeps supplied callback U authoritative over a claimed meta.profile and sole admitted type', async () => {
    const result = await run(1, 'thisFunctionIsNotDefined()', true, true);
    expect(result.callbackCalls).toBeGreaterThan(0);
    expect(incomplete(result.issues)).toBe(true);
    expect(sliceErrors(result.issues)).toEqual([]);
  });

  it('does not count two supplied callback-U Resources as two proved slice members', async () => {
    const result = await run(2, 'thisFunctionIsNotDefined()', true, true);
    expect(result.callbackCalls).toBeGreaterThan(0);
    expect(incomplete(result.issues)).toBe(true);
    expect(sliceErrors(result.issues)).toEqual([]);
  });

  it('keeps a single readable local profile with an unsupported invariant U without an external callback', async () => {
    const result = await run(1, 'thisFunctionIsNotDefined()', false, false);
    expect(result.callbackCalls).toBe(0);
    expect(incomplete(result.issues)).toBe(true);
    expect(sliceErrors(result.issues)).toEqual([]);
  });

  it('does not turn two local invariant-U Resources into a proved maximum violation through type fallback', async () => {
    const result = await run(2, 'thisFunctionIsNotDefined()', false, false);
    expect(incomplete(result.issues)).toBe(true);
    expect(sliceErrors(result.issues)).toEqual([]);
  });

  it('does not turn an evaluation-error U into a proved maximum violation through meta.profile', async () => {
    const result = await run(2, '%undefinedLoop90Variable', true, false);
    expect(incomplete(result.issues)).toBe(true);
    expect(sliceErrors(result.issues)).toEqual([]);
  });
  it('keeps a proved callback P maximum violation despite local invariant U', async () => {
    const result = await run(2, 'thisFunctionIsNotDefined()', true, 'P');
    expect(result.callbackCalls).toBeGreaterThan(0);
    expect(sliceErrors(result.issues).map(issue => issue.code)).toEqual(['profile-slice-max-cardinality']);
  });

  it('keeps a proved callback N minimum and closed rejection despite local invariant U', async () => {
    const result = await run(1, 'thisFunctionIsNotDefined()', true, 'N');
    expect(result.callbackCalls).toBeGreaterThan(0);
    expect(incomplete(result.issues)).toBe(false);
    expect(sliceErrors(result.issues).map(issue => issue.code).sort()).toEqual([
      'profile-slice-closed-unmatched', 'profile-slice-min-cardinality',
    ]);
  });
});
