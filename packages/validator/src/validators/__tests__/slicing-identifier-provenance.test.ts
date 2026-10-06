import { describe, expect, it } from 'vitest';
import { SlicingValidator } from '../slicing-validator';
import { attachAppliedProfile } from '../../core/multi-aspect-contained-validation';
import { testStructureDefinition } from './slicing-test-builders';

const profile = testStructureDefinition({
  url: 'https://example.org/StructureDefinition/PatientNumber', version: '1.2.3', name: 'PatientNumber', type: 'Patient',
  snapshot: { element: [
    { id: 'Patient.identifier', path: 'Patient.identifier', slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' } },
    { id: 'Patient.identifier:Patientennummer', path: 'Patient.identifier', sliceName: 'Patientennummer', min: 1, max: '1',
      patternIdentifier: { type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR' }] } } },
  ] },
});
const identifier = { system: 'https://example.org/patients', value: 'DEMO-001' };
const typedIdentifier = { ...identifier, type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR' }] } };

describe('patient-number slice provenance', () => {
  it('retains the versioned rule profile and slice target through applied-context attribution', async () => {
    const issues = await new SlicingValidator().validateSlicing([identifier], 'Patient.identifier', profile);
    const missing = issues.find(issue => issue.code === 'profile-slice-min-cardinality');
    expect(missing).toMatchObject({ profile: `${profile.url}|1.2.3`, details: { elementId: 'Patient.identifier:Patientennummer' } });
    expect(attachAppliedProfile(missing!, 'https://example.org/another-context').details).not.toMatchObject({ profileAttribution: 'validation-context' });
    const corrected = await new SlicingValidator().validateSlicing([typedIdentifier], 'Patient.identifier', profile);
    expect(corrected.some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(false);
  });
  it('also attributes an excess matching identifier to the versioned rule profile', async () => {
    const issues = await new SlicingValidator().validateSlicing([typedIdentifier, { ...typedIdentifier, value: 'DEMO-002' }], 'Patient.identifier', profile);
    expect(issues.find(issue => issue.code === 'profile-slice-max-cardinality')).toMatchObject({ profile: `${profile.url}|1.2.3` });
  });
});
