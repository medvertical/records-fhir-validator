import { describe, expect, it } from 'vitest';
import type { SlicingDefinition, StructureDefinition } from '../../core/structure-definition-types.js';
import { datatypeConformingSlices, partialDatatypeMembership, prepareDatatypeProfileConformance, prepareResourceProfileConformance } from '../slice-datatype-conformance.js';
import { withSliceInstanceEvidence } from '../slice-instance-evidence.js';
import { prepareSliceProfileTypes } from '../slice-profile-types.js';
import { matchDiscriminator } from '../slice-discriminator-matcher.js';
import { codingMatchesBindingCodes, matchesPattern } from '../slice-utils.js';
import type { SliceDefinition } from '../slice-types.js';

type Profile = Pick<StructureDefinition, 'type' | 'snapshot'>;
const byProfile: SlicingDefinition = { discriminator: [{ type: 'profile', path: '$this' }], rules: 'closed' };
const resourceSlicing: SlicingDefinition = { discriminator: [{ type: 'profile', path: 'resource' }], rules: 'closed' };
const datatypeSlice = (sliceName: string, type: string, ...profiles: string[]): SliceDefinition => ({
  sliceName, path: type === 'HumanName' ? 'Patient.name' : 'MedicationStatement.dosage', min: 0, max: '*', type: [{ code: type, profile: profiles }],
});
const listSlice = (sliceName: string, ...profiles: string[]): SliceDefinition => ({
  sliceName, path: 'Bundle.entry', min: 0, max: '*', childTypes: new Map([['resource', [{ code: 'List', profile: profiles }]]]),
});
const rootConstraint = (expression: string) => [{ key: 'owned-root-1', severity: 'error' as const, expression }];
const listProfile = (code: string, expression?: string): Profile => ({ type: 'List', snapshot: { element: [
  { id: 'List', path: 'List', ...(expression ? { constraint: rootConstraint(expression) } : {}) },
  { id: 'List.code', path: 'List.code', min: 1, max: '1', patternCodeableConcept: { coding: [{ code }] } },
] } });
const submissionEntry = () => ({ resource: { resourceType: 'List', code: { coding: [{
  system: 'https://profiles.ihe.net/ITI/MHD/CodeSystem/MHDlistTypes', code: 'submissionset',
}] } } });
const resolve = (profiles: Record<string, Profile>) => async (url: string) => profiles[url] ?? null;
const matched = (value: unknown, slices: SliceDefinition[], slicing: SlicingDefinition) => slices.filter(slice =>
  matchDiscriminator(value, slice, slicing.discriminator![0], null, matchesPattern, codingMatchesBindingCodes, slices))
  .map(slice => slice.sliceName);

describe("profile conformance keeps each alternative's constraints and invariants together", () => {
  it('joins constraints and invariants from the same CH eMed datatype alternative', async () => {
    const EMED = 'http://fhir.ch/ig/ch-emed/StructureDefinition/';
    const base = `${EMED}ch-emed-dosage`;
    const split = `${EMED}ch-emed-dosage-split`;
    const profiles: Record<string, Profile> = {
      [base]: { type: 'Dosage', snapshot: { element: [
        { id: 'Dosage', path: 'Dosage' },
        { id: 'Dosage.sequence', path: 'Dosage.sequence', min: 0, max: '1', constraint: [{
          key: 'ch-dosage-1', severity: 'error', expression: '$this.count() = 0 or $this = 1',
        }] },
      ] } },
      [split]: { type: 'Dosage', snapshot: { element: [
        { id: 'Dosage', path: 'Dosage' },
        { id: 'Dosage.sequence', path: 'Dosage.sequence', min: 1, max: '1' },
        { id: 'Dosage.route', path: 'Dosage.route', min: 0, max: '0' },
      ] } },
    };
    const slices = [datatypeSlice('owned', 'Dosage', base, split), datatypeSlice('base', 'Dosage', base)];
    const value = { sequence: 2, route: { text: 'oral' }, doseAndRate: [{ doseQuantity: { value: 1 } }] };
    await withSliceInstanceEvidence(async () => {
      await prepareDatatypeProfileConformance([value], slices, byProfile, resolve(profiles));
      expect([...datatypeConformingSlices(value)!]).toEqual([]);
      expect(matched(value, slices, byProfile)).toEqual([]);
    });
  });

  it.each(['single', 'all-rejected'] as const)('requires the root invariant for %s resource candidates', async scenario => {
    const canonical = 'https://profiles.ihe.net/ITI/MHD/StructureDefinition/IHE.MHD.Comprehensive.SubmissionSet';
    const slices = [listSlice('SubmissionSet', canonical), ...(scenario === 'all-rejected' ? [listSlice('OtherSubmissionSet', canonical)] : [])];
    const entry = submissionEntry();
    await withSliceInstanceEvidence(async () => {
      await prepareSliceProfileTypes([entry], slices, resourceSlicing, resolve({ [canonical]: listProfile('submissionset', 'false') }));
      expect(datatypeConformingSlices(entry.resource), 'readable matching type must decide root invariant rejection').toBeDefined();
      expect([...datatypeConformingSlices(entry.resource)!]).toEqual([]);
      expect(matched(entry, slices, resourceSlicing)).toEqual([]);
    });
  });

  it('keeps an accepted resource root invariant positive', async () => {
    const canonical = 'https://profiles.ihe.net/ITI/MHD/StructureDefinition/IHE.MHD.Comprehensive.SubmissionSet';
    const slices = [listSlice('SubmissionSet', canonical)];
    const entry = submissionEntry();
    await withSliceInstanceEvidence(async () => {
      await prepareSliceProfileTypes([entry], slices, resourceSlicing, resolve({ [canonical]: listProfile('submissionset', 'true') }));
      expect([...datatypeConformingSlices(entry.resource)!]).toEqual(['SubmissionSet']);
      expect(matched(entry, slices, resourceSlicing)).toEqual(['SubmissionSet']);
    });
  });

  it('joins constraints and invariants from the same MHD resource alternative', async () => {
    const MHD = 'https://profiles.ihe.net/ITI/MHD/StructureDefinition/';
    const submission = `${MHD}IHE.MHD.Comprehensive.SubmissionSet`;
    const folder = `${MHD}IHE.MHD.Minimal.Folder`;
    const slices = [listSlice('owned', submission, folder), listSlice('base', submission)];
    const entry = submissionEntry();
    await withSliceInstanceEvidence(async () => {
      await prepareResourceProfileConformance([entry], slices, 'resource', resolve({
        [submission]: listProfile('submissionset', 'false'), [folder]: listProfile('folder', 'true'),
      }));
      expect([...datatypeConformingSlices(entry.resource)!]).toEqual([]);
      expect(matched(entry, slices, resourceSlicing)).toEqual([]);
    });
  });

  it('keeps an existing prepared resource Pattern N despite a contradictory meta.profile claim', async () => {
    const canonical = 'https://profiles.ihe.net/ITI/MHD/StructureDefinition/IHE.MHD.Minimal.Folder';
    const slices = [listSlice('Folders', canonical), listSlice('OtherFolders', canonical)];
    const entry = { resource: { ...submissionEntry().resource, meta: { profile: [canonical] } } };
    await withSliceInstanceEvidence(async () => {
      await prepareResourceProfileConformance([entry], slices, 'resource', resolve({ [canonical]: listProfile('folder') }));
      expect([...datatypeConformingSlices(entry.resource)!]).toEqual([]);
      expect(matched(entry, slices, resourceSlicing)).toEqual([]);
    });
  });

  it.each(['unsupportedOwnedFunction()', "'metadata-only'"])(
    'keeps unknown datatype invariant evaluation %s as U', async expression => {
      const canonical = 'http://fhir.ch/ig/ch-epr-fhir/StructureDefinition/ch-epr-fhir-humanname';
      const value = { family: 'Muster', given: ['Franz'] };
      const slices = [datatypeSlice('HumanName', 'HumanName', canonical)];
      await withSliceInstanceEvidence(async () => {
        await prepareDatatypeProfileConformance([value], slices, byProfile, resolve({
          [canonical]: { type: 'HumanName', snapshot: { element: [{ id: 'HumanName', path: 'HumanName', constraint: rootConstraint(expression) }] } },
        }));
        expect(datatypeConformingSlices(value)).toBeUndefined();
        const states = partialDatatypeMembership(value);
        expect(states).toBeDefined();
        expect(states!.has('HumanName')).toBe(true);
        expect(states!.get('HumanName')).toBeUndefined();
      });
    },
  );

  it('keeps an unreadable datatype alternative U beside a known rejection', async () => {
    const canonical = 'http://fhir.ch/ig/ch-epr-fhir/StructureDefinition/ch-epr-fhir-humanname';
    const value = { family: 'Muster', given: ['Franz'] };
    const slices = [datatypeSlice('HumanName', 'HumanName', canonical, `${canonical}-unavailable`)];
    await withSliceInstanceEvidence(async () => {
      await prepareDatatypeProfileConformance([value], slices, byProfile, resolve({
        [canonical]: { type: 'HumanName', snapshot: { element: [{ id: 'HumanName', path: 'HumanName', constraint: rootConstraint('false') }] } },
      }));
      expect(datatypeConformingSlices(value)).toBeUndefined();
      expect(partialDatatypeMembership(value)!.has('HumanName')).toBe(true);
      expect(partialDatatypeMembership(value)!.get('HumanName')).toBeUndefined();
    });
  });

  it('keeps a readable P despite an unreadable datatype alternative', async () => {
    const canonical = 'http://fhir.ch/ig/ch-epr-fhir/StructureDefinition/ch-epr-fhir-humanname';
    const value = { family: 'Muster', given: ['Franz'] };
    const slices = [datatypeSlice('HumanName', 'HumanName', canonical, `${canonical}-unavailable`)];
    await withSliceInstanceEvidence(async () => {
      await prepareDatatypeProfileConformance([value], slices, byProfile, resolve({
        [canonical]: { type: 'HumanName', snapshot: { element: [{ id: 'HumanName', path: 'HumanName', constraint: rootConstraint('true') }] } },
      }));
      const state = partialDatatypeMembership(value)?.get('HumanName') ?? datatypeConformingSlices(value)?.has('HumanName');
      expect(state).toBe(true);
    });
  });

  it('keeps independently false datatype cardinality N beside an unknown invariant', async () => {
    const canonical = 'http://fhir.ch/ig/ch-emed/StructureDefinition/ch-emed-dosage-split';
    const value = { sequence: 2, route: { text: 'oral' } };
    const slices = [datatypeSlice('additionalEntry', 'Dosage', canonical)];
    await withSliceInstanceEvidence(async () => {
      await prepareDatatypeProfileConformance([value], slices, byProfile, resolve({ [canonical]: { type: 'Dosage', snapshot: { element: [
        { id: 'Dosage', path: 'Dosage', constraint: rootConstraint('unsupportedOwnedFunction()') },
        { id: 'Dosage.sequence', path: 'Dosage.sequence', min: 1, max: '1' },
        { id: 'Dosage.route', path: 'Dosage.route', min: 0, max: '0' },
      ] } } }));
      expect([...datatypeConformingSlices(value)!]).toEqual([]);
      expect(partialDatatypeMembership(value)).toBeUndefined();
    });
  });

  it('does not publish full resource membership when its root invariant evaluation is U', async () => {
    const canonical = 'https://profiles.ihe.net/ITI/MHD/StructureDefinition/IHE.MHD.Comprehensive.SubmissionSet';
    const slices = [listSlice('SubmissionSet', canonical), listSlice('OtherSubmissionSet', canonical)];
    const entry = submissionEntry();
    await withSliceInstanceEvidence(async () => {
      await prepareResourceProfileConformance([entry], slices, 'resource', resolve({ [canonical]: listProfile('submissionset', 'unsupportedOwnedFunction()') }));
      expect(datatypeConformingSlices(entry.resource)).toBeUndefined();
    });
  });
});
