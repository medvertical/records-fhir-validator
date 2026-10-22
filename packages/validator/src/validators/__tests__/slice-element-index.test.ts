import { describe, expect, it, vi } from 'vitest';
import { createSliceElementIndex } from '../slice-element-index.js';
import { extractSlicingInfo } from '../slice-info-extractor.js';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types.js';

const path = 'Patient.identifier';
const profile = (elements: ElementDefinition[]): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: 'https://example.test/Patient', type: 'Patient',
  name: 'PatientPreparation', status: 'active', kind: 'resource', abstract: false,
  snapshot: { element: elements },
});

describe('slice element lookup preserves definition identity and order', () => {
  it.each([0, 12])('keeps duplicate-child precedence and sibling/reslice identity with %s extra slices', async extraSlices => {
    const elements: ElementDefinition[] = [
      { id: path, path, slicing: { rules: 'open', discriminator: [{ type: 'value', path: 'system' }] } },
      { id: `${path}:a`, path, sliceName: 'a' },
      { id: `${path}:ab`, path, sliceName: 'ab' },
      { id: `${path}:a/sub`, path, sliceName: 'a/sub' },
      { id: `${path}:a.system`, path: `${path}.system`, fixedUri: 'FIRST' },
      { id: `${path}:ab.system`, path: `${path}.system`, fixedUri: 'SIBLING' },
      { id: `${path}:a/sub.system`, path: `${path}.system`, fixedUri: 'RESLICE' },
      { id: `${path}:a.system`, path: `${path}.system`, fixedUri: 'LAST' },
    ];
    elements.push(...Array.from({ length: extraSlices }, (_, index) => ({
      id: `${path}:extra-${index}`, path, sliceName: `extra-${index}`,
    })));
    if (extraSlices) elements.push(...Array.from({ length: 200 }, (_, index) => ({
      id: `Patient.unrelated${index}`, path: `Patient.unrelated${index}`,
    })));
    const definition = profile(elements);
    const before = structuredClone(definition);
    const extract = () => extractSlicingInfo(path, definition, null, null, path);
    const result = await extract();
    expect(result?.slices.slice(0, 3).map(slice => [slice.sliceName, slice.childFixed?.get('system')]))
      .toEqual([['a', 'LAST'], ['ab', 'SIBLING'], ['a/sub', 'RESLICE']]);
    expect(result?.slices[0].localProfileDiscriminatorElements?.filter(element => element.path === `${path}.system`))
      .toHaveLength(2);
    expect(definition).toEqual(before);
    elements[7].fixedUri = 'UPDATED';
    expect((await extract())?.slices[0].childFixed?.get('system')).toBe('UPDATED');
  });

  it('retains deepest-first ancestor resolution and duplicate ancestor order', async () => {
    const target = 'Patient.contact.identifier';
    const ancestorId = 'Patient.contact:official';
    const elements: ElementDefinition[] = [
      { id: 'Patient', path: 'Patient', type: [{ code: 'Patient', profile: ['root'] }] },
      { id: ancestorId, path: 'Patient.contact', type: [{ code: 'BackboneElement', profile: ['deep-first'] }] },
      { id: `${ancestorId}.identifier`, path: target, slicing: { rules: 'open', discriminator: [{ type: 'value', path: 'system' }] } },
      { id: ancestorId, path: 'Patient.contact', type: [{ code: 'BackboneElement', profile: ['deep-second'] }] },
      { id: `${ancestorId}.identifier:mrn`, path: target, sliceName: 'mrn' },
      ...Array.from({ length: 11 }, (_, index) => ({
        id: `${ancestorId}.identifier:extra-${index}`, path: target, sliceName: `extra-${index}`,
      })),
      ...Array.from({ length: 200 }, (_, index) => ({ id: `Patient.unrelated${index}`, path: `Patient.unrelated${index}` })),
    ];
    const resolve = vi.fn(async (url: string): Promise<StructureDefinition> => ({
      resourceType: 'StructureDefinition', url, type: 'BackboneElement',
      name: 'AncestorPreparation', status: 'active', kind: 'complex-type', abstract: false, snapshot: { element: [
        { id: 'BackboneElement.identifier:mrn', path: 'BackboneElement.identifier', sliceName: 'mrn' },
        { id: 'BackboneElement.identifier:mrn.system', path: 'BackboneElement.identifier.system', fixedUri: url },
      ] },
    }));
    const result = await extractSlicingInfo(target, profile(elements), resolve, null);
    expect(resolve.mock.calls.map(([url]) => url)).toEqual(Array.from({ length: 12 }, () => ['deep-first', 'deep-second', 'root']).flat());
    expect(result?.slices[0].childFixed?.get('system')).toBe('deep-first');
  });

  it('falls back without dropping descendants when malformed ID nesting exceeds the index bound', () => {
    const elements = Array.from({ length: 370 }, (_, depth) => ({
      id: `Patient.identifier${'.nested'.repeat(depth)}`, path, sliceName: `slice-${depth}`,
    }));
    const index = createSliceElementIndex(elements, elements)!;
    expect(index.descendants(`${path}.`)).toEqual(elements.slice(1));
    expect(index.descendants(`${path}.nested.`)).toEqual(elements.slice(2));
  });

  it('does not silently discard malformed IDs at the constraint-projection boundary', async () => {
    const definition = profile([
      { id: path, path, slicing: { rules: 'open', discriminator: [{ type: 'value', path: 'system' }] } },
      { id: `${path}:mrn`, path, sliceName: 'mrn' },
      ...Array.from({ length: 11 }, (_, index) => ({ id: `${path}:extra-${index}`, path, sliceName: `extra-${index}` })),
      ...Array.from({ length: 200 }, (_, index) => ({ id: `Patient.unrelated${index}`, path: `Patient.unrelated${index}` })),
      { id: 42 as unknown as string, path: 'Patient.unrelated' },
    ]);
    await expect(extractSlicingInfo(path, definition, null, null)).rejects.toThrow();
  });
});
