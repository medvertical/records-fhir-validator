import { describe, expect, it } from 'vitest';
import { mergeAncestorTypeProfileSliceMetadata } from '../slice-info-inheritance';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types';

const url = 'http://example.org/StructureDefinition/attributes';
const elements: ElementDefinition[] = [
  { id: 'Extension', path: 'Extension' },
  { id: 'Extension.extension:market', path: 'Extension.extension', sliceName: 'market' },
  { id: 'Extension.extension:market.extension:key', path: 'Extension.extension.extension', sliceName: 'key' },
  { id: 'Extension.extension:market.extension:key.value[x].coding', path: 'Extension.extension.extension.value[x].coding', min: 1 },
  { id: 'Extension.extension:autidem', path: 'Extension.extension', sliceName: 'autidem' },
  { id: 'Extension.extension:autidem.extension:key', path: 'Extension.extension.extension', sliceName: 'key',
    type: [{ code: 'Extension' }] },
];
const definition: StructureDefinition = { resourceType: 'StructureDefinition', url, name: 'Attributes',
  status: 'active', kind: 'complex-type', abstract: false, type: 'Extension', snapshot: { element: elements } };

async function inherited(branch: string) {
  const root: ElementDefinition = { id: 'Invoice.lineItem.extension:attributes', path: 'Invoice.lineItem.extension',
    type: [{ code: 'Extension', profile: [url] }] };
  const element: ElementDefinition = { id: `${root.id}.extension:${branch}.extension:key`,
    path: 'Invoice.lineItem.extension.extension.extension', sliceName: 'key' };
  const input = { element, elements: [root, element], elementPath: element.path,
    sliceDef: { path: element.path, sliceName: 'key', min: 1, max: '1' },
    childPatterns: new Map<string, unknown>(), childFixed: new Map<string, unknown>(),
    childMin: new Map<string, number>(), childTypes: new Map<string, Array<{ code: string }>>(),
    resolver: async () => definition };
  await mergeAncestorTypeProfileSliceMetadata(input);return input;
}
describe('ancestor slice identity', () => {
  it('does not inherit a sibling branch coding minimum just because its leaf slice has the same name', async () => {
    expect((await inherited('autidem')).childMin.has('value[x].coding')).toBe(false);
  });
  it('retains the coding requirement for the actual CodeableConcept branch', async () => {
    expect((await inherited('market')).childMin.get('value[x].coding')).toBe(1);
  });
});
