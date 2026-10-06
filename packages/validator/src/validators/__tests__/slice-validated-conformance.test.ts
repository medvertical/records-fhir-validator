import { describe, expect, it } from 'vitest';
import { prepareValidatedProfileConformance } from '../slice-validated-conformance';
import { matchDiscriminator } from '../slice-discriminator-matcher';
import { codingMatchesBindingCodes, matchesPattern } from '../slice-utils';
import type { SliceDefinition } from '../slice-types';
import type { SlicingDefinition } from '../../core/structure-definition-types';

// IPS 2.0.0 slices Bundle.entry by the profile each resource conforms to;
// its pregnancy observations overlap, so one Observation can match two.
const IPS = 'http://hl7.org/fhir/uv/ips/StructureDefinition/';
const typeByProfile: Record<string, string> = {
  [`${IPS}Observation-pregnancy-edd-uv-ips`]: 'Observation',
  [`${IPS}Observation-pregnancy-outcome-uv-ips`]: 'Observation',
  [`${IPS}Patient-uv-ips`]: 'Patient',
};
const resolveProfile = async (url: string) => (typeByProfile[url] ? { type: typeByProfile[url] } : null);

const slicing: SlicingDefinition = { discriminator: [{ type: 'profile', path: 'resource' }], rules: 'open' };
const entrySlice = (sliceName: string, ...profiles: string[]): SliceDefinition => ({
  sliceName,
  path: 'Bundle.entry',
  min: 0,
  max: '*',
  childTypes: new Map([['resource', [{ code: 'Resource', profile: profiles }]]]),
});
const edd = entrySlice('observation-pregnancy-edd', `${IPS}Observation-pregnancy-edd-uv-ips`);
const outcome = entrySlice('observation-pregnancy-outcome', `${IPS}Observation-pregnancy-outcome-uv-ips`);
const patient = entrySlice('patient', `${IPS}Patient-uv-ips`);
const slices = [edd, outcome, patient];
const matches = (entry: unknown, slice: SliceDefinition) =>
  matchDiscriminator(entry, slice, slicing.discriminator![0], null, matchesPattern, codingMatchesBindingCodes, slices);

describe('slices placed by validation against their profiles', () => {
  it('match every slice whose profile the resource conforms to, whatever it declares', async () => {
    const observation = { resourceType: 'Observation', meta: { profile: [`${IPS}Observation-pregnancy-edd-uv-ips`] } };
    const entry = { resource: observation };

    const prepared = await prepareValidatedProfileConformance([entry], slices, slicing, resolveProfile, async () => true);

    expect(matches(entry, prepared[0])).toBe(true);
    expect(matches(entry, prepared[1])).toBe(true);
    expect(matches(entry, prepared[2])).toBe(false);
  });

  it('match no slice whose profile the resource fails, even the one it declares', async () => {
    const observation = { resourceType: 'Observation', meta: { profile: [`${IPS}Observation-pregnancy-edd-uv-ips`] } };
    const entry = { resource: observation };

    const prepared = await prepareValidatedProfileConformance([entry], slices, slicing, resolveProfile, async () => false);

    expect(matches(entry, prepared[0])).toBe(false);
    expect(prepared[0].validatedProfileConformance?.(observation, [`${IPS}Observation-pregnancy-edd-uv-ips`])).toBe(false);
  });

  it('keeps parallel evaluations of the same resource and slice independent', async () => {
    const resource = { resourceType: 'Observation' };
    const entry = { resource };
    const [accepting, rejecting, unavailable] = await Promise.all([
      prepareValidatedProfileConformance([entry], slices, slicing, resolveProfile, async () => true),
      prepareValidatedProfileConformance([entry], slices, slicing, resolveProfile, async () => false),
      prepareValidatedProfileConformance([entry], slices, slicing, resolveProfile, undefined),
    ]);
    expect(matches(entry, accepting[0])).toBe(true);
    expect(matches(entry, rejecting[0])).toBe(false);
    expect(unavailable[0].validatedProfileConformance?.(resource, [`${IPS}Observation-pregnancy-edd-uv-ips`])).toBeUndefined();
    expect(edd.validatedProfileConformance).toBeUndefined();
  });

  it('leave a slice to the declaration where validation cannot decide', async () => {
    const observation = { resourceType: 'Observation', meta: { profile: [`${IPS}Observation-pregnancy-edd-uv-ips`] } };
    const entry = { resource: observation };

    const prepared = await prepareValidatedProfileConformance([entry], slices, slicing, resolveProfile, async () => undefined);

    expect(prepared[0].validatedProfileConformance?.(observation, [`${IPS}Observation-pregnancy-edd-uv-ips`])).toBeUndefined();
    expect(matches(entry, prepared[0])).toBe(true);
  });
});

describe('slices placed by validating the resource a reference resolves to', () => {
  // CH Lab-Order: Composition.section.entry is sliced by the profile of what
  // each entry resolves to.
  const CH = 'http://fhir.ch/ig/ch-lab-order/StructureDefinition/';
  const resolveProfile = async (url: string) => (url === `${CH}ch-lab-order-servicerequest` ? { type: 'ServiceRequest' } : null);
  const resolveSlicing: SlicingDefinition = { discriminator: [{ type: 'profile', path: 'resolve()' }], rules: 'open' };
  const serviceRequestSlice: SliceDefinition = {
    sliceName: 'ServiceRequest', path: 'Composition.section.entry', min: 1, max: '*',
    type: [{ code: 'Reference', targetProfile: [`${CH}ch-lab-order-servicerequest`] }],
  };
  const serviceRequest = { resourceType: 'ServiceRequest', id: 'sr-0', meta: { profile: [`${CH}ch-lab-order-servicerequest`] } };
  const resolver = (reference: string) => (reference === 'ServiceRequest/sr-0' ? serviceRequest : null);
  const matchesSlice = (entry: unknown, slice: SliceDefinition) => matchDiscriminator(entry, slice, resolveSlicing.discriminator![0],
    resolver, matchesPattern, codingMatchesBindingCodes, [serviceRequestSlice]);

  it('leaves out an entry whose target fails the profile it declares', async () => {
    const entry = { reference: 'ServiceRequest/sr-0' };
    const prepared = await prepareValidatedProfileConformance([entry], [serviceRequestSlice], resolveSlicing, resolveProfile, async () => false, resolver);

    expect(matchesSlice(entry, prepared[0])).toBe(false);
  });
});

