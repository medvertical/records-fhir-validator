import { describe, expect, it } from 'vitest';
import type { SlicingDefinition, StructureDefinition } from '../../core/structure-definition-types.js';
import { datatypeConformingSlices, partialDatatypeMembership, prepareDatatypeProfileConformance, prepareResourceProfileConformance } from '../slice-datatype-conformance.js';
import { withSliceInstanceEvidence } from '../slice-instance-evidence.js';
import { prepareSliceProfileTypes } from '../slice-profile-types.js';
import { SlicingValidator } from '../slicing-validator.js';
import type { SliceDefinition } from '../slice-types.js';

type Profile = Pick<StructureDefinition, 'type' | 'snapshot'>;
const canonical = 'http://fhir.ch/ig/ch-epr-fhir/StructureDefinition/ch-epr-fhir-humanname';
const byProfile: SlicingDefinition = { discriminator: [{ type: 'profile', path: '$this' }], rules: 'closed' };
const nameSlice: SliceDefinition = { sliceName: 'HumanName', path: 'Patient.name', min: 1, max: '1', type: [{ code: 'HumanName', profile: [canonical] }] };
const nameValue = () => ({ family: 'Muster', given: ['Franz'] });
const constraint = (expression: string) => [{ key: 'owned-context-1', severity: 'error' as const, expression }];
const nameProfile = (expression: string): Profile => ({ type: 'HumanName', snapshot: { element: [
  { id: 'HumanName', path: 'HumanName', constraint: constraint(expression) },
] } });
const resolve = (profile: Profile) => async () => profile;
const nameState = (value: unknown) => {
  const partial = partialDatatypeMembership(value);
  return partial ? partial.get('HumanName') : datatypeConformingSlices(value)?.has('HumanName');
};
const listCanonical = 'https://profiles.ihe.net/ITI/MHD/StructureDefinition/IHE.MHD.Comprehensive.SubmissionSet';
const listSlice: SliceDefinition = { sliceName: 'SubmissionSet', path: 'Parameters.parameter', min: 1, max: '1', childTypes: new Map([
  ['resource', [{ code: 'List', profile: [listCanonical] }]],
]) };
const listEntry = () => ({ resource: { resourceType: 'List', code: { coding: [{ code: 'submissionset' }] } } });
const listProfile = (expression: string): Profile => ({ type: 'List', snapshot: { element: [
  { id: 'List', path: 'List', constraint: constraint(expression) },
  { id: 'List.code', path: 'List.code', min: 1, max: '1', patternCodeableConcept: { coding: [{ code: 'submissionset' }] } },
] } });
const fullProfile = (url: string, profile: Profile, family: 'R4' | 'R5' = 'R4'): StructureDefinition => ({
  resourceType: 'StructureDefinition', url, name: 'ContextControl', status: 'active', kind: 'complex-type', abstract: false,
  fhirVersion: family === 'R4' ? '4.0.1' : '5.0.0', ...profile,
});

describe('profile prepass receives the actual FHIR version and resource context', () => {
  it.each([
    ['resource', { resourceType: 'Patient', gender: 'other' }, true],
    ['resource', { resourceType: 'Patient', gender: 'male' }, false],
    ['resource', undefined, undefined],
    ['rootResource', { resourceType: 'Patient', gender: 'other' }, true],
    ['rootResource', { resourceType: 'Patient', gender: 'male' }, false],
    ['rootResource', undefined, undefined],
  ] as const)('keeps datatype %s with supplied root %j as P/N/U', async (variable, rootResource, expected) => {
    const value = nameValue();
    await withSliceInstanceEvidence(async () => {
      await prepareDatatypeProfileConformance([value], [nameSlice], byProfile,
        resolve(nameProfile(`%${variable}.where(gender='other').exists()`)), { fhirVersion: 'R4', rootResource });
      expect(nameState(value)).toBe(expected);
      if (expected === undefined) {
        expect(datatypeConformingSlices(value)).toBeUndefined();
        expect(partialDatatypeMembership(value)!.has('HumanName')).toBe(true);
      }
    });
  });

  it('does not bind a malformed supplied context as a FHIR resource', async () => {
    const value = nameValue();
    await withSliceInstanceEvidence(async () => {
      await prepareDatatypeProfileConformance([value], [nameSlice], byProfile,
        resolve(nameProfile("%resource.gender='other'")), { fhirVersion: 'R4', rootResource: { gender: 'other' } });
      expect(partialDatatypeMembership(value)!.has('HumanName')).toBe(true);
      expect(nameState(value)).toBeUndefined();
    });
  });

  it.each([
    ["%resource.resourceType='List'", { resourceType: 'Parameters' }, true],
    ["%resource.resourceType='List'", undefined, true],
    ["%rootResource.resourceType='Parameters'", { resourceType: 'Parameters' }, true],
    ["%rootResource.resourceType='Parameters'", { resourceType: 'Bundle' }, false],
    ["%rootResource.resourceType='List'", undefined, undefined],
  ] as const)('binds embedded %s only from actual context %j', async (expression, rootResource, expected) => {
    const entry = listEntry();
    await withSliceInstanceEvidence(async () => {
      await prepareResourceProfileConformance([entry], [listSlice], 'resource', resolve(listProfile(expression)), { fhirVersion: 'R4', rootResource });
      const membership = datatypeConformingSlices(entry.resource);
      if (expected === undefined) expect(membership).toBeUndefined();
      else { expect(membership).toBeDefined(); expect(membership!.has('SubmissionSet')).toBe(expected); }
    });
  });

  it.each(['R4', 'R5'] as const)('uses the actual %s Encounter.class model through prepareSliceProfileTypes', async fhirVersion => {
    const encounterCanonical = 'https://example.test/StructureDefinition/DerivedEncounter';
    const slice: SliceDefinition = { sliceName: 'Encounter', path: 'Bundle.entry', min: 1, max: '1', childTypes: new Map([
      ['resource', [{ code: 'Encounter', profile: [encounterCanonical] }]],
    ]) };
    const entry = { resource: { resourceType: 'Encounter', class: [{ coding: [{ code: 'IMP' }] }] } };
    const profile: Profile = { type: 'Encounter', snapshot: { element: [{ id: 'Encounter', path: 'Encounter',
      constraint: constraint('class.ofType(CodeableConcept).exists()'),
    }] } };
    await withSliceInstanceEvidence(async () => {
      await prepareSliceProfileTypes([entry], [slice], { discriminator: [{ type: 'profile', path: 'resource' }], rules: 'closed' },
        resolve(profile), { fhirVersion, rootResource: { resourceType: 'Bundle', entry: [entry] } });
      expect(datatypeConformingSlices(entry.resource)).toBeDefined();
      expect(datatypeConformingSlices(entry.resource)!.has('Encounter')).toBe(fhirVersion === 'R5');
    });
  });

  it.each([
    ['P', { resourceType: 'Patient', gender: 'other' }, false, false],
    ['N', { resourceType: 'Patient', gender: 'male' }, true, false],
    ['U', undefined, false, true],
  ] as const)('forwards actual caller context through SlicingValidator as %s', async (_state, rootResource, negative, incomplete) => {
    const profile: StructureDefinition = { resourceType: 'StructureDefinition', url: 'https://example.test/StructureDefinition/AlternativeSource',
      name: 'NameContextHost', status: 'active', kind: 'resource', abstract: false, type: 'Patient', snapshot: { element: [
        { id: 'Patient', path: 'Patient' },
        { id: 'Patient.name', path: 'Patient.name', min: 0, max: '*', type: [{ code: 'HumanName' }], slicing: byProfile },
        { id: 'Patient.name:HumanName', path: 'Patient.name', sliceName: 'HumanName', min: 1, max: '1',
          type: [{ code: 'HumanName', profile: [canonical] }] },
      ] } };
    const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
    validator.setTypeProfileResolver(async () => fullProfile(canonical, nameProfile("%resource.where(gender='other').exists()")));
    const value = nameValue();
    const containing = rootResource ? { ...rootResource, name: [value] } : undefined;
    const issues = await validator.validateSlicing([value], 'Patient.name', profile, null, 'Patient.name', 'R4', containing);
    expect(issues.some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(negative);
    expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(negative);
    expect(issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false)).toBe(incomplete);
    expect(issues.some(issue => issue.code === 'profile-constraint-violation')).toBe(false);
  });

  it.each(['R4', 'R5'] as const)('forwards request %s from SlicingValidator to the resource model', async fhirVersion => {
    const targetCanonical = 'https://example.test/StructureDefinition/DerivedEncounter';
    const slicing: SlicingDefinition = { discriminator: [{ type: 'profile', path: 'resource' }], rules: 'closed' };
    const host: StructureDefinition = { resourceType: 'StructureDefinition', url: 'https://example.test/StructureDefinition/AlternativeSource',
      name: 'EncounterContextHost', status: 'active', kind: 'resource', abstract: false, type: 'Bundle', snapshot: { element: [
        { id: 'Bundle', path: 'Bundle' },
        { id: 'Bundle.entry', path: 'Bundle.entry', min: 0, max: '*', type: [{ code: 'BackboneElement' }], slicing },
        { id: 'Bundle.entry:Encounter', path: 'Bundle.entry', sliceName: 'Encounter', min: 1, max: '1', type: [{ code: 'BackboneElement' }] },
        { id: 'Bundle.entry:Encounter.resource', path: 'Bundle.entry.resource', min: 1, max: '1', type: [{ code: 'Encounter', profile: [targetCanonical] }] },
      ] } };
    const entry = { resource: { resourceType: 'Encounter', class: [{ coding: [{ code: 'IMP' }] }] } };
    const target = { ...fullProfile(targetCanonical, { type: 'Encounter', snapshot: { element: [{
      id: 'Encounter', path: 'Encounter', constraint: constraint('class.ofType(CodeableConcept).exists()'),
    }] } }, fhirVersion), kind: 'resource' as const };
    const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: async () => null } });
    validator.setTypeProfileResolver(async () => target);
    const issues = await validator.validateSlicing([entry], 'Bundle.entry', host, null, 'Bundle.entry', fhirVersion, { resourceType: 'Bundle', entry: [entry] });
    expect(issues.some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(fhirVersion === 'R4');
    expect(issues.some(issue => issue.code === 'profile-slice-closed-unmatched')).toBe(fhirVersion === 'R4');
    expect(issues.some(issue => typeof issue.details === 'object' && issue.details?.validationComplete === false)).toBe(false);
  });
});
