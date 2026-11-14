import { describe, expect, it, vi } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types.js';
import type { StructureDefinitionLoader } from '../../core/structure-definition-loader.js';
import { createProfileBindingSelector } from '../profile-binding-selection.js';

const absent = 'http://hl7.org/fhir/StructureDefinition/data-absent-reason';
const binding = { strength: 'required' as const, valueSet: 'http://hl7.org/fhir/ValueSet/data-absent-reason' };
const typeSlicing = { discriminator: [{ type: 'type' as const, path: '$this' }], rules: 'closed' as const };
function profile(): StructureDefinition {
  const elements: ElementDefinition[] = [{ id: 'Medication', path: 'Medication' },
    { id: 'Medication.ingredient', path: 'Medication.ingredient', type: [{ code: 'BackboneElement' }] },
    { id: 'Medication.ingredient.item[x]', path: 'Medication.ingredient.item[x]', type: [{ code: 'CodeableConcept' }, { code: 'Reference' }], slicing: typeSlicing }];
  for (const type of ['CodeableConcept', 'Reference']) {
    const item = `Medication.ingredient.item[x]:item${type}`;
    elements.push({ id: item, path: 'Medication.ingredient.item[x]', sliceName: `item${type}`, type: [{ code: type }] },
      { id: `${item}.extension`, path: 'Medication.ingredient.item[x].extension', type: [{ code: 'Extension' }],
        slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'closed' } },
      { id: `${item}.extension:absent`, path: 'Medication.ingredient.item[x].extension', sliceName: 'absent', type: [{ code: 'Extension' }] },
      { id: `${item}.extension:absent.url`, path: 'Medication.ingredient.item[x].extension.url', fixedUri: absent },
      { id: `${item}.extension:absent.value[x]`, path: 'Medication.ingredient.item[x].extension.value[x]',
        type: [{ code: 'code' }, { code: 'string' }], slicing: typeSlicing, binding },
      ...['code', 'string'].map(valueType => ({ id: `${item}.extension:absent.value[x]:value${valueType}`,
        path: 'Medication.ingredient.item[x].extension.value[x]', sliceName: `value${valueType}`, type: [{ code: valueType }],
        binding: valueType === 'code' ? binding : { ...binding, valueSet: 'https://example.test/ValueSet/string' } })));
  }
  return { resourceType: 'StructureDefinition', url: 'https://example.test/StructureDefinition/choice-binding', name: 'ChoiceBinding',
    type: 'Medication', kind: 'resource', status: 'draft', abstract: false, fhirVersion: '4.0.1', snapshot: { element: elements } };
}
function select(selected = profile()) {
  const root = { resourceType: 'Medication', ingredient: [
    { itemCodeableConcept: { extension: [{ url: absent, valueCode: 'unknown' }] } },
    { itemReference: { extension: [{ url: absent, valueString: 'unknown' }] } },
  ] };
  const before = structuredClone(root);
  const loader = { loadReferencedProfile: vi.fn(async () => null) } as unknown as StructureDefinitionLoader;
  return { root, before, selected, selector: createProfileBindingSelector({ profile: selected,
    rootResource: root, basePath: 'Medication', value: root, fhirVersion: 'R4', loader }) };
}

describe('binding membership from actual concrete choice properties', () => {
  it('distinguishes extension-only complex values and equal-looking primitive values cold/warm', async () => {
    const { root, before, selector } = select();
    for (const index of [1, 0, 1, 0]) {
      const type = index === 0 ? 'CodeableConcept' : 'Reference';
      const value = index === 0 ? 'Code' : 'String';
      const result = await selector(undefined, `Medication.ingredient[${index}].item${type}.extension[0].value${value}`);
      expect(result.issues).toEqual([]);
      expect(result.binding?.valueSet).toBe(index === 0 ? binding.valueSet : 'https://example.test/ValueSet/string');
    }
    expect(root).toEqual(before);
  });
  it('retains genuinely competing same-type slices as ambiguous', async () => {
    const selected = profile(); const source = selected.snapshot!.element.find(e => e.id === 'Medication.ingredient.item[x]:itemCodeableConcept')!;
    selected.snapshot!.element.push({ ...source, id: 'Medication.ingredient.item[x]:other', sliceName: 'other' });
    const { selector } = select(selected);
    const result = await selector(undefined, 'Medication.ingredient[0].itemCodeableConcept.extension[0].valueCode');
    expect(result.binding).toBeUndefined();
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-unverified' }));
  });
  it('does not infer a concrete choice from an occurrence that is absent', async () => {
    const { selector } = select();
    const result = await selector(undefined, 'Medication.ingredient[0].itemReference.extension[0].valueString');
    expect(result.binding).toBeUndefined();
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-unverified' }));
  });
});
