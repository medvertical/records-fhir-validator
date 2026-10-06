import { describe, expect, it } from 'vitest';
import { prepareValidatedProfileConformance } from '../slice-validated-conformance.js';
import type { SliceDefinition } from '../slice-types.js';
import type { SlicingDefinition } from '../../core/structure-definition-types.js';
import type { FhirVersionFamily } from '../../core/sd-loader-version-utils.js';

const canonical = 'https://example.org/StructureDefinition/publication-target';
const requested = `${canonical}|2`;
const target = { resourceType: 'Observation', id: 'known' };
const elements = [{ item: { reference: 'urn:uuid:known' } }];
const slicing: SlicingDefinition = { discriminator: [{ type: 'profile', path: 'item.resolve()' }], rules: 'closed' };

function slice(profile = requested): SliceDefinition {
  return { sliceName: 'A', path: 'List.entry', min: 0, max: '*',
    childTypes: new Map([['item', [{ code: 'Reference', targetProfile: [profile] }]]]) };
}

async function prepare(publication: unknown, family: FhirVersionFamily | undefined = 'R4') {
  const [prepared] = await prepareValidatedProfileConformance(elements, [slice()], slicing,
    async () => ({ url: canonical, version: '2', type: 'Patient', fhirVersion: publication }),
    async () => false, () => target, true, family);
  return prepared;
}

describe('request-bound publication authority for profile nonmembers', () => {
  it.each([
    { name: 'same R4 publication', publication: '4.0.1', expected: false },
    { name: 'same Records R4 family with R4B', publication: '4.3.0', expected: false },
    { name: 'optional publication absent under explicit request', publication: undefined, expected: false },
    { name: 'contradictory R5 publication', publication: '5.0.0', expected: undefined },
    { name: 'malformed recognizable prefix', publication: '4.broken', expected: undefined },
    { name: 'unknown release', publication: '7.0.0', expected: undefined },
    { name: 'empty publication', publication: '', expected: undefined },
    { name: 'null publication', publication: null, expected: undefined },
    { name: 'numeric publication', publication: 4, expected: undefined },
    { name: 'array publication', publication: ['4.0.1'], expected: undefined },
  ])('$name does not alter the legacy Boolean', async ({ publication, expected }) => {
    const prepared = await prepare(publication);
    expect(prepared.validatedProfileConformance?.(target, [requested])).toBe(false);
    expect(prepared.validatedProfileConformanceEvidence?.(target, [requested])).toBe(expected);
  });

  it('keeps direct preparation without actual request context opaque', async () => {
    const [prepared] = await prepareValidatedProfileConformance(elements, [slice()], slicing,
      async () => ({ url: canonical, version: '2', type: 'Patient', fhirVersion: '4.0.1' }),
      async () => false, () => target, true);
    expect(prepared.validatedProfileConformance?.(target, [requested])).toBe(false);
    expect(prepared.validatedProfileConformanceEvidence).toBeUndefined();
  });

  it('does not let a throwing publication accessor reset the legacy verdict', async () => {
    const [prepared] = await prepareValidatedProfileConformance(elements, [slice()], slicing,
      async () => ({ url: canonical, version: '2', type: 'Patient', get fhirVersion(): string { throw Error('unavailable'); } }),
      async () => false, () => target, true, 'R4');
    expect(prepared.validatedProfileConformance?.(target, [requested])).toBe(false);
    expect(prepared.validatedProfileConformanceEvidence?.(target, [requested])).toBeUndefined();
  });

  it('keeps receipts invocation-local when the same physical target changes request family', async () => {
    const first = await prepare('4.0.1', 'R4');
    const second = await prepare('4.0.1', 'R5');
    expect(first.validatedProfileConformanceEvidence?.(target, [requested])).toBe(false);
    expect(second.validatedProfileConformanceEvidence?.(target, [requested])).toBeUndefined();
    expect(first.validatedProfileConformanceEvidence?.(target, [requested])).toBe(false);
  });

  it('preserves an unversioned chosen edition without reading its optional business version', async () => {
    let reads = 0;
    const [prepared] = await prepareValidatedProfileConformance(elements, [slice(canonical)], slicing,
      async () => ({ url: canonical, type: 'Patient', fhirVersion: '4.0.1', get version(): string { reads++; throw Error('unavailable'); } }),
      async () => false, () => target, true, 'R4');
    expect(prepared.validatedProfileConformanceEvidence?.(target, [canonical])).toBe(false);
    expect(reads).toBe(0);
  });

  it('does not mint positive evidence from a confirmed Boolean under contradictory publication', async () => {
    const [prepared] = await prepareValidatedProfileConformance(elements, [slice()], slicing,
      async () => ({ url: canonical, version: '2', type: 'Observation', fhirVersion: '5.0.0' }),
      async () => true, () => target, true, 'R4');
    expect(prepared.validatedProfileConformance?.(target, [requested])).toBe(true);
    expect(prepared.validatedProfileConformanceEvidence?.(target, [requested])).toBeUndefined();
  });
});
