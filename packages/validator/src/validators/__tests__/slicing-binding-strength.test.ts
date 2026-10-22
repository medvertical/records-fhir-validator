import { describe, expect, it, vi } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types';
import { extractSlicingInfo } from '../slice-info-extractor';
import { SlicingValidator } from '../slicing-validator';

const CATEGORY_SET = 'https://example.org/synthetic/ValueSet/consent-category';
const MII_SYSTEM = 'https://example.org/synthetic/CodeSystem/consent-modules';
const NON_IDENTIFYING_STRENGTHS = ['extensible', 'preferred', 'example', undefined] as const;
type BindingStrength = NonNullable<ElementDefinition['binding']>['strength'] | undefined;

function syntheticBinding(strength: BindingStrength): NonNullable<ElementDefinition['binding']> {
  // Profiles are external input; missing strength must not become required.
  return { ...(strength ? { strength } : {}), valueSet: CATEGORY_SET } as NonNullable<ElementDefinition['binding']>;
}

function consentProfile(strength: BindingStrength): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: 'https://example.org/synthetic/StructureDefinition/consent',
    name: 'SyntheticConsentSlicing', type: 'Consent', status: 'active', kind: 'resource', abstract: false,
    snapshot: { element: [
      { id: 'Consent.category', path: 'Consent.category', min: 2, max: '*',
        slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' } },
      { id: 'Consent.category:general', path: 'Consent.category', sliceName: 'general', min: 1, max: '*',
        binding: syntheticBinding(strength) },
      { id: 'Consent.category:loinc', path: 'Consent.category', sliceName: 'loinc', min: 1, max: '1',
        patternCodeableConcept: { coding: [{ system: 'http://loinc.org', code: '57016-8' }] } },
      { id: 'Consent.category:mii', path: 'Consent.category', sliceName: 'mii', min: 1, max: '1',
        patternCodeableConcept: { coding: [{ system: MII_SYSTEM, code: 'module' }] } },
    ] },
  };
}

function category(system: string, code: string) {
  return { coding: [{ system, code }] };
}

function childBindingProfile(strength: BindingStrength): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: 'https://example.org/synthetic/StructureDefinition/observation',
    name: 'SyntheticChildBinding', type: 'Observation', status: 'active', kind: 'resource', abstract: false,
    snapshot: { element: [
      { id: 'Observation.component', path: 'Observation.component',
        slicing: { discriminator: [{ type: 'value', path: 'code' }], rules: 'open' } },
      { id: 'Observation.component:general', path: 'Observation.component', sliceName: 'general', min: 1, max: '*' },
      { id: 'Observation.component:general.code', path: 'Observation.component.code',
        binding: syntheticBinding(strength) },
      { id: 'Observation.component:loinc', path: 'Observation.component', sliceName: 'loinc', min: 1, max: '1' },
      { id: 'Observation.component:loinc.code', path: 'Observation.component.code',
        patternCodeableConcept: { coding: [{ system: 'http://loinc.org', code: '57016-8' }] } },
    ] },
  };
}

describe('terminology binding strength as slice identity', () => {
  it.each(NON_IDENTIFYING_STRENGTHS)('does not let a %s root binding steal an explicit Consent pattern', async strength => {
    const loadValueSet = vi.fn(async () => ['http://loinc.org|57016-8']);
    const issues = await new SlicingValidator({ valueSetLoader: { loadValueSet } }).validateSlicing([
      category('http://loinc.org', '57016-8'), category(MII_SYSTEM, 'module'),
    ], 'Consent.category', consentProfile(strength));

    expect(loadValueSet).not.toHaveBeenCalled();
    expect(issues.filter(issue => issue.severity === 'error')).toEqual([0, 1].map(index => expect.objectContaining({
      code: 'profile-slice-validation-error', severity: 'error',
      path: `Consent.category[${index}]`,
      details: expect.objectContaining({ reason: 'undiscriminated-slice', sliceName: 'general' }),
    })));
    expect(issues.filter(issue => ['profile-slice-min-cardinality', 'profile-slice-max-cardinality'].includes(issue.code))).toEqual([]);
  });

  it('still reports the exact required LOINC slice when its code is absent', async () => {
    const issues = await new SlicingValidator({ valueSetLoader: { loadValueSet: async () => ['http://loinc.org|57016-8'] } })
      .validateSlicing([category('http://loinc.org', '57017-6'), category(MII_SYSTEM, 'module')],
        'Consent.category', consentProfile('extensible'));
    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toEqual([
      expect.objectContaining({ severity: 'error', details: expect.objectContaining({ sliceName: 'loinc' }) }),
    ]);
  });

  it('still enforces maximum cardinality on an explicit pattern slice', async () => {
    const issues = await new SlicingValidator({ valueSetLoader: { loadValueSet: async () => [] } }).validateSlicing([
      category('http://loinc.org', '57016-8'), category('http://loinc.org', '57016-8'), category(MII_SYSTEM, 'module'),
    ], 'Consent.category', consentProfile('extensible'));
    expect(issues.filter(issue => issue.code === 'profile-slice-max-cardinality')).toEqual([
      expect.objectContaining({ severity: 'error', details: expect.objectContaining({ sliceName: 'loinc' }) }),
    ]);
  });

  it('retains required enumerated root bindings as discriminator evidence', async () => {
    const loadValueSet = vi.fn(async () => ['https://example.org/synthetic/CodeSystem/category|general']);
    const issues = await new SlicingValidator({ valueSetLoader: { loadValueSet } }).validateSlicing([
      category('https://example.org/synthetic/CodeSystem/category', 'general'),
      category('http://loinc.org', '57016-8'), category(MII_SYSTEM, 'module'),
    ], 'Consent.category', consentProfile('required'));
    expect(loadValueSet).toHaveBeenCalledWith(CATEGORY_SET);
    expect(issues).toEqual([]);
  });

  it.each(NON_IDENTIFYING_STRENGTHS)('does not use a %s child binding for discriminator identity', async strength => {
    const loadValueSet = vi.fn(async () => ['http://loinc.org|57016-8']);
    const profile = childBindingProfile(strength);
    const extracted = await extractSlicingInfo('Observation.component', profile, null, { loadValueSet });
    expect(extracted?.slices[0].childBindingCodes).toBeUndefined();
    expect(extracted?.slices[0].childBindingValueSets).toBeUndefined();
    expect(loadValueSet).not.toHaveBeenCalled();

    const issues = await new SlicingValidator({ valueSetLoader: { loadValueSet } }).validateSlicing([
      { code: category('http://loinc.org', '57016-8') },
    ], 'Observation.component', profile);
    expect(extracted?.slices[0].undiscriminated).toBe(true);
    expect(issues.filter(issue => issue.severity === 'error')).toEqual([expect.objectContaining({
      code: 'profile-slice-validation-error', severity: 'error', path: 'Observation.component[0]',
      details: expect.objectContaining({ reason: 'undiscriminated-slice', sliceName: 'general' }),
    })]);
    expect(issues.filter(issue => ['profile-slice-min-cardinality', 'profile-slice-max-cardinality'].includes(issue.code))).toEqual([]);
  });

  it('retains required child binding evidence and detects a missing matching child slice', async () => {
    const loadValueSet = vi.fn(async () => ['https://example.org/synthetic/CodeSystem/category|general']);
    const profile = childBindingProfile('required');
    const extracted = await extractSlicingInfo('Observation.component', profile, null, { loadValueSet });
    expect(extracted?.slices[0].childBindingCodes?.get('code')).toEqual(new Set([
      'https://example.org/synthetic/CodeSystem/category|general',
    ]));
    const issues = await new SlicingValidator({ valueSetLoader: { loadValueSet } }).validateSlicing([
      { code: category('http://loinc.org', '57016-8') },
    ], 'Observation.component', profile);
    expect(issues.filter(issue => issue.code === 'profile-slice-min-cardinality')).toEqual([
      expect.objectContaining({ severity: 'error', details: expect.objectContaining({ sliceName: 'general' }) }),
    ]);
  });
});
