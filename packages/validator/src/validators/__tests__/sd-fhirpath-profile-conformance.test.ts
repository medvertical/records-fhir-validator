import { describe, expect, it, vi } from 'vitest';
import type { ElementDefinition } from '../../core/structure-definition-types';
import { createConformsToFunction } from '../fhirpath-conforms-to';
import { precomputeProfileConformance } from '../sd-fhirpath-profile-conformance';

// CH EPR's DocumentReference must conform to IHE MHD's, which the instances
// inside a ProvideBundle do not declare.
const MHD_DOCUMENT_REFERENCE = 'https://profiles.ihe.net/ITI/MHD/StructureDefinition/IHE.MHD.Comprehensive.DocumentReference';
const chMhd = [{
  id: 'DocumentReference',
  path: 'DocumentReference',
  constraint: [{ key: 'ch-mhd', severity: 'error', human: 'conform to MHD', expression: `conformsTo('${MHD_DOCUMENT_REFERENCE}')` }],
}] as ElementDefinition[];

describe('conformance established before invariants are evaluated', () => {
  it('checks the resource and the resources it holds against the profiles conformsTo() names', async () => {
    const documentReference = { resourceType: 'DocumentReference', status: 'current' };
    const bundle = { resourceType: 'Bundle', entry: [{ resource: documentReference }, { resource: { resourceType: 'Binary' } }] };
    const check = vi.fn(async (resource: Record<string, unknown>) =>
      (resource.resourceType === 'DocumentReference' ? true : undefined));

    const established = await precomputeProfileConformance(chMhd, bundle, check);

    expect(check).toHaveBeenCalledTimes(3);
    expect(established?.(documentReference, MHD_DOCUMENT_REFERENCE)).toBe(true);
    expect(established?.(bundle, MHD_DOCUMENT_REFERENCE)).toBeUndefined();
  });

  it('checks nothing for invariants that do not call conformsTo()', async () => {
    const check = vi.fn();
    const elements = [{ id: 'Patient', path: 'Patient', constraint: [{ key: 'x', severity: 'error', human: 'x', expression: 'name.exists()' }] }];

    await expect(precomputeProfileConformance(elements as ElementDefinition[], { resourceType: 'Patient' }, check)).resolves.toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it('lets conformsTo() read an established verdict before the declared profiles', () => {
    const documentReference = { resourceType: 'DocumentReference', meta: { profile: ['http://fhir.ch/ig/ch-epr-fhir/StructureDefinition/ch-mhd-documentreference-comprehensive'] } };
    const conformsTo = (established?: (resource: object) => boolean | undefined) =>
      createConformsToFunction(established).fn([documentReference], MHD_DOCUMENT_REFERENCE);

    expect(conformsTo(() => true)).toEqual([true]);
    expect(conformsTo(() => undefined)).toEqual([false]);
    expect(conformsTo()).toEqual([false]);
  });
});
