import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import type { ProfileConformanceVerdict } from '../sd-fhirpath-profile-conformance.js';
import { SlicingValidator } from '../slicing-validator.js';
import { prepareValidatedProfileConformance } from '../slice-validated-conformance.js';

const canonical = (key: string) => `https://example.org/StructureDefinition/composite-${key}`;
interface Control {
  order?: 'profile-first';
  path?: '$this';
  targetType?: string;
  sliceType?: string;
  verdict?: ProfileConformanceVerdict;
  claim?: boolean;
  family?: string;
  edition?: string;
  alternative?: 'true' | 'missing';
  requestedEdition?: string;
}

async function run(control: Control) {
  const thisPath = control.path === '$this';
  const groupPath = thisPath ? 'Patient.contained' : 'Bundle.entry';
  const hostType = thisPath ? 'Patient' : 'Bundle';
  const discriminatorPath = thisPath ? '$this' : 'resource';
  const type = { type: 'type' as const, path: discriminatorPath };
  const profile = { type: 'profile' as const, path: discriminatorPath };
  const profiles = [canonical('A') + (control.requestedEdition ? `|${control.requestedEdition}` : ''), ...(control.alternative ? [canonical('B')] : [])];
  const typeSpec = [{ code: control.sliceType ?? 'Composition', profile: profiles }];
  const definition: StructureDefinition = { resourceType: 'StructureDefinition', url: canonical('host'), name: 'CompositeHost', status: 'active', kind: 'resource', abstract: false, type: hostType, snapshot: { element: [
    { id: hostType, path: hostType, min: 0, max: '*' },
    { id: groupPath, path: groupPath, min: 0, max: '*', type: [{ code: thisPath ? 'Resource' : 'BackboneElement' }], slicing: { discriminator: control.order === 'profile-first' ? [profile, type] : [type, profile], rules: 'closed' } },
    { id: `${groupPath}:A`, path: groupPath, sliceName: 'A', min: 1, max: '1', ...(thisPath ? { type: typeSpec } : {}) },
    ...(!thisPath ? [{ id: `${groupPath}:A.resource`, path: `${groupPath}.resource`, min: 1, max: '1', type: typeSpec }] : []),
  ] } };
  const target = { resourceType: control.targetType ?? 'Composition', ...(control.claim ? { meta: { profile: [canonical('A')] } } : {}) };
  const elements = thisPath ? [target] : [{ resource: target }];
  const resource = thisPath ? { resourceType: hostType, contained: elements } : { resourceType: hostType, entry: elements };
  const calls: { sameTarget: boolean; canonical: string }[] = [];
  const resolve = async (url: string): Promise<StructureDefinition | null> => {
    if (url === canonical('B') && control.alternative === 'missing') return null;
    return { resourceType: 'StructureDefinition', url: url.split('|')[0], version: control.edition ?? '2', name: 'CompositeTarget', status: 'active', kind: 'resource', abstract: false, type: target.resourceType, fhirVersion: control.family ?? '4.0.1', snapshot: { element: [{ id: target.resourceType, path: target.resourceType, min: 0, max: '*' }] } };
  };
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
  validator.setTypeProfileResolver(resolve);
  const issues = await validator.validateSlicing(elements, groupPath, definition, null, groupPath, 'R4', resource, groupPath, async (actual, url) => {
    calls.push({ sameTarget: actual === target, canonical: url });
    return url === canonical('B') && control.alternative === 'true' ? true : control.verdict;
  });
  return {
    min: issues.some(issue => issue.code === 'profile-slice-min-cardinality'),
    closed: issues.some(issue => issue.code === 'profile-slice-closed-unmatched'),
    incomplete: issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false),
    samePhysicalTarget: calls.every(call => call.sameTarget),
  };
}

describe('same-path direct TYPE and PROFILE conjunction', () => {
  it.each([
    ['type before unknown profile', {}, { min: false, closed: false, incomplete: true }],
    ['unknown profile before type', { order: 'profile-first' }, { min: false, closed: false, incomplete: true }],
    ['known true and matching type', { verdict: true }, { min: false, closed: false, incomplete: false }],
    ['known false and matching type', { verdict: false }, { min: true, closed: true, incomplete: false }],
    ['type mismatch defeats matching profile definition and true callback', { targetType: 'Patient', verdict: true }, { min: true, closed: true, incomplete: false }],
    ['type mismatch is definitive beside unknown profile', { targetType: 'Patient' }, { min: true, closed: true, incomplete: false }],
    ['unknown defeats meta claim', { claim: true }, { min: false, closed: false, incomplete: true }],
    ['false defeats meta claim', { claim: true, verdict: false }, { min: true, closed: true, incomplete: false }],
    ['resource this positive', { path: '$this', verdict: true }, { min: false, closed: false, incomplete: false }],
    ['resource this unknown', { path: '$this' }, { min: false, closed: false, incomplete: true }],
    ['wrong publication remains unknown', { family: '5.0.0', verdict: true }, { min: false, closed: false, incomplete: true }],
    ['wrong business edition remains unknown', { requestedEdition: '2', edition: '1', verdict: true }, { min: false, closed: false, incomplete: true }],
    ['OR true then type conjunction', { alternative: 'true', verdict: false }, { min: false, closed: false, incomplete: false }],
    ['OR false plus unavailable then type conjunction', { alternative: 'missing', verdict: false }, { min: false, closed: false, incomplete: true }],
  ] as const)('%s', async (_name, control, expected) => {
    expect(await run(control)).toMatchObject({ ...expected, samePhysicalTarget: true });
  });

  it.each([
    { discriminators: [{ type: 'type', path: 'resource' }, { type: 'profile', path: 'resource.subject' }] },
    { discriminators: [{ type: 'type', path: 'resource.subject' }, { type: 'profile', path: 'resource.subject' }] },
    { discriminators: [{ type: 'type', path: 'resource' }, { type: 'profile', path: 'resource' }, { type: 'exists', path: 'flag' }] },
  ] as const)('keeps unsupported discriminator shapes opaque: %j', async ({ discriminators }) => {
    const target = { resourceType: 'Composition' };
    const slices = [{ sliceName: 'A', path: 'Bundle.entry', min: 0, max: '*', type: [{ code: 'Resource', profile: [canonical('A')] }] }];
    const prepared = await prepareValidatedProfileConformance([target], slices, { discriminator: [...discriminators], rules: 'open' }, async () => ({ type: 'Composition', url: canonical('A'), fhirVersion: '4.0.1' }), async () => true, null, true, 'R4');
    expect(prepared[0].validatedProfileConformanceEvidence).toBeUndefined();
  });
});
