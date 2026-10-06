import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SnapshotElementMerger } from '../snapshot-element-merger.js';
import { StructureDefinitionLoader } from '../structure-definition-loader.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { createProfileBindingSelector } from '../../validators/profile-binding-selection.js';
import { SlicingValidator } from '../../validators/slicing-validator.js';
import { ValueSetCache } from '../../validators/valueset-cache.js';
import { ValueSetValidator } from '../../validators/valueset-validator.js';

const choicePath = 'Medication.ingredient.item[x]';
const conceptId = `${choicePath}:itemCodeableConcept`;
const referenceId = `${choicePath}:itemReference`;
const valueSet = 'https://example.test/ValueSet/choice-binding';
const system = 'https://example.test/CodeSystem/choice-binding';
const required = { strength: 'required' as const, valueSet: `${valueSet}|1.0.0` };
let loader: StructureDefinitionLoader;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'records-choice-snapshot-'));
  const cache = path.join(root, 'packages'); const bundled = path.join(root, 'bundled');
  await mkdir(cache); await mkdir(bundled);
  loader = new StructureDefinitionLoader(cache, bundled, { autoDownload: false, prewarmProfileSource: false });
  await loader.waitForInitialization();
});
afterAll(async () => {
  loader?.clearCache();
  if (root) await rm(root, { recursive: true, force: true });
});

function base(): ElementDefinition[] {
  return [{ id: 'Medication', path: 'Medication', min: 0, max: '*' },
    { id: 'Medication.ingredient', path: 'Medication.ingredient', min: 0, max: '*', type: [{ code: 'BackboneElement' }] },
    { id: choicePath, path: choicePath, min: 0, max: '1', type: [{ code: 'Reference' }, { code: 'CodeableConcept' }] }];
}
function differential(both = true): ElementDefinition[] {
  return [
    ...(both ? [{ id: referenceId, path: choicePath, sliceName: 'itemReference', min: 0, max: '1', type: [{ code: 'Reference' }] }] : []),
    { id: conceptId, path: choicePath, sliceName: 'itemCodeableConcept', min: 0, max: '1', type: [{ code: 'CodeableConcept' }] },
    { id: `${conceptId}.coding`, path: `${choicePath}.coding`, min: 0, max: '*', type: [{ code: 'Coding' }], binding: required },
  ];
}
function profile(elements: ElementDefinition[]): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: 'https://example.test/StructureDefinition/choice-binding',
    name: 'ChoiceBinding', status: 'active', kind: 'resource', abstract: false, type: 'Medication',
    fhirVersion: '4.0.1', snapshot: { element: elements } };
}
async function select(elements: ElementDefinition[], code = 'allowed') {
  const concept = { coding: [{ system, code }] };
  const resource = { resourceType: 'Medication', ingredient: [{ itemCodeableConcept: concept }] };
  const fullPath = 'Medication.ingredient[0].itemCodeableConcept.coding[0]';
  const selected = await createProfileBindingSelector({ profile: profile(elements), rootResource: resource,
    basePath: 'Medication.ingredient[0].itemCodeableConcept', value: concept, fhirVersion: 'R4', loader })(undefined, fullPath);
  return { selected, coding: concept.coding[0], fullPath };
}
async function membership(code: string, available = true) {
  const elements = new SnapshotElementMerger().merge(base(), differential(), true);
  const result = await select(elements, code);
  expect(result.selected.issues).toEqual([]);
  expect(result.selected.binding).toEqual(required);
  const validator = new ValueSetValidator(new ValueSetCache(), undefined, []);
  validator.setResolutionConfig({ strategy: 'local-only', servers: [], serverUrl: '',
    reportUnverifiedBindings: true, strictUnverifiedRequiredBindings: false });
  if (available) {
    expect(validator.registerExternalTerminologyResource({ resourceType: 'CodeSystem', url: system,
      version: '1.0.0', status: 'active', content: 'complete', caseSensitive: true,
      concept: [{ code: 'allowed' }, { code: 'outside' }] }, 'R4')).toBe(true);
    expect(validator.registerExternalTerminologyResource({ resourceType: 'ValueSet', url: valueSet,
      version: '1.0.0', status: 'active', compose: { include: [{ system, version: '1.0.0', concept: [{ code: 'allowed' }] }] } }, 'R4')).toBe(true);
  }
  try {
    return await validator.validateBinding(result.coding, result.selected.binding, result.fullPath, { fhirVersion: 'R4' });
  } finally { validator.clearCache(); }
}

// These are new minimal metadata contracts; they do not reconstruct the original Medication input.
describe('prepared disjoint choice type slices', () => {
  it('prepares closed type slicing only with complete actual type coverage and preserves inputs', () => {
    const parent = base(); const variants = differential();
    const before = JSON.stringify({ parent, variants });
    const elements = new SnapshotElementMerger().merge(parent, variants, true);
    expect(elements.find(element => element.id === choicePath)?.slicing).toEqual({
      discriminator: [{ type: 'type', path: '$this' }], ordered: false, rules: 'closed' });
    expect(elements.find(element => element.id === choicePath)?.type).toEqual(parent[2].type);
    expect(JSON.stringify({ parent, variants })).toBe(before);
    expect(elements.map(element => element.id)).toEqual([...parent.map(element => element.id), ...variants.map(element => element.id)]);
  });

  it('keeps unspecified allowed Reference values valid through open choice slicing', async () => {
    const parent = base(); const elements = new SnapshotElementMerger().merge(parent, differential(false), true);
    expect(elements.find(element => element.id === choicePath)?.slicing?.rules).toBe('open');
    expect(elements.find(element => element.id === choicePath)?.type).toEqual(parent[2].type);
    const reference = { reference: 'Medication/own-control' };
    const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
    const issues = await validator.validateSlicing([reference], choicePath, profile(elements), null, choicePath, 'R4');
    expect(issues).toEqual([expect.objectContaining({ code: 'profile-slice-open-unmatched',
      severity: 'information', path: `${choicePath}[0]` })]);
    expect(issues.some(issue => issue.severity === 'error' || issue.severity === 'fatal'
      || issue.details?.validationComplete === false || issue.details?.validationStatus === 'incomplete')).toBe(false);
  });

  it('P: selects the new required choice binding and accepts an own member', async () => {
    expect(await membership('allowed')).toEqual([]);
  });
  it('N: preserves rejection by the selected new required binding', async () => {
    const issues = await membership('outside');
    expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-required', severity: 'error' }));
    expect(issues.some(issue => issue.details?.validationComplete === false)).toBe(false);
  });
  it('U: preserves unavailable terminology after conclusive choice selection', async () => {
    const issues = await membership('allowed', false);
    expect(issues).toHaveLength(1);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-unverified', severity: 'information',
      details: expect.objectContaining({ validationStatus: 'incomplete', reason: 'binding-unverified',
        terminologyDiagnostic: expect.objectContaining({ cause: 'empty-expansion', localExpansion: 'none',
          serverAttempts: [], serverSkipped: 'delegation-disabled', packageScope: 'none' }) }) }));
    expect(issues.some(issue => issue.severity === 'error' || issue.severity === 'fatal')).toBe(false);
  });

  it('preserves explicit slicing and cannot infer a nonchoice, same-type or typeless group', async () => {
    const explicit = base(); explicit[2].slicing = { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'openAtEnd', ordered: true };
    const actual = new SnapshotElementMerger().merge(explicit, differential(), false);
    expect(actual.find(element => element.id === choicePath)?.slicing).toEqual(explicit[2].slicing);
    for (const qualification of ['nonchoice', 'same-type', 'typeless', 'foreign-type'] as const) {
      const parent = base(); const variants = differential();
      if (qualification === 'nonchoice') {
        for (const element of [...parent, ...variants]) {
          element.path = element.path.replace('[x]', ''); element.id = element.id?.replace('[x]', '');
        }
      }
      if (qualification === 'same-type') variants[0].type = [{ code: 'CodeableConcept' }];
      if (qualification === 'typeless') delete variants[0].type;
      if (qualification === 'foreign-type') variants[0].type = [{ code: 'Quantity' }];
      const elements = new SnapshotElementMerger().merge(parent, variants, false);
      expect(elements.find(element => element.id === parent[2].id)?.slicing, qualification).toBeUndefined();
      if (qualification === 'nonchoice') continue;
      const selected = (await select(elements)).selected;
      expect(selected.binding, qualification).toBeUndefined();
      expect(selected.issues.some(issue => issue.details?.reason === 'binding-slice-membership-unverified'), qualification).toBe(true);
    }
  });

  it('uses the exact containing slice scope and leaves duplicate bases and Extension value policy unchanged', () => {
    const parent = base(); const variants = differential();
    for (const element of [...parent.slice(1), ...variants]) element.id = element.id?.replace('Medication.ingredient', 'Medication.ingredient:ownScope');
    const nested = new SnapshotElementMerger().merge(parent, variants, false);
    expect(nested.find(element => element.id === parent[2].id)?.slicing?.rules).toBe('closed');
    const duplicatedBase = base(); duplicatedBase.push(structuredClone(duplicatedBase[2]));
    expect(new SnapshotElementMerger().merge(duplicatedBase, differential(), false)
      .filter(element => element.id === choicePath).every(element => element.slicing === undefined)).toBe(true);
    for (const malformed of [undefined, null, 'not-an-array', {}, [{ code: '' }], [{ code: ' ' }]]) {
      const partial = base(); partial[2].type = malformed as ElementDefinition['type'];
      expect(new SnapshotElementMerger().merge(partial, [], false)[2].slicing).toBeUndefined();
    }
    const invalidParent = base(); const invalidVariants = differential();
    invalidParent[2].type = [{ code: 17 }, { code: 18 }] as unknown as ElementDefinition['type'];
    invalidVariants[0].type = [{ code: 17 }] as unknown as ElementDefinition['type'];
    invalidVariants[1].type = [{ code: 18 }] as unknown as ElementDefinition['type'];
    expect(new SnapshotElementMerger().merge(invalidParent, invalidVariants, false)[2].slicing).toBeUndefined();
    const pathless = base(); delete (pathless[2] as Partial<ElementDefinition>).path;
    expect(new SnapshotElementMerger().merge(pathless, [], false)[2].slicing).toBeUndefined();
    pathless[2].path = 17 as unknown as string;
    expect(new SnapshotElementMerger().merge(pathless, [], false)[2].slicing).toBeUndefined();
    const extension = [{ id: 'Extension.value[x]', path: 'Extension.value[x]', type: [{ code: 'string' }, { code: 'boolean' }] }];
    const extensionSlice = [{ id: 'Extension.value[x]:valueString', path: 'Extension.value[x]', sliceName: 'valueString', type: [{ code: 'string' }] }];
    expect(new SnapshotElementMerger().merge(extension, extensionSlice, false)[0]).toEqual(extension[0]);
    for (const element of [...extension, ...extensionSlice]) {
      element.path = element.path.replace('Extension.', 'Observation.extension.');
      element.id = element.id.replace('Extension.', 'Observation.extension.');
    }
    expect(new SnapshotElementMerger().merge(extension, extensionSlice, false)[0]).toEqual(extension[0]);
  });
});
