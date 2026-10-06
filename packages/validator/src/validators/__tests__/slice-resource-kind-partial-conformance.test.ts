import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { SlicingValidator } from '../slicing-validator.js';

const path = 'Bundle.entry';
const canonical = (name: string) => `https://example.test/StructureDefinition/OwnedResourceKind${name}`;
const host: StructureDefinition = {
  resourceType: 'StructureDefinition', url: canonical('Host'), name: 'OwnedResourceKindHost',
  status: 'active', kind: 'resource', abstract: false, type: 'Bundle', fhirVersion: '4.0.1', snapshot: { element: [
    { id: 'Bundle', path: 'Bundle' },
    { id: path, path, min: 0, max: '*', type: [{ code: 'BackboneElement' }],
      slicing: { discriminator: [{ type: 'profile', path: 'resource' }], rules: 'closed' } },
    ...['ListU', 'PatientRequired'].flatMap(name => [
      { id: `${path}:${name}`, path, sliceName: name, min: 1, max: '1', type: [{ code: 'BackboneElement' }] },
      { id: `${path}:${name}.resource`, path: `${path}.resource`, min: 1, max: '1',
        type: [{ code: 'Resource', profile: [canonical(name)] }] },
    ]),
  ] },
};
const list: StructureDefinition = {
  resourceType: 'StructureDefinition', url: canonical('ListU'), name: 'OwnedResourceKindList', status: 'active',
  kind: 'resource', abstract: false, type: 'List', fhirVersion: '4.0.1', snapshot: { element: [
    { id: 'List', path: 'List', constraint: [{ key: 'own-kind-unknown-1', severity: 'error',
      human: 'This owned List invariant must be evaluated before membership is known', expression: 'thisFunctionIsNotDefined()' }] },
    { id: 'List.code', path: 'List.code', min: 1, max: '1', patternCodeableConcept: { coding: [{ code: 'submissionset' }] } },
  ] },
};
const patient: StructureDefinition = {
  resourceType: 'StructureDefinition', url: canonical('PatientRequired'), name: 'OwnedResourceKindPatient', status: 'active',
  kind: 'resource', abstract: false, type: 'Patient', fhirVersion: '4.0.1', snapshot: { element: [
    { id: 'Patient', path: 'Patient', min: 0, max: '1' },
    { id: 'Patient.active', path: 'Patient.active', min: 0, max: '1', type: [{ code: 'boolean' }] },
  ] },
};
async function run(knownPatientType: boolean | 'Resource' | 'DomainResource', suppliedCallback: boolean, concreteListSpec = false) {
  const value = { resourceType: 'List', code: { coding: [{ code: 'submissionset' }] } };
  const entries = [{ resource: value }];
  const bundle = { resourceType: 'Bundle', entry: entries };
  const unresolved = { ...patient, type: undefined } as unknown as StructureDefinition;
  const generic = typeof knownPatientType === 'string' ? {
    ...patient, type: knownPatientType, abstract: true,
    snapshot: { element: [{ id: knownPatientType, path: knownPatientType, min: 0, max: '1' }] },
  } : undefined;
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(async requested => requested === list.url ? list
    : requested === patient.url ? generic ?? (knownPatientType ? patient : unresolved) : null);
  const selectedHost = concreteListSpec ? { ...host, snapshot: { element: host.snapshot!.element.map(element =>
    element.id === `${path}:PatientRequired.resource` ? { ...element, type: [{ code: 'List', profile: [patient.url] }] } : element,
  ) } } : host;
  const issues = await validator.validateSlicing(entries, path, selectedHost, null, path, 'R4', bundle, path,
    suppliedCallback ? async () => undefined : undefined);
  return { issues,
    incomplete: issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false),
  };
}
function expectPatientMinimum(result: Awaited<ReturnType<typeof run>>) {
  const minima = result.issues.filter(issue => issue.code === 'profile-slice-min-cardinality');
  expect(minima).toHaveLength(1);
  expect(minima[0].ruleId).toBe('slice-min-PatientRequired');
  expect(result.incomplete).toBe(true);
  expect(result.issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(false);
}

describe('Independent Resource-kind rejection beside local profile U', () => {
  it('retains Patient-min1 N from the loaded different SD.type without a callback or TYPE discriminator', async () => {
    expectPatientMinimum(await run(true, false));
  });

  it('retains the same independent kind N with a supplied callback U', async () => {
    expectPatientMinimum(await run(true, true));
  });

  it.each([false, true])('keeps an owner without declared SD.type U, suppliedCallback=%s', async suppliedCallback => {
    const result = await run(false, suppliedCallback);
    expect(result.issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toEqual([]);
    expect(result.incomplete).toBe(true);
    expect(result.issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(false);
  });
  it.each(['Resource', 'DomainResource'] as const)('keeps a loaded generic %s SD.type U beside List U', async generic => {
    const result = await run(generic, false);
    expect(result.issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toEqual([]);
    expect(result.incomplete).toBe(true);
    expect(result.issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(false);
  });
  it.each(['Resource', 'DomainResource'] as const)('keeps loaded generic %s U when a concrete List element type admits the value', async generic => {
    const result = await run(generic, false, true);
    expect(result.issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toEqual([]);
    expect(result.incomplete).toBe(true);
    expect(result.issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(false);
  });
});
