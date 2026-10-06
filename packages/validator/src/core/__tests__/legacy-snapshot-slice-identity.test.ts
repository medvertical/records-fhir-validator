import { describe, expect, it } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { normalizeLegacySnapshotSliceChildren } from '../legacy-snapshot-slice-identity.js';
import { sanitizeProfile } from '../sd-loader-profile-sanitizer.js';
import { shouldSkipSnapshotElement } from '../executors/structural-element-rules.js';
import { CardinalityValidator } from '../../validators/cardinality-validator.js';
import { extractSlicingInfo } from '../../validators/slice-info-extractor.js';
import { SlicingValidator } from '../../validators/slicing-validator.js';

const field = 'Procedure.extension';
const complex = `${field}:complex`;
const simple = `${field}:simple`;
function snapshot(): ElementDefinition[] {
  return [
    { id: 'Procedure', path: 'Procedure' },
    { id: field, path: field, max: '*', type: [{ code: 'Extension' }],
      slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' } },
    { id: complex, path: field, sliceName: 'complex', max: '1', type: [{ code: 'Extension' }] },
    { id: 'Element.id', path: `${field}.id`, min: 0, max: '1' },
    { id: 'Extension.url', path: `${field}.url`, fixedUri: 'https://example.test/complex' },
    { id: `${complex}.extension`, path: `${field}.extension`, max: '*', type: [{ code: 'Extension' }] },
    { id: `${complex}.extension:part`, path: `${field}.extension`, sliceName: 'part', type: [{ code: 'Extension' }] },
    { id: 'Extension.extension:part.url', path: `${field}.extension.url`, fixedUri: 'part' },
    { id: `${complex}.extension:part.value[x]`, path: `${field}.extension.value[x]`, max: '1' },
    { id: 'Extension.value[x]', path: `${field}.value[x]`, min: 0, max: '0' },
    { id: simple, path: field, sliceName: 'simple', max: '1', type: [{ code: 'Extension' }] },
    { id: 'Extension.url', path: `${field}.url`, fixedUri: 'https://example.test/simple' },
    { id: `${simple}.value[x]`, path: `${field}.value[x]`, max: '1', type: [{ code: 'string' }] },
  ];
}
function profile(elements = snapshot()): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: 'https://example.test/StructureDefinition/legacy',
    name: 'Legacy', status: 'active', kind: 'resource', abstract: false, type: 'Procedure', snapshot: { element: elements } };
}
async function slicedIssues(definition: StructureDefinition, values: unknown[]) {
  return new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } })
    .validateSlicing(values, field, definition, null, field, 'R4', { resourceType: 'Procedure', extension: values }, field);
}

describe('legacy snapshot datatype identities inside owned slices', () => {
  it('returns to the outer owner after a nested slice without changing authored metadata', () => {
    const source = profile();
    const before = JSON.stringify(source);
    const normalized = sanitizeProfile(source);
    expect(normalized.snapshot!.element[3].id).toBe(`${complex}.id`);
    expect(normalized.snapshot!.element[7].id).toBe(`${complex}.extension:part.url`);
    expect(normalized.snapshot!.element[9]).toEqual({ ...source.snapshot!.element[9], id: `${complex}.value[x]` });
    expect(shouldSkipSnapshotElement(normalized.snapshot!.element[9], 'Procedure')).toBe(true);
    expect(normalized.snapshot!.element[12]).toBe(source.snapshot!.element[12]);
    expect(JSON.stringify(source)).toBe(before);
    expect(sanitizeProfile(normalized)).toBe(normalized);
  });

  it('keeps the zero constraint in the complex slice and permits another slice value', async () => {
    const normalized = sanitizeProfile(profile());
    const info = await extractSlicingInfo(field, normalized, null, null, field);
    expect(info!.slices.find(slice => slice.sliceName === 'complex')!.childMax!.get('value[x]')).toBe(0);
    expect(info!.slices.find(slice => slice.sliceName === 'simple')!.childMax!.get('value[x]')).toBe(1);
    const issues = await slicedIssues(normalized, [
      { url: 'https://example.test/complex', extension: [{ url: 'part', valueString: 'nested' }] },
      { url: 'https://example.test/simple', valueString: 'allowed' },
    ]);
    expect(issues.filter(issue => issue.severity === 'error' || issue.severity === 'fatal')).toEqual([]);
    const invalid = await slicedIssues(normalized, [{ url: 'https://example.test/complex', valueString: 'forbidden' }]);
    expect(invalid.some(issue => issue.severity === 'error' && issue.code === 'structural-cardinality-max')).toBe(true);
  });

  it('also preserves an independently prohibited child in the other slice', async () => {
    const elements = snapshot();
    elements[12].max = '0';
    const normalized = sanitizeProfile(profile(elements));
    expect(normalized.snapshot!.element[12]).toBe(elements[12]);
    const issues = await slicedIssues(normalized, [
      { url: 'https://example.test/complex', extension: [{ url: 'part', valueString: 'nested' }] },
      { url: 'https://example.test/simple', valueString: 'forbidden' },
    ]);
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'structural-cardinality-max', severity: 'error', path: `${field}[1].value[x]`,
    }));
  });

  it('preserves an explicit unsliced zero constraint and its structural rejection', () => {
    const elements = snapshot();
    elements.splice(2, 0, { id: `${field}.value[x]`, path: `${field}.value[x]`, max: '0' });
    const normalized = normalizeLegacySnapshotSliceChildren(elements, 'Procedure');
    const unsliced = normalized[2];
    expect(unsliced).toBe(elements[2]);
    expect(shouldSkipSnapshotElement(unsliced, 'Procedure')).toBe(false);
    expect(new CardinalityValidator().validate('forbidden', unsliced, `${field}[0].valueString`))
      .toContainEqual(expect.objectContaining({ code: 'structural-cardinality-max', severity: 'error' }));
  });

  it.each(['duplicate-owner', 'missing-owner', 'conflicting-owner', 'unrelated-type', 'identity-collision'] as const)('leaves an ambiguous or unsupported %s unchanged', mode => {
      const elements = snapshot();
      if (mode === 'duplicate-owner') elements.push({ ...elements[2] });
      if (mode === 'missing-owner') delete elements[2].id;
      if (mode === 'conflicting-owner') elements[2].id = 'Procedure.other:complex';
      if (mode === 'unrelated-type') elements[9].id = 'HumanName.value[x]';
      if (mode === 'identity-collision') elements.push({ id: `${complex}.value[x]`, path: `${field}.value[x]`, max: '1' });
      const normalized = normalizeLegacySnapshotSliceChildren(elements, 'Procedure');
      expect(normalized[9]).toBe(elements[9]);
      expect(shouldSkipSnapshotElement(normalized[9], 'Procedure')).toBe(false);
    });

  it('does not assign a foreign datatype identity after leaving the slice branch', () => {
    const elements = snapshot();
    elements.push({ id: 'Procedure.status', path: 'Procedure.status' },
      { id: 'Extension.value[x]', path: `${field}.value[x]`, max: '0' });
    const normalized = normalizeLegacySnapshotSliceChildren(elements, 'Procedure');
    expect(normalized.at(-1)).toBe(elements.at(-1));
  });
});
