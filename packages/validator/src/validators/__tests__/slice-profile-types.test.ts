import { describe, expect, it } from 'vitest';
import { prepareSliceProfileTypes, sliceTypedByProfile } from '../slice-profile-types';
import { matchDiscriminator } from '../slice-discriminator-matcher';
import { codingMatchesBindingCodes, matchesPattern } from '../slice-utils';
import type { SliceDefinition } from '../slice-types';
import type { SlicingDefinition } from '../../core/structure-definition-types';

// CH Core document: every entry slice is typed `Resource` and told apart
// only by the profile its resource must conform to.
const CH = 'http://fhir.ch/ig/ch-core/StructureDefinition/';
const typeByProfile: Record<string, string> = {
  [`${CH}ch-core-composition`]: 'Composition',
  [`${CH}ch-core-patient`]: 'Patient',
  [`${CH}ch-core-patient-epr`]: 'Patient',
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
const composition = entrySlice('Composition', `${CH}ch-core-composition`);

describe('slice profile types', () => {
  it('places an entry that declares no profile in the one slice its type admits', async () => {
    const entry = { resource: { resourceType: 'Composition', id: 'c' } };
    const slices = [composition, entrySlice('Patient', `${CH}ch-core-patient`)];

    await prepareSliceProfileTypes([entry], slices, slicing, resolveProfile);

    expect(sliceTypedByProfile(entry.resource)).toBe('Composition');
    expect(matchDiscriminator(entry, composition, slicing.discriminator![0], null, matchesPattern, codingMatchesBindingCodes, slices))
      .toBe(true);
  });

  it('decides nothing for a type two slices admit', async () => {
    const entry = { resource: { resourceType: 'Patient', id: 'p' } };
    const slices = [composition, entrySlice('Patient', `${CH}ch-core-patient`), entrySlice('EprPatient', `${CH}ch-core-patient-epr`)];

    await prepareSliceProfileTypes([entry], slices, slicing, resolveProfile);

    expect(sliceTypedByProfile(entry.resource)).toBeUndefined();
  });

  it('decides nothing while a slice profile cannot be read', async () => {
    const entry = { resource: { resourceType: 'Composition', id: 'c' } };
    const slices = [composition, entrySlice('Unknown', 'http://example.org/StructureDefinition/unknown')];

    await prepareSliceProfileTypes([entry], slices, slicing, resolveProfile);

    expect(sliceTypedByProfile(entry.resource)).toBeUndefined();
  });

  // IHE MHD's ProvideBundle holds a SubmissionSet and Folders, Lists told
  // apart by the code their profiles fix; the entries declare neither.
  it('places a resource of a type two slices admit by the profile it conforms to', async () => {
    const MHD = 'https://profiles.ihe.net/ITI/MHD/StructureDefinition/';
    const listProfile = (code: string) => ({ type: 'List', snapshot: { element: [
      { id: 'List', path: 'List' },
      { id: 'List.code', path: 'List.code', min: 1, max: '1', patternCodeableConcept: { coding: [{ code }] } },
    ] } });
    const listProfiles: Record<string, unknown> = {
      [`${MHD}IHE.MHD.Comprehensive.SubmissionSet`]: listProfile('submissionset'),
      [`${MHD}IHE.MHD.Minimal.Folder`]: listProfile('folder'),
    };
    const listSlice = (sliceName: string, profile: string): SliceDefinition => ({
      sliceName, path: 'Bundle.entry', min: 0, max: '*', childTypes: new Map([['resource', [{ code: 'List', profile: [profile] }]]]),
    });
    const slices = [listSlice('SubmissionSet', `${MHD}IHE.MHD.Comprehensive.SubmissionSet`), listSlice('Folders', `${MHD}IHE.MHD.Minimal.Folder`)];
    const entry = { resource: { resourceType: 'List', code: { coding: [{ system: 'https://profiles.ihe.net/ITI/MHD/CodeSystem/MHDlistTypes', code: 'submissionset' }] } } };

    await prepareSliceProfileTypes([entry], slices, slicing, async url => listProfiles[url] as never ?? null);

    expect(slices.filter(slice =>
      matchDiscriminator(entry, slice, slicing.discriminator![0], null, matchesPattern, codingMatchesBindingCodes, slices))
      .map(slice => slice.sliceName)).toEqual(['SubmissionSet']);
  });
});

// eu.imaging ImagingStudyEuImaging slices identifier by profile at `system`;
// the slice's Identifier profile fixes the system and the DICOM type.
describe('profile discriminator on a primitive below the slice', () => {
  const discriminator = { type: 'profile' as const, path: 'system' };
  const studyInstanceUid: SliceDefinition = {
    sliceName: 'studyInstanceUid',
    path: 'ImagingStudy.identifier',
    min: 1,
    max: '1',
    type: [{ code: 'Identifier', profile: ['http://hl7.eu/fhir/imaging/StructureDefinition/StudyInstanceUidIdentifierEuImaging'] }],
    childPatterns: new Map<string, unknown>([['system', 'urn:dicom:uid']]),
  };
  const matches = (identifier: Record<string, unknown>) =>
    matchDiscriminator(identifier, studyInstanceUid, discriminator, null, matchesPattern, codingMatchesBindingCodes, [studyInstanceUid]);

  it('decides by the constraints of the slice\'s datatype profile', () => {
    expect(matches({ system: 'urn:dicom:uid', value: 'urn:oid:1.3.46.670589' })).toBe(true);
    expect(matches({ system: 'urn:ietf:rfc:3986', value: 'urn:oid:1.3.46.670589' })).toBe(false);
  });
});


// CH eMed slices MedicationStatement.dosage by two Dosage profiles: a split
// entry needs a sequence and has no route, and only the base entry's
// invariant (ch-dosage-1) keeps a split entry out of it.
describe('profile discriminator on a datatype', () => {
  const EMED = 'http://fhir.ch/ig/ch-emed/StructureDefinition/';
  const dosageProfile = (...elements: Array<Record<string, unknown>>) => ({
    type: 'Dosage',
    snapshot: { element: [{ id: 'Dosage', path: 'Dosage' }, ...elements] },
  });
  const profiles: Record<string, ReturnType<typeof dosageProfile>> = {
    [`${EMED}ch-emed-dosage`]: dosageProfile({
      id: 'Dosage.sequence', path: 'Dosage.sequence', min: 0, max: '1',
      constraint: [{ key: 'ch-dosage-1', severity: 'error', expression: '$this.count() = 0 or $this = 1' }],
    }),
    [`${EMED}ch-emed-dosage-split`]: dosageProfile(
      { id: 'Dosage.sequence', path: 'Dosage.sequence', min: 1, max: '1' },
      { id: 'Dosage.route', path: 'Dosage.route', min: 0, max: '0' },
    ),
  };
  const dosageSlice = (sliceName: string, profile: string): SliceDefinition => ({
    sliceName, path: 'MedicationStatement.dosage', min: 0, max: '*', type: [{ code: 'Dosage', profile: [profile] }],
  });
  const slices = [dosageSlice('baseEntry', `${EMED}ch-emed-dosage`), dosageSlice('additionalEntry', `${EMED}ch-emed-dosage-split`)];
  const byProfile: SlicingDefinition = { discriminator: [{ type: 'profile', path: '$this' }], rules: 'closed' };

  it('places a value in the slice whose datatype profile it conforms to', async () => {
    const base = { route: { text: 'oral' }, doseAndRate: [{ doseQuantity: { value: 1 } }] };
    const split = { sequence: 2, doseAndRate: [{ doseQuantity: { value: 1 } }] };

    await prepareSliceProfileTypes([base, split], slices, byProfile, async url => profiles[url] as never ?? null);

    const matches = (value: unknown) => slices.filter(slice =>
      matchDiscriminator(value, slice, byProfile.discriminator![0], null, matchesPattern, codingMatchesBindingCodes, slices));
    expect(matches(base).map(slice => slice.sliceName)).toEqual(['baseEntry']);
    expect(matches(split).map(slice => slice.sliceName)).toEqual(['additionalEntry']);
  });

  // ISiP slices Organization.identifier by Identifier profiles that differ
  // only in the system each one fixes.
  it('holds a value to the fixed values of the profile', async () => {
    const identifierProfile = (system: string) => ({
      type: 'Identifier',
      snapshot: { element: [
        { id: 'Identifier', path: 'Identifier' },
        { id: 'Identifier.system', path: 'Identifier.system', min: 1, max: '1', fixedUri: system },
        { id: 'Identifier.value', path: 'Identifier.value', min: 1, max: '1' },
      ] },
    });
    const identifierProfiles: Record<string, ReturnType<typeof identifierProfile>> = {
      'http://fhir.de/StructureDefinition/identifier-iknr': identifierProfile('http://fhir.de/sid/arge-ik/iknr'),
      'http://fhir.de/StructureDefinition/identifier-telematik-id': identifierProfile('https://gematik.de/fhir/sid/telematik-id'),
    };
    const identifierSlice = (sliceName: string, profile: string): SliceDefinition => ({
      sliceName, path: 'Organization.identifier', min: 0, max: '1', type: [{ code: 'Identifier', profile: [profile] }],
    });
    const identifierSlices = [
      identifierSlice('Institutionskennzeichen', 'http://fhir.de/StructureDefinition/identifier-iknr'),
      identifierSlice('TelematikId', 'http://fhir.de/StructureDefinition/identifier-telematik-id'),
    ];
    const telematikId = { system: 'https://gematik.de/fhir/sid/telematik-id', value: '1234567890' };

    await prepareSliceProfileTypes([telematikId], identifierSlices, byProfile, async url => identifierProfiles[url] as never ?? null);

    expect(identifierSlices.filter(slice =>
      matchDiscriminator(telematikId, slice, byProfile.discriminator![0], null, matchesPattern, codingMatchesBindingCodes, identifierSlices))
      .map(slice => slice.sliceName)).toEqual(['TelematikId']);
  });

  // CH EPR tells a birth name from any other by the BR qualifier on the
  // primitive family, which the name carries in its `_family` sidecar.
  it('reads the extensions of a primitive from its sidecar', async () => {
    const EPR = 'http://fhir.ch/ig/ch-epr-fhir/StructureDefinition/';
    const QUALIFIER = 'http://hl7.org/fhir/StructureDefinition/iso21090-EN-qualifier';
    const nameProfiles: Record<string, unknown> = {
      [`${EPR}ch-epr-fhir-humanname`]: { type: 'HumanName', snapshot: { element: [{
        id: 'HumanName',
        path: 'HumanName',
        constraint: [{ key: 'ch-epr-fhir-1', severity: 'error', expression: `family.extension.where(url='${QUALIFIER}' and value='BR').exists()=false` }],
      }] } },
      [`${EPR}ch-epr-fhir-birthname`]: { type: 'HumanName', snapshot: { element: [
        { id: 'HumanName', path: 'HumanName' },
        { id: 'HumanName.family', path: 'HumanName.family', min: 1, max: '1' },
        { id: 'HumanName.family.extension', path: 'HumanName.family.extension', min: 1, max: '2' },
      ] } },
    };
    const nameSlice = (sliceName: string, profile: string): SliceDefinition => ({
      sliceName, path: 'Patient.name', min: 0, max: '*', type: [{ code: 'HumanName', profile: [profile] }],
    });
    const nameSlices = [nameSlice('HumanName', `${EPR}ch-epr-fhir-humanname`), nameSlice('BirthName', `${EPR}ch-epr-fhir-birthname`)];
    const name = { family: 'Muster', given: ['Franz'] };
    const birthName = { family: 'Muster', _family: { extension: [{ url: QUALIFIER, valueCode: 'BR' }] } };

    await prepareSliceProfileTypes([name, birthName], nameSlices, byProfile, async url => nameProfiles[url] as never ?? null);

    const matches = (value: unknown) => nameSlices.filter(slice =>
      matchDiscriminator(value, slice, byProfile.discriminator![0], null, matchesPattern, codingMatchesBindingCodes, nameSlices))
      .map(slice => slice.sliceName);
    expect(matches(name)).toEqual(['HumanName']);
    expect(matches(birthName)).toEqual(['BirthName']);
  });
});

// CH eMed slices Composition.author by the profile its target conforms to;
// the device slice names the base Device definition, which no entry declares.
describe('profile discriminator naming a base definition', () => {
  const device: SliceDefinition = {
    sliceName: 'device', path: 'Composition.author', min: 0, max: '*',
    type: [{ code: 'Reference', targetProfile: ['http://hl7.org/fhir/StructureDefinition/Device'] }],
  };
  const byTargetProfile = { type: 'profile' as const, path: 'resolve()' };
  const resolve = (reference: string) => (reference === 'Device/ExampleDevice' ? { resourceType: 'Device', id: 'ExampleDevice' } : null);

  it('takes any resource of the type as conforming to it', () => {
    const matches = (reference: string) =>
      matchDiscriminator({ reference }, device, byTargetProfile, resolve, matchesPattern, codingMatchesBindingCodes, [device]);
    expect(matches('Device/ExampleDevice')).toBe(true);
    expect(matches('Device/unknown')).toBe(false);
  });
});
