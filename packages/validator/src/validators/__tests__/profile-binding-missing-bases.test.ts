import { describe, expect, it, vi } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types';
import type { StructureDefinitionLoader } from '../../core/structure-definition-loader';
import { createProfileBindingSelector } from '../profile-binding-selection';
import { prepareProfileBindingSlicingBases } from '../profile-binding-slicing-bases';
import { ValueSetValidator } from '../valueset-validator';

const system = 'https://example.test/CodeSystem/slice';
const valueSet = (name: string) => `https://example.test/ValueSet/${name}`;
const alphaUrl = 'https://example.test/StructureDefinition/alpha';
const binding = (name: string) => ({ strength: 'required' as const, valueSet: valueSet(name) });
const slicing = { discriminator: [{ type: 'value' as const, path: 'url' }], rules: 'open' as const };
const code = (name: string) => ({ coding: [{ system, code: name }] });
const extension = (name: string, coding = name) => ({ url: `urn:${name}`, valueCodeableConcept: code(coding) });

function slice(name: string, prefix = 'Procedure.extension'): ElementDefinition[] {
  const path = prefix.split('.').map(segment => segment.split(':')[0]).join('.');
  return [
    { id: `${prefix}:${name}`, path, sliceName: name, type: [{ code: 'Extension' }] },
    { id: `${prefix}:${name}.url`, path: `${path}.url`, fixedUri: `urn:${name}` },
    { id: `${prefix}:${name}.value[x]`, path: `${path}.value[x]`, type: [{ code: 'CodeableConcept' }], binding: binding(name) },
  ];
}
function profile(elements: ElementDefinition[] = [
  { path: 'Procedure.extension', type: [{ code: 'Extension' }], slicing }, ...slice('alpha'), ...slice('beta'),
]): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: 'https://example.test/StructureDefinition/procedure',
    name: 'ProcedureProfile', status: 'active', kind: 'resource', abstract: false, type: 'Procedure', fhirVersion: '4.0.1',
    snapshot: { element: [{ id: 'Procedure', path: 'Procedure' }, ...elements] } };
}
function selector(selected: StructureDefinition, items = [extension('alpha'), extension('beta')]) {
  const rootResource = { resourceType: 'Procedure', extension: items };
  const loadReferencedProfile = vi.fn(async (_url: string, _source?: StructureDefinition, _family?: string) => null);
  const loader = { loadReferencedProfile } as unknown as StructureDefinitionLoader;
  return { select: createProfileBindingSelector({ profile: selected, rootResource, basePath: 'Procedure',
    value: rootResource, fhirVersion: 'R4', loader }), loadReferencedProfile, rootResource };
}
function terminology(missingAlpha = false) {
  const validator = new ValueSetValidator(undefined, undefined, []);
  validator.setResolutionConfig({ strategy: 'local-only', reportUnverifiedBindings: true });
  validator.registerExternalTerminologyResource({ resourceType: 'CodeSystem', url: system, version: '1',
    status: 'active', content: 'complete', concept: ['alpha', 'beta', 'type', 'taken'].map(name => ({ code: name })) });
  for (const name of ['alpha', 'beta', 'type', 'taken'].filter(name => !missingAlpha || name !== 'alpha')) validator.registerExternalTerminologyResource({
    resourceType: 'ValueSet', url: valueSet(name), status: 'active',
    compose: { include: [{ system, concept: [{ code: name }] }] },
  });
  return validator;
}
function expectUnknown(result: Awaited<ReturnType<ReturnType<typeof createProfileBindingSelector>>>) {
  expect(result.binding).toBeUndefined();
  expect(result.issues).toEqual([expect.objectContaining({ code: 'terminology-binding-unverified',
    details: expect.objectContaining({ reason: 'binding-slice-membership-unverified', validationComplete: false }) })]);
}

function nestedProfile() {
  return profile([
    { path: 'Procedure.extension', slicing },
    { id: 'Procedure.extension:alpha', path: 'Procedure.extension', sliceName: 'alpha', type: [{ code: 'Extension' }] },
    { path: 'Procedure.extension.extension', slicing },
    ...slice('type', 'Procedure.extension:alpha.extension'), ...slice('taken', 'Procedure.extension:alpha.extension'),
    { id: 'Procedure.extension:alpha.url', path: 'Procedure.extension.url', fixedUri: 'urn:alpha' },
    ...slice('beta'),
  ]);
}

function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}

describe('own snapshot slicing bases with optional element IDs', () => {
  it.each([false, true])('selects different occurrences in either order without caching membership (%s)', async reverse => {
    const items = [extension('alpha'), extension('beta')]; if (reverse) items.reverse();
    const { select } = selector(profile(), items);
    for (const index of [1, 0, 1, 0]) {
      const selected = await select(undefined, `Procedure.extension[${index}].valueCodeableConcept`);
      expect(selected).toEqual({ binding: binding(items[index].url.slice(4)), issues: [] });
    }
    const next = selector(profile(), [...items].reverse());
    expect((await next.select(undefined, 'Procedure.extension[0].valueCodeableConcept')).binding)
      .toEqual(binding(items[1].url.slice(4)));
  });
  it('preserves positive and negative required-binding decisions after proven selection', async () => {
    const validator = terminology(); const { select } = selector(profile());
    const path = 'Procedure.extension[0].valueCodeableConcept';
    const selected = await select(undefined, path);
    expect(selected.issues).toEqual([]);
    expect(selected.binding).toEqual(binding('alpha'));
    expect(await validator.validateBinding(code('alpha'), selected.binding, path, { fhirVersion: 'R4' })).toEqual([]);
    expect(await validator.validateBinding(code('beta'), selected.binding, path, { fhirVersion: 'R4' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', path })]));
  });
  it('keeps missing terminology unknown after proven slice selection', async () => {
    const path = 'Procedure.extension[0].valueCodeableConcept';
    const selected = await selector(profile()).select(undefined, path);
    expect(selected).toEqual({ binding: binding('alpha'), issues: [] });
    const issues = await terminology(true).validateBinding(code('alpha'), selected.binding, path, { fhirVersion: 'R4' });
    expect(issues.some(issue => issue.details?.validationComplete === false || issue.code.includes('unverified'))).toBe(true);
    expect(issues.every(issue => issue.severity !== 'error')).toBe(true);
  });
  it('retains a base binding for a known nonmember of an open group', async () => {
    const { select } = selector(profile(), [extension('other')]);
    expect(await select(binding('base'), 'Procedure.extension[0].valueCodeableConcept'))
      .toEqual({ binding: binding('base'), issues: [] });
  });
  it.each([false, true])('uses the actual nested occurrence and keeps the enclosing owner (%s)', async reverse => {
    const selected = nestedProfile(); const inner = [extension('type'), extension('taken')]; if (reverse) inner.reverse();
    const rootResource = { resourceType: 'Procedure', extension: [{ url: 'urn:alpha', extension: inner }, extension('beta')] };
    const loader = { loadReferencedProfile: vi.fn(async () => null) } as unknown as StructureDefinitionLoader;
    const select = createProfileBindingSelector({ profile: selected, rootResource, basePath: 'Procedure',
      value: rootResource, fhirVersion: 'R4', loader });
    for (const index of [1, 0, 1]) expect(await select(undefined,
      `Procedure.extension[0].extension[${index}].valueCodeableConcept`))
      .toEqual({ binding: binding(inner[index].url.slice(4)), issues: [] });
    expect(await select(undefined, 'Procedure.extension[1].valueCodeableConcept'))
      .toEqual({ binding: binding('beta'), issues: [] });
  });
  it('keeps unknown membership when a coherent slice lacks discriminator evidence', async () => {
    const selected = profile(); selected.snapshot!.element = selected.snapshot!.element.filter(element => !element.id?.endsWith('.url'));
    expectUnknown(await selector(selected).select(undefined, 'Procedure.extension[0].valueCodeableConcept'));
  });
  it.each(['two-missing', 'explicit-and-missing'] as const)('keeps ambiguous bases unknown (%s)', async kind => {
    const selected = profile(); const base = selected.snapshot!.element[1];
    selected.snapshot!.element.splice(1, 0, { ...base, ...(kind === 'explicit-and-missing' ? { id: base.path } : {}) });
    expectUnknown(await selector(selected).select(undefined, 'Procedure.extension[0].valueCodeableConcept'));
  });
  it.each(['slice', 'binding'] as const)('does not repair real duplicate IDs (%s)', async kind => {
    const selected = profile(); const duplicate = selected.snapshot!.element[kind === 'slice' ? 2 : 4];
    selected.snapshot!.element.push({ ...duplicate });
    expectUnknown(await selector(selected).select(undefined, 'Procedure.extension[0].valueCodeableConcept'));
  });
  it.each(['missing-fhir', 'foreign-fhir', 'kind', 'abstract', 'root-id', 'slice-id', 'non-direct-discriminator'] as const)('does not infer missing bases without the required own authority (%s)', async fault => {
      const selected = profile(); const elements = selected.snapshot!.element;
      if (fault === 'missing-fhir') delete selected.fhirVersion;
      if (fault === 'foreign-fhir') selected.fhirVersion = '5.0.0';
      if (fault === 'kind') selected.kind = 'complex-type';
      if (fault === 'abstract') selected.abstract = true;
      if (fault === 'root-id') elements[0].id = 'Resource';
      if (fault === 'slice-id') elements[2].id = 'Procedure.extension:foreign';
      if (fault === 'non-direct-discriminator') elements[1].slicing = { discriminator: [{ type: 'value', path: 'resolve().url' }] };
      expectUnknown(await selector(selected).select(undefined, 'Procedure.extension[0].valueCodeableConcept'));
    });
  it.each(['unclaimed-colon', 'wrong-suffix', 'missing-parent'] as const)('does not borrow an unclear snapshot ancestor (%s)', fault => {
      const owner: ElementDefinition[] = fault === 'unclaimed-colon'
        ? [{ id: 'Procedure.part:unclaimed', path: 'Procedure.part' }]
        : [{ id: 'Procedure.part:own', path: 'Procedure.part', sliceName: 'own' },
          { ...(fault === 'wrong-suffix' ? { id: 'Procedure.part:own.wrong' } : {}), path: 'Procedure.part.child' }];
      const prefix = fault === 'unclaimed-colon' ? 'Procedure.part.extension' : 'Procedure.part:own.child.extension';
      const path = prefix.split('.').map(segment => segment.split(':')[0]).join('.');
      const selected = profile([...owner, { path, slicing }, ...slice('alpha', prefix)]);
      expect(prepareProfileBindingSlicingBases(selected, 'R4').elements).toBe(selected.snapshot!.element);
    });
  it('requires the basis to precede its slices within the same own branch', () => {
    const selected = profile([...slice('alpha'), { path: 'Procedure.extension', slicing }]);
    expect(prepareProfileBindingSlicingBases(selected, 'R4').elements).toBe(selected.snapshot!.element);
  });
  it('prepares only local copies and resolves type profiles with the original owner object', async () => {
    const selected = profile(); selected.snapshot!.element[2].type = [{ code: 'Extension', profile: [alphaUrl] }];
    const before = JSON.stringify(selected); frozen(selected);
    const rootResource = frozen({ resourceType: 'Procedure', extension: [extension('alpha')] });
    const ownExtension: StructureDefinition = { resourceType: 'StructureDefinition', url: alphaUrl, name: 'Alpha', status: 'active',
      kind: 'complex-type', abstract: false, type: 'Extension', fhirVersion: '4.0.1', snapshot: { element: [
        { id: 'Extension', path: 'Extension' }, { id: 'Extension.url', path: 'Extension.url', fixedUri: 'urn:alpha' },
      ] } };
    const loadReferencedProfile = vi.fn(async (url: string, _source?: StructureDefinition, _family?: string) => url === alphaUrl ? ownExtension : null);
    const loader = { loadReferencedProfile } as unknown as StructureDefinitionLoader;
    const select = createProfileBindingSelector({ profile: selected, rootResource, basePath: 'Procedure',
      value: rootResource, fhirVersion: 'R4', loader });
    expect(await select(undefined, 'Procedure.extension[0].valueCodeableConcept'))
      .toEqual({ binding: binding('alpha'), issues: [] });
    expect(loadReferencedProfile).toHaveBeenCalledWith(alphaUrl, selected, 'R4');
    for (const call of loadReferencedProfile.mock.calls) expect(call[1]).toBe(selected);
    expect(JSON.stringify(selected)).toBe(before);
    expect(selected.snapshot!.element[1].id).toBeUndefined();
    const prepared = prepareProfileBindingSlicingBases(selected, 'R4').elements;
    expect(prepared).not.toBe(selected.snapshot!.element); expect(prepared[1].id).toBe('Procedure.extension');
    expect(prepared[2]).toBe(selected.snapshot!.element[2]);
  });
});
