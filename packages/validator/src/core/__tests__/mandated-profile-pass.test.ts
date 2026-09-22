import { describe, expect, it } from 'vitest';
import { mandatedProfileAdditions, mandatedProfileBeside } from '../mandated-profile-pass.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

const systolic = {
  resourceType: 'Observation',
  status: 'final',
  code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
};

const issue = (code: string, message: string, path = 'Observation.component'): ValidationIssue => ({
  severity: 'error', code, path, message, aspect: 'structural',
} as ValidationIssue);

describe('mandatedProfileBeside', () => {
  it('names the profile the code requires next to a declared one', () => {
    expect(mandatedProfileBeside(systolic, 'http://hl7.org/fhir/StructureDefinition/vitalsigns'))
      .toBe('http://hl7.org/fhir/StructureDefinition/bp');
  });

  it('names it next to the base canonical too', () => {
    expect(mandatedProfileBeside(systolic, 'http://hl7.org/fhir/StructureDefinition/Observation'))
      .toBe('http://hl7.org/fhir/StructureDefinition/bp');
  });

  it('names nothing once the mandated profile is the applied one', () => {
    expect(mandatedProfileBeside(systolic, 'http://hl7.org/fhir/StructureDefinition/bp')).toBeNull();
    expect(mandatedProfileBeside(systolic, 'http://hl7.org/fhir/StructureDefinition/bp|4.0.1')).toBeNull();
  });

  it('names nothing for a resource whose code mandates no profile', () => {
    const laboratory = {
      resourceType: 'Observation',
      code: { coding: [{ system: 'http://loinc.org', code: '718-7' }] },
    };
    expect(mandatedProfileBeside(laboratory, 'http://hl7.org/fhir/StructureDefinition/Observation')).toBeNull();
    expect(mandatedProfileBeside({ resourceType: 'Patient' }, 'x')).toBeNull();
  });
});

describe('mandatedProfileAdditions', () => {
  it('retains conformance failures downgraded by strictness policy', () => {
    const downgraded = { ...issue('structural-cardinality-min', 'too few'),
      severity: 'warning' as const, rawSeverity: 'error' as const };
    expect(mandatedProfileAdditions([], [downgraded], 'urn:mandated'))
      .toEqual([{ ...downgraded, profile: 'urn:mandated' }]);
  });

  it('preserves distinct missing slices at the same element', () => {
    const slice = (name: string) => ({ ...issue('profile-slice-min-cardinality', `Missing ${name}`),
      aspect: 'profile' as const, details: { sliceName: name } });
    expect(mandatedProfileAdditions([slice('systolic')], [slice('systolic'), slice('diastolic')], 'urn:bp'))
      .toMatchObject([{ details: { sliceName: 'diastolic' } }]);
  });

  it('keeps active evidence beside an earlier suppressed copy', () => {
    const constraint = issue('structural-cardinality-min', 'too few');
    expect(mandatedProfileAdditions([{ ...constraint, disposition: 'suppressed' }], [constraint], 'urn:bp'))
      .toHaveLength(1);
  });

  it('contributes only what the applied profile did not report', () => {
    const reported = [issue('structural-cardinality-min', 'too few values')];
    const additions = mandatedProfileAdditions(
      reported,
      [
        issue('structural-cardinality-min', 'too few values'),
        issue('profile-slice-min-cardinality', 'BPCode', 'Observation.code.coding'),
      ],
      'http://hl7.org/fhir/StructureDefinition/bp',
    );
    expect(additions.map(added => added.code)).toEqual(['profile-slice-min-cardinality']);
  });

  it('attributes an addition to the mandated profile, leaving a stated one alone', () => {
    const [attributed, stated] = mandatedProfileAdditions(
      [],
      [
        issue('structural-cardinality-min', 'too few values'),
        {
          ...issue('profile-slice-min-cardinality', 'BPCode', 'Observation.code.coding'),
          profile: 'urn:already-stated',
        },
      ],
      'http://hl7.org/fhir/StructureDefinition/bp',
    );
    expect(attributed.profile).toBe('http://hl7.org/fhir/StructureDefinition/bp');
    expect(stated.profile).toBe('urn:already-stated');
  });

  it('leaves everything the mandated profile does not constrain out', () => {
    const additions = mandatedProfileAdditions(
      [],
      [
        { ...issue('terminology-codesystem-unresolvable', 'unverified'), severity: 'warning', aspect: 'terminology' },
        { ...issue('terminology-binding-required-code', 'not in value set'), aspect: 'terminology' },
        { ...issue('profile-slice-open-unmatched', 'no slice'), severity: 'information', aspect: 'profile' },
      ] as ValidationIssue[],
      'http://hl7.org/fhir/StructureDefinition/bp',
    );
    expect(additions).toEqual([]);
  });

  it('keeps one copy when the mandated pass repeats itself', () => {
    const additions = mandatedProfileAdditions(
      [],
      [issue('structural-cardinality-min', 'too few values'), issue('structural-cardinality-min', 'too few values')],
      'http://hl7.org/fhir/StructureDefinition/bp',
    );
    expect(additions).toHaveLength(1);
  });
});
