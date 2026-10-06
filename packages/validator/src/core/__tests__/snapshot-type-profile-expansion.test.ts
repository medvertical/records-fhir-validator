import { describe, expect, it, vi } from 'vitest';
import { SnapshotGenerator } from '../snapshot-generator';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types';

const element = (id: string, extra: Partial<ElementDefinition> = {}) =>
  ({ id, path: id.replace(/:[^.]+/g, ''), ...extra }) as ElementDefinition;

const definition = (url: string, type: string, baseDefinition: string, elements: ElementDefinition[], snapshot = false) =>
  ({ resourceType: 'StructureDefinition', url, type, baseDefinition, ...(snapshot ? { snapshot: { element: elements } } : { differential: { element: elements } }) }) as StructureDefinition;

// KBV's practitioner (differential only) slices identifier by type.coding.code;
// the codes live in de.basisprofil's identifier profiles, also differential only.
const definitions = new Map<string, StructureDefinition>([
  ['http://hl7.org/fhir/StructureDefinition/Identifier', definition('http://hl7.org/fhir/StructureDefinition/Identifier', 'Identifier', '', [
    element('Identifier'), element('Identifier.type', { type: [{ code: 'CodeableConcept' }] }),
    element('Identifier.type.coding', { type: [{ code: 'Coding' }] }), element('Identifier.type.coding.system'),
    element('Identifier.type.coding.code'), element('Identifier.system'), element('Identifier.value'),
  ], true)],
  ['http://hl7.org/fhir/StructureDefinition/Practitioner', definition('http://hl7.org/fhir/StructureDefinition/Practitioner', 'Practitioner', '', [
    element('Practitioner'), element('Practitioner.identifier', { type: [{ code: 'Identifier' }] }), element('Practitioner.active'),
  ], true)],
  ['http://fhir.de/StructureDefinition/identifier-efn|0.9.12', definition('http://fhir.de/StructureDefinition/identifier-efn', 'Identifier', 'http://hl7.org/fhir/StructureDefinition/Identifier', [
    element('Identifier'),
    element('Identifier.type.coding', { slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'open' } }),
    element('Identifier.type.coding:DN-Type', { sliceName: 'DN-Type', min: 1, max: '1' }),
    element('Identifier.type.coding:DN-Type.system', { fixedUri: 'http://terminology.hl7.org/CodeSystem/v2-0203' }),
    element('Identifier.type.coding:DN-Type.code', { fixedCode: 'DN' }),
  ])],
  ['https://fhir.kbv.de/StructureDefinition/KBV_PR_Base_Practitioner', definition('https://fhir.kbv.de/StructureDefinition/KBV_PR_Base_Practitioner', 'Practitioner', 'http://hl7.org/fhir/StructureDefinition/Practitioner', [
    element('Practitioner.identifier', { slicing: { discriminator: [{ type: 'value', path: 'type.coding.code' }], rules: 'open' } }),
    element('Practitioner.identifier:EFN', { sliceName: 'EFN', max: '1', type: [{ code: 'Identifier', profile: ['http://fhir.de/StructureDefinition/identifier-efn|0.9.12'] }] }),
    element('Practitioner.identifier:EFN.type.coding', { min: 1 }),
  ])],
  ['https://fhir.kbv.de/StructureDefinition/KBV_PR_MIO_Vaccination_Practitioner', definition('https://fhir.kbv.de/StructureDefinition/KBV_PR_MIO_Vaccination_Practitioner', 'Practitioner', 'https://fhir.kbv.de/StructureDefinition/KBV_PR_Base_Practitioner', [
    element('Practitioner.identifier:EFN', { sliceName: 'EFN' }),
    element('Practitioner.identifier:EFN.type.coding'),
    element('Practitioner.identifier:EFN.type.coding:DN-Type', { sliceName: 'DN-Type' }),
    element('Practitioner.identifier:EFN.type.coding:DN-Type.userSelected', { max: '0' }),
  ])],
]);

describe('snapshots of profiles whose slices take a profiled type', () => {
  it('hang the type profile\'s elements below the slice once the differential walks into it', async () => {
    const loader = new StructureDefinitionLoader();
    vi.spyOn(loader, 'loadReferencedProfile').mockImplementation(async (url: string) => structuredClone(definitions.get(url) ?? null));
    const generator = new SnapshotGenerator(loader);

    const snapshot = await generator.generateSnapshot(structuredClone(definitions.get('https://fhir.kbv.de/StructureDefinition/KBV_PR_MIO_Vaccination_Practitioner')!));
    const ids = snapshot.map(item => item.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(snapshot.find(item => item.id === 'Practitioner.identifier:EFN.type.coding:DN-Type.code')).toMatchObject({
      path: 'Practitioner.identifier.type.coding.code',
      fixedCode: 'DN',
    });
    expect(snapshot.find(item => item.id === 'Practitioner.identifier:EFN.type.coding')).toMatchObject({ min: 1 });
    expect(snapshot.find(item => item.id === 'Practitioner.identifier:EFN.type.coding:DN-Type.userSelected')).toMatchObject({ max: '0' });
    expect(ids.indexOf('Practitioner.identifier:EFN.value')).toBeGreaterThan(ids.indexOf('Practitioner.identifier:EFN'));
    expect(ids.indexOf('Practitioner.active')).toBeGreaterThan(ids.indexOf('Practitioner.identifier:EFN.value'));
  });

  // A Bundle validates its entries concurrently: one generation must not
  // skip the type profile another is still expanding and cache that result.
  it('expand the type profile in concurrent generations alike', async () => {
    const loader = new StructureDefinitionLoader();
    vi.spyOn(loader, 'loadReferencedProfile').mockImplementation(async (url: string) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return structuredClone(definitions.get(url) ?? null);
    });
    const generator = new SnapshotGenerator(loader);
    const profile = definitions.get('https://fhir.kbv.de/StructureDefinition/KBV_PR_MIO_Vaccination_Practitioner')!;

    const snapshots = await Promise.all([
      generator.generateSnapshot(structuredClone(profile), { cacheResults: false }),
      generator.generateSnapshot(structuredClone(definitions.get('https://fhir.kbv.de/StructureDefinition/KBV_PR_Base_Practitioner')!), { cacheResults: false }),
    ]);

    for (const snapshot of snapshots) {
      expect(snapshot.find(item => item.id === 'Practitioner.identifier:EFN.type.coding:DN-Type.code')).toMatchObject({ fixedCode: 'DN' });
    }
  });
});
