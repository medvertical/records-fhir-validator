import { describe, expect, it } from 'vitest';
import { SlicingValidator } from '../slicing-validator.js';
import { prepareValidatedProfileConformance } from '../slice-validated-conformance.js';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import type { SliceDefinition } from '../slice-types.js';

const TARGET = 'https://example.org/StructureDefinition/edition-target';

function hostProfile(requested: string, publication = '4.0.1'): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: 'https://example.org/StructureDefinition/edition-host',
    name: 'EditionHost', status: 'active', kind: 'resource', abstract: false, type: 'List', fhirVersion: publication,
    snapshot: { element: [
      { id: 'List', path: 'List', min: 0, max: '1' },
      { id: 'List.entry', path: 'List.entry', min: 0, max: '*',
        slicing: { discriminator: [{ type: 'profile', path: 'item.resolve()' }], rules: 'closed' } },
      { id: 'List.entry:A', path: 'List.entry', sliceName: 'A', min: 0, max: '*' },
      { id: 'List.entry:A.item', path: 'List.entry.item', min: 1, max: '1',
        type: [{ code: 'Reference', targetProfile: [requested] }] },
    ] },
  } as unknown as StructureDefinition;
}

function loadedDefinition(version: unknown): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: TARGET, name: 'EditionTarget',
    status: 'active', kind: 'resource', abstract: false, type: 'Patient',
    ...(version === undefined ? {} : { version }),
    snapshot: { element: [{ id: 'Patient', path: 'Patient', min: 0, max: '1' }] },
  } as unknown as StructureDefinition;
}

const editions: { name: string; requested: string; loaded: unknown; closed: number }[] = [
  { name: 'matching business edition', requested: `${TARGET}|2`, loaded: '2', closed: 1 },
  { name: 'conflicting business edition', requested: `${TARGET}|2`, loaded: '1', closed: 0 },
  { name: 'missing business edition', requested: `${TARGET}|2`, loaded: undefined, closed: 0 },
  { name: 'empty business edition', requested: `${TARGET}|2`, loaded: '', closed: 0 },
  { name: 'malformed business edition', requested: `${TARGET}|2`, loaded: 2, closed: 0 },
  { name: 'different business edition in same major', requested: `${TARGET}|2`, loaded: '2.0', closed: 0 },
  { name: 'opaque matching business edition', requested: `${TARGET}|release-blue`, loaded: 'release-blue', closed: 1 },
  { name: 'chosen unversioned edition', requested: TARGET, loaded: '1', closed: 1 },
  { name: 'unversioned definition without edition', requested: TARGET, loaded: undefined, closed: 1 },
];

describe('confirmed profile nonmember edition authority', () => {
  it.each(editions)('retains only edition-attested negatives: $name', async ({ requested, loaded, closed }) => {
    const profile = hostProfile(requested);
    const known = { resourceType: 'Observation', id: 'known' };
    const entries = [{ item: { reference: 'urn:uuid:known' } }, { item: { reference: 'urn:uuid:unknown' } }];
    const source = { resourceType: 'List', entry: entries };
    const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
    validator.setTypeProfileResolver(async canonical => {
      expect(canonical).toBe(requested);
      return loadedDefinition(loaded);
    });
    const issues = await validator.validateSlicing(entries, 'List.entry', profile,
      reference => reference === 'urn:uuid:known' ? known : null, 'List.entry', 'R4', source, 'List.entry', async () => false);
    expect(issues.filter(issue => issue.code === 'profile-slice-closed-unmatched' && issue.severity === 'error')).toHaveLength(closed);
    expect(issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false)).toBe(true);
    expect(issues.some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(false);
  });

  it.each([
    { family: 'R4' as const, publication: '4.0.1', business: '5.0.0' },
    { family: 'R4' as const, publication: '4.3.0', business: '2' },
    { family: 'R5' as const, publication: '5.0.0', business: '4.0.1' },
    { family: 'R6' as const, publication: '6.0.0', business: '2' },
  ])('preserves $family context independently of business edition', async ({ family, publication, business }) => {
    const requested = `${TARGET}|${business}`, profile = hostProfile(requested, publication);
    const known = { resourceType: 'Observation', id: 'known' };
    const entries = [{ item: { reference: 'urn:uuid:known' } }, { item: { reference: 'urn:uuid:unknown' } }];
    const source = { resourceType: 'List', entry: entries };
    const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
    validator.setTypeProfileResolver(async (canonical, actualFamily, actualHost) => {
      expect(canonical).toBe(requested);
      expect(actualFamily).toBe(family);
      expect(actualHost?.url).toBe(profile.url);
      return { ...loadedDefinition(business), fhirVersion: publication };
    });
    const issues = await validator.validateSlicing(entries, 'List.entry', profile,
      reference => reference === 'urn:uuid:known' ? known : null, 'List.entry', family, source, 'List.entry', async () => false);
    expect(issues.filter(issue => issue.code === 'profile-slice-closed-unmatched' && issue.severity === 'error')).toHaveLength(1);
    expect(issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false)).toBe(true);
  });

  it('keeps the legacy Boolean result while the selected edition is unverified', async () => {
    const requested = `${TARGET}|2`, target = { resourceType: 'Observation', id: 'known' };
    const slice: SliceDefinition = { sliceName: 'A', path: 'List.entry', min: 0, max: '*',
      childTypes: new Map([['item', [{ code: 'Reference', targetProfile: [requested] }]]]) };
    const prepared = await prepareValidatedProfileConformance([{ item: { reference: 'urn:uuid:known' } }], [slice],
      { discriminator: [{ type: 'profile', path: 'item.resolve()' }], rules: 'closed' },
      async () => ({ ...loadedDefinition('1'), type: 'Observation' }), async () => true, () => target, true);
    expect(prepared[0].validatedProfileConformance?.(target, [requested])).toBe(true);
    expect(prepared[0].validatedProfileConformanceEvidence?.(target, [requested])).toBeUndefined();
  });
});
