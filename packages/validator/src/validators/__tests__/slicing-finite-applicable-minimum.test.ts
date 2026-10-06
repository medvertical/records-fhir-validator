import { describe, expect, it } from 'vitest';
import { ProfileSlicingValidation } from '../../core/executors/profile-slicing-validation.js';
import { getValueAtPath } from '../../core/validation-utils.js';
import { SlicingValidator } from '../slicing-validator.js';
import { extractSlicingInfo } from '../slice-info-extractor.js';
import type { StructureDefinition, ElementDefinition, SlicingDiscriminator } from '../../core/structure-definition-types.js';

const baseUrl = 'http://hl7.org/fhir/StructureDefinition/';
const path = 'List.entry';
const unknown = { item: { reference: 'urn:uuid:unavailable' } };
const known = { item: { reference: 'urn:uuid:available' } };
function fixture(min: number, discriminator: SlicingDiscriminator = { type: 'type', path: 'item.resolve()' }, field = path): StructureDefinition {
  const target = (sliceName: string, required: number, type: string): ElementDefinition[] => [
    { id: `${field}:${sliceName}`, path: field, sliceName, min: required, max: '*', type: [{ code: 'BackboneElement' }] },
    { id: `${field}:${sliceName}.item`, path: `${field}.item`, min: 1, max: '1', type: [{ code: 'Reference', targetProfile: [`${baseUrl}${type}`] }] },
  ];
  return { resourceType: 'StructureDefinition', url: 'https://synthetic.records.example/finite-list', name: 'FiniteList', status: 'active', kind: 'resource', abstract: false, type: 'List', fhirVersion: '4.0.1',
    snapshot: { element: [{ id: 'List', path: 'List', min: 0, max: '*' },
      { id: field, path: field, min: 0, max: '*', type: [{ code: 'BackboneElement' }], slicing: { discriminator: [discriminator], rules: 'closed' } },
      ...field.split('.').slice(1, -1).map((_, index) => { const prefix = field.split('.').slice(0, index + 2).join('.'); return { id: prefix, path: prefix, min: 0, max: prefix.endsWith('.entry') ? '*' : '1', type: [{ code: prefix.endsWith('.entry') ? 'BackboneElement' : 'Reference' }] }; }),
      ...target('A', min, 'Observation'), ...target('B', 0, 'Patient')] } };
}
function validatorFor(definition: StructureDefinition) {
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(async canonical => ({ ...definition, url: canonical, type: canonical.slice(baseUrl.length), snapshot: { element: [] } }));
  return validator;
}
const resolveReference = (ref: string) => ref === 'urn:uuid:available' ? { resourceType: 'Observation' } : null;
function sourceGroup(elements: unknown[], field: string) {
  return field === path ? { resource: { resourceType: 'List', entry: elements }, instancePath: field }
    : { resource: { resourceType: 'List', entry: [{ item: { extension: elements } }] }, instancePath: 'List.entry[0].item.extension' };
}
async function run(definition: StructureDefinition, elements: unknown[], field = path, selectedId: string | undefined = field) {
  const context = sourceGroup(elements, field);
  return validatorFor(definition).validateSlicing(elements, field, definition, resolveReference, selectedId, 'R4', context.resource, context.instancePath);
}
const minimum = (issues: Awaited<ReturnType<typeof run>>) => issues.filter(i => i.code === 'profile-slice-min-cardinality');
const issueDetails = (issue: Awaited<ReturnType<typeof run>>[number] | undefined) => typeof issue?.details === 'object' ? issue.details : undefined;
const unresolved = (issues: Awaited<ReturnType<typeof run>>) => issues.find(i => issueDetails(i)?.validationComplete === false);

describe('Finite minimum uses definition and complete source-group evidence', () => {
  it.each(['type', 'profile'] as const)('%s impossible min2 retains upper-bound evidence', async type => {
    const issues = await run(fixture(2, { type, path: 'item.resolve()' }), [unknown]);
    expect(minimum(issues)).toHaveLength(1);
    expect(minimum(issues)[0]).toMatchObject({ severity: 'error', ruleId: 'slice-min-A', path, target: { elementId: `${path}:A`, sliceName: 'A' }, details: { cardinalityUpperBound: 1, occurrenceCount: 1 } });
    expect(minimum(issues)[0].message).toContain('no more than 1');
    expect(minimum(issues)[0].message).not.toContain('found 0');
    expect(unresolved(issues)?.details).toMatchObject({ validationComplete: false, validationStatus: 'incomplete' });
    expect(issues.some(i => i.code === 'profile-slice-closed-unmatched')).toBe(false);
  });
  it.each(['type', 'profile'] as const)('%s feasible min1 stays unknown without a min error', async type => {
    const issues = await run(fixture(1, { type, path: 'item.resolve()' }), [unknown]);
    expect(minimum(issues)).toEqual([]); expect(unresolved(issues)).toBeDefined();
  });
  it('unavailable reference retains a finite min independently of identity', async () => {
    const issues = await run(fixture(2, { type: 'exists', path: 'item.resolve().specimen' }), [unknown]);
    expect(minimum(issues)).toHaveLength(1); expect(issueDetails(minimum(issues)[0])?.cardinalityUpperBound).toBe(1);
    expect(issueDetails(unresolved(issues))?.reason).toBe('unresolved-reference-discriminator');
  });
  it('feasible blocked metadata cannot create a false min', async () => {
    const issues = await run(fixture(1, { type: 'exists', path: 'item.resolve().specimen' }), [unknown]);
    expect(minimum(issues)).toEqual([]); expect(unresolved(issues)).toBeDefined();
  });
  it('unsliced ancestor has an independently applicable local child group', async () => {
    const field = 'List.entry.item.extension';
    const issues = await run(fixture(2, { type: 'exists', path: 'item.resolve().specimen' }, field), [unknown], field);
    expect(minimum(issues)).toHaveLength(1); expect(minimum(issues)[0].target?.elementId).toBe(`${field}:A`);
  });
  it('empty group retains the existing known zero minimum diagnostic', async () => {
    const issues = await run(fixture(1), []); expect(minimum(issues)).toHaveLength(1);
    expect(issueDetails(minimum(issues)[0])?.cardinalityUpperBound).toBeUndefined();
  });
  it('known member remains accepted', async () => { expect((await run(fixture(1), [known])).filter(i => i.severity === 'error')).toEqual([]); });
  it('duplicate referent occurrences retain known max without deduplication', async () => {
    const definition = fixture(0); definition.snapshot!.element!.find(e => e.sliceName === 'A')!.max = '1';
    const issues = await run(definition, [known, known]); expect(issues.filter(i => i.code === 'profile-slice-max-cardinality')).toHaveLength(1);
    expect(minimum(issues)).toEqual([]);
  });
  it('actual extractor carries default selected identity', async () => {
    const extracted = await extractSlicingInfo(path, fixture(2), async () => null, null);
    expect(extracted).toMatchObject({ selectedSlicingElementId: path });
  });
  it('explicit selected identity is preserved without a public override', async () => {
    const field = 'List.entry.item.extension'; const definition = fixture(2, { type: 'exists', path: 'item.resolve().specimen' }, field);
    const base = definition.snapshot!.element!.find(e => e.id === field)!; base.id = 'List.entry:A.item.extension';
    for (const e of definition.snapshot!.element!) if (e.id?.startsWith(`${field}:`)) e.id = e.id.replace(field, base.id);
    const extracted = await extractSlicingInfo(field, definition, async () => null, null, base.id);
    expect(extracted).toMatchObject({ selectedSlicingElementId: base.id });
    expect(minimum(await run(definition, [unknown], field, base.id))).toEqual([]);
  });
  it.each(['known-A', 'known-not-A', 'unknown'] as const)('conditional %s parent cannot attest child minimum from its ID', async () => {
    const field = 'List.entry.item.extension'; const definition = fixture(2, { type: 'exists', path: 'item.resolve().specimen' }, field);
    const selected = 'List.entry:A.item.extension';
    for (const e of definition.snapshot!.element!) if (e.id?.startsWith(field)) e.id = e.id.replace(field, selected);
    expect(minimum(await run(definition, [unknown], field, selected))).toEqual([]);
  });
  it('a bare selected path cannot erase an alternative conditional declaration', async () => {
    const field = 'List.entry.item.extension'; const definition = fixture(2, { type: 'exists', path: 'item.resolve().specimen' }, field);
    definition.snapshot!.element!.push({ ...definition.snapshot!.element!.find(e => e.id === field)!, id: 'List.entry:A.item.extension' });
    expect(minimum(await run(definition, [unknown], field, field))).toEqual([]);
  });
  it('conditional same-path child metadata remains opaque even without its own slicing declaration', async () => {
    const field = 'List.entry.item.extension'; const definition = fixture(2, { type: 'exists', path: 'item.resolve().specimen' }, field);
    definition.snapshot!.element!.push({ id: 'List.entry:A.item.extension:X', path: field, sliceName: 'X', min: 2, max: '*' });
    expect(minimum(await run(definition, [unknown], field, field))).toEqual([]);
  });
  it('reslicing at the selected root is outside the new finite-bound subset', async () => {
    const definition = fixture(2); definition.snapshot!.element!.find(e => e.sliceName === 'A')!.slicing = { discriminator: [{ type: 'type', path: 'item.resolve()' }], rules: 'closed' };
    expect(minimum(await run(definition, [unknown]))).toEqual([]);
  });
  it('inferred slicing cannot manufacture selected-definition evidence', async () => {
    const definition = fixture(2); delete definition.snapshot!.element!.find(e => e.id === path)!.slicing;
    const extracted = await extractSlicingInfo(path, definition, async () => null, null, path);
    expect(extracted && 'selectedSlicingElementId' in extracted ? extracted.selectedSlicingElementId : undefined).toBeUndefined();
    expect(minimum(await run(definition, [unknown]))).toEqual([]);
  });
  it('legacy injected extractor without selected evidence remains compatible and opaque', async () => {
    const definition = fixture(2);
    const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null }, extractSlicingInfo: async () => ({ slicing: { discriminator: [{ type: 'exists', path: 'item.resolve().specimen' }], rules: 'closed' }, slices: [{ sliceName: 'A', path, min: 2, max: '*' }] }) });
    expect(minimum(await validator.validateSlicing([unknown], path, definition, () => null, path))).toEqual([]);
  });
  it('a differential alone does not attest a full snapshot group', async () => {
    const definition = fixture(2); definition.differential = definition.snapshot; delete definition.snapshot;
    expect(minimum(await run(definition, [unknown]))).toEqual([]);
  });

  it('a direct array without a source group stays opaque', async () => {
    const definition = fixture(2);
    const issues = await validatorFor(definition).validateSlicing([unknown], path, definition, resolveReference, path);
    expect(minimum(issues)).toEqual([]); expect(unresolved(issues)).toBeDefined();
  });
  it('a caller subset cannot claim the source collection upper bound', async () => {
    const definition = fixture(2); const elements = [unknown, unknown];
    const issues = await validatorFor(definition).validateSlicing(elements.slice(0, 1), path, definition, resolveReference, path, 'R4', { resourceType: 'List', entry: elements });
    expect(minimum(issues)).toEqual([]); expect(unresolved(issues)).toBeDefined();
  });
  it('cloned values cannot invent occurrence identity in the original source', async () => {
    const definition = fixture(2); const elements = [unknown];
    const issues = await validatorFor(definition).validateSlicing(structuredClone(elements), path, definition, resolveReference, path, 'R4', { resourceType: 'List', entry: elements });
    expect(minimum(issues)).toEqual([]);
  });
  it('a mismatched resource type cannot attest the group', async () => {
    const definition = fixture(2);
    expect(minimum(await validatorFor(definition).validateSlicing([unknown], path, definition, resolveReference, path, 'R4', { resourceType: 'Patient', entry: [unknown] }))).toEqual([]);
  });
  it('a bare selected child path cannot erase a conditional ancestor', async () => {
    const field = 'List.entry.item.extension'; const definition = fixture(2, { type: 'exists', path: 'item.resolve().specimen' }, field);
    definition.snapshot!.element!.find(e => e.id === path)!.slicing = { discriminator: [{ type: 'type', path: 'item.resolve()' }], rules: 'open' };
    definition.snapshot!.element!.push({ id: `${path}:outer`, path, sliceName: 'outer', min: 0, max: '*' });
    expect(minimum(await run(definition, [unknown], field))).toEqual([]);
  });
  it('missing ancestor metadata cannot attest unconditional applicability', async () => {
    const field = 'List.entry.item.extension'; const definition = fixture(2, { type: 'exists', path: 'item.resolve().specimen' }, field);
    definition.snapshot!.element = definition.snapshot!.element!.filter(e => e.id !== 'List.entry.item');
    expect(minimum(await run(definition, [unknown], field))).toEqual([]);
  });
  it('an unindexed projection of multiple parents is not one local group', async () => {
    const field = 'List.entry.item.extension'; const definition = fixture(2, { type: 'exists', path: 'item.resolve().specimen' }, field);
    const resource = { resourceType: 'List', entry: [{ item: { extension: [unknown] } }, { item: { extension: [unknown] } }] };
    expect(minimum(await validatorFor(definition).validateSlicing([unknown], field, definition, resolveReference, field, 'R4', resource, field))).toEqual([]);
  });
  it('a different parent cannot attest the supplied occurrence identity', async () => {
    const field = 'List.entry.item.extension'; const definition = fixture(2, { type: 'exists', path: 'item.resolve().specimen' }, field);
    const first = [unknown]; const second = [structuredClone(unknown)]; const resource = { resourceType: 'List', entry: [{ item: { extension: first } }, { item: { extension: second } }] };
    expect(minimum(await validatorFor(definition).validateSlicing(first, field, definition, resolveReference, field, 'R4', resource, 'List.entry[1].item.extension'))).toEqual([]);
  });
  it.each([['valid', 2, [known, known], [known, known], 0], ['invalid', 2, [known, known], [known], 1], ['unknown', 1, [unknown], [unknown], 0], ['mixed', 2, [known, known], [unknown], 1]] as const)('actual repeated parent caller retains %s local groups', async (_, required, first, second, expectedMin) => {
    const field = 'List.entry.item.extension'; const definition = fixture(required, { type: 'type', path: 'item.resolve()' }, field);
    const resource = { resourceType: 'List', entry: [{ item: { extension: [...first] } }, { item: { extension: [...second] } }] };
    const issues = await new ProfileSlicingValidation(validatorFor(definition)).validate({ extensionIssues: [], resource, structureDef: definition, getValueAtPath, referenceResolver: resolveReference, fhirVersion: 'R4', elementPaths: new Set([field]) });
    expect(minimum(issues)).toHaveLength(expectedMin);
    if (expectedMin) expect(minimum(issues)[0].path).toBe('List.entry[1].item.extension');
    if (second.includes(unknown)) expect(unresolved(issues)).toBeDefined();
  });
  it('a filtered caller getter cannot omit source occurrences and assert a new minimum', async () => {
    const field = 'List.entry.item.extension'; const definition = fixture(2, { type: 'type', path: 'item.resolve()' }, field);
    const resource = { resourceType: 'List', entry: [{ item: { extension: [unknown, unknown] } }] };
    const getter = (root: unknown, requested: string) => { const value = getValueAtPath(root, requested); return requested === field && Array.isArray(value) ? value.slice(0, 1) : value; };
    const issues = await new ProfileSlicingValidation(validatorFor(definition)).validate({ extensionIssues: [], resource, structureDef: definition, getValueAtPath: getter, referenceResolver: resolveReference, fhirVersion: 'R4', elementPaths: new Set([field]) });
    expect(minimum(issues)).toEqual([]); expect(unresolved(issues)).toBeDefined();
  });
  it('an absent optional unsliced parent does not create a child minimum', async () => {
    const field = 'List.entry.item.extension'; const definition = fixture(2, { type: 'type', path: 'item.resolve()' }, field);
    const issues = await new ProfileSlicingValidation(validatorFor(definition)).validate({ extensionIssues: [], resource: { resourceType: 'List', entry: [] }, structureDef: definition, getValueAtPath, referenceResolver: resolveReference, fhirVersion: 'R4', elementPaths: new Set([field]) });
    expect(minimum(issues)).toEqual([]);
  });

  it('a duplicate selected definition identity cannot attest its applicability', async () => {
    const definition = fixture(2); const base = definition.snapshot!.element!.find(e => e.id === path)!;
    definition.snapshot!.element!.push({ ...base, slicing: undefined });
    expect(minimum(await run(definition, [unknown]))).toEqual([]);
  });
  it('duplicate slice identities cannot attest an extracted minimum', async () => {
    const definition = fixture(2); const slice = definition.snapshot!.element!.find(e => e.sliceName === 'A')!;
    definition.snapshot!.element!.push({ ...slice, min: 0 });
    expect(minimum(await run(definition, [unknown]))).toEqual([]);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, -1, '2', 2147483648, null, undefined])('malformed external minimum %s cannot create a new finite bound', async untrustedMinimum => {
    const definition = fixture(0); const slice = definition.snapshot!.element!.find(e => e.sliceName === 'A')!;
    (slice as unknown as Record<string, unknown>).min = untrustedMinimum;
    const issues = await run(definition, [unknown]);
    expect(minimum(issues)).toEqual([]); expect(unresolved(issues)).toBeDefined();
  });
  it('injected extracted metadata cannot change the actual snapshot minimum', async () => {
    const definition = fixture(0); const elements = [unknown];
    const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null }, extractSlicingInfo: async (...args) => {
      const actual = await extractSlicingInfo(...args);
      return actual ? { ...actual, selectedSlicingElementId: path, slices: actual.slices.map(slice => slice.sliceName === 'A' ? { ...slice, min: 2 } : slice) } : null;
    } });
    const issues = await validator.validateSlicing(elements, path, definition, () => null, path, 'R4', { resourceType: 'List', entry: elements });
    expect(minimum(issues)).toEqual([]); expect(unresolved(issues)).toBeDefined();
  });

  it('a definition type disagreeing with its selected snapshot root stays opaque', async () => {
    const definition = fixture(2); definition.type = 'Patient';
    const issues = await run(definition, [unknown]);
    expect(minimum(issues)).toEqual([]); expect(unresolved(issues)).toBeDefined();
  });
});
