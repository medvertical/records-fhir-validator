import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { ProfileSlicingValidation } from '../../core/executors/profile-slicing-validation.js';
import { getValueAtPath } from '../../core/validation-utils.js';
import { datatypeConformingSlices, partialDatatypeMembership, prepareDatatypeProfileConformance } from '../slice-datatype-conformance.js';
import { withSliceInstanceEvidence } from '../slice-instance-evidence.js';
import { SlicingValidator } from '../slicing-validator.js';
import type { SliceDefinition } from '../slice-types.js';

const canonical = 'http://fhir.ch/ig/ch-epr-fhir/StructureDefinition/ch-epr-fhir-humanname';
const path = 'Bundle.entry.resource.name';
const slicing = { discriminator: [{ type: 'profile' as const, path: '$this' }], rules: 'closed' as const };
const slice: SliceDefinition = { sliceName: 'HumanName', path, min: 1, max: '1', type: [{ code: 'HumanName', profile: [canonical] }] };
const profile = (expression: string): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: canonical, name: 'OwnedNameContext', status: 'active', kind: 'complex-type', abstract: false,
  type: 'HumanName', snapshot: { element: [{ id: 'HumanName', path: 'HumanName', constraint: [{
    key: 'owned-nested-1', severity: 'error', human: 'The name belongs to the permitted containing resource context', expression,
  }] }] },
});
function fixture() {
  const permitted = { family: 'Muster', given: ['Franz'] };
  const rejected = { family: 'Muster', given: ['Franz'] };
  const patientP = { resourceType: 'Patient', gender: 'other', name: [permitted] };
  const patientN = { resourceType: 'Patient', gender: 'male', name: [rejected] };
  const bundle = { resourceType: 'Bundle', entry: [{ resource: patientP }, { resource: patientN }] };
  return { permitted, rejected, bundle };
}
const membership = (value: unknown) => partialDatatypeMembership(value)?.get('HumanName')
  ?? datatypeConformingSlices(value)?.has('HumanName');
const host: StructureDefinition = { resourceType: 'StructureDefinition', url: 'https://example.test/StructureDefinition/AlternativeSource',
  name: 'NestedNameHost', status: 'active', kind: 'resource', abstract: false, type: 'Bundle', snapshot: { element: [
    { id: 'Bundle', path: 'Bundle' },
    { id: 'Bundle.entry', path: 'Bundle.entry', min: 0, max: '*', type: [{ code: 'BackboneElement' }] },
    { id: 'Bundle.entry.resource', path: 'Bundle.entry.resource', min: 1, max: '1', type: [{ code: 'Resource' }] },
    { id: path, path, min: 0, max: '*', type: [{ code: 'HumanName' }], slicing },
    { id: `${path}:HumanName`, path, sliceName: 'HumanName', min: 1, max: '1', type: [{ code: 'HumanName', profile: [canonical] }] },
  ] } };

describe('nested datatype slice context follows its actual containing resource', () => {
  it('resolves two exact name identities to their own Patient P/N instead of Bundle', async () => {
    const { permitted, rejected, bundle } = fixture();
    await withSliceInstanceEvidence(async () => {
      await prepareDatatypeProfileConformance([permitted, rejected], [slice], slicing,
        async () => profile("%resource.where(gender='other').exists()"), { fhirVersion: 'R4', rootResource: bundle, elementPath: path });
      expect(membership(permitted)).toBe(true);
      expect(membership(rejected)).toBe(false);
    });
  });

  it('retains the actual outer Bundle as rootResource beside the nearest Patient', async () => {
    const { permitted, rejected, bundle } = fixture();
    await withSliceInstanceEvidence(async () => {
      await prepareDatatypeProfileConformance([permitted, rejected], [slice], slicing,
        async () => profile("%rootResource.resourceType='Bundle'"), { fhirVersion: 'R4', rootResource: bundle, elementPath: path });
      expect(membership(permitted)).toBe(true);
      expect(membership(rejected)).toBe(true);
    });
  });

  it('keeps a datum not located by identity at the supplied root path U', async () => {
    const { bundle } = fixture();
    const orphan = { family: 'Muster', given: ['Franz'] };
    await withSliceInstanceEvidence(async () => {
      await prepareDatatypeProfileConformance([orphan], [slice], slicing,
        async () => profile("%resource.where(gender='other').exists()"), { fhirVersion: 'R4', rootResource: bundle, elementPath: path });
      expect(datatypeConformingSlices(orphan)).toBeUndefined();
      expect(partialDatatypeMembership(orphan)!.has('HumanName')).toBe(true);
      expect(partialDatatypeMembership(orphan)!.get('HumanName')).toBeUndefined();
    });
  });

  it('keeps the real ProfileSlicingValidation caller and matched constraint stage in the same Patient/Bundle context', async () => {
    const { bundle } = fixture();
    const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
    validator.setTypeProfileResolver(async () => profile("%resource.where(gender='other').exists() and %rootResource.resourceType='Bundle'"));
    const issues = await new ProfileSlicingValidation(validator).validate({ extensionIssues: [], resource: bundle,
      structureDef: host, fhirVersion: 'R4', getValueAtPath });
    expect(issues.filter(issue => issue.path?.startsWith('Bundle.entry[0].resource.name') && issue.severity === 'error')).toEqual([]);
    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality').map(issue => issue.path)).toEqual(['Bundle.entry[1].resource.name']);
    expect(issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false)).toBe(false);
  });
});
