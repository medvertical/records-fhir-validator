import { describe, expect, it, vi } from 'vitest';

import type {
  ElementDefinition,
  StructureDefinition,
} from '../../core/structure-definition-types';
import { extractSlicingInfo } from '../slice-info-extractor';
import { buildUndiscriminatedSliceIssues } from '../slicing-undiscriminated-slices';

const PROFILE_URL = 'https://example.test/StructureDefinition/Consent';
const CATEGORY_VALUE_SET = 'http://hl7.org/fhir/ValueSet/consent-category';
const LOINC_PRIVACY_POLICY = 'http://loinc.org|57016-8';

function consentProfile(categorySlices: unknown[]): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    id: 'consent',
    url: PROFILE_URL,
    name: 'Consent',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Consent',
    snapshot: {
      element: [
        {
          id: 'Consent.category',
          path: 'Consent.category',
          slicing: { discriminator: [{ type: 'pattern', path: '$this' }], rules: 'open' },
        },
        ...categorySlices,
      ] as ElementDefinition[],
    },
  };
}

const loader = { loadValueSet: vi.fn().mockResolvedValue([LOINC_PRIVACY_POLICY]) };

describe('slices without a discriminating value', () => {
  it('does not let an extensible binding claim elements, as the reference validator does not', async () => {
    const result = await extractSlicingInfo('Consent.category', consentProfile([
      {
        id: 'Consent.category:consentCategory',
        path: 'Consent.category',
        sliceName: 'consentCategory',
        min: 1,
        binding: { strength: 'extensible', valueSet: CATEGORY_VALUE_SET },
      },
      {
        id: 'Consent.category:loinc',
        path: 'Consent.category',
        sliceName: 'loinc',
        min: 1,
        patternCodeableConcept: { coding: [{ system: 'http://loinc.org', code: '57016-8' }] },
      },
    ]), null, loader);

    const [consentCategory, loinc] = result?.slices ?? [];
    expect(consentCategory.bindingCodes).toBeUndefined();
    expect(consentCategory.undiscriminated).toBe(true);
    expect(loinc.undiscriminated).toBeUndefined();
  });

  it('keeps a required binding as the discriminator of a slice without a pattern', async () => {
    const result = await extractSlicingInfo('Consent.category', consentProfile([{
      id: 'Consent.category:resultType',
      path: 'Consent.category',
      sliceName: 'resultType',
      binding: { strength: 'required', valueSet: CATEGORY_VALUE_SET },
    }]), null, loader);

    expect(result?.slices[0].bindingCodes).toEqual(new Set([LOINC_PRIVACY_POLICY]));
    expect(result?.slices[0].undiscriminated).toBeUndefined();
  });

  it('reports each element it cannot slice, once per undiscriminated slice', async () => {
    const result = await extractSlicingInfo('Consent.category', consentProfile([
      {
        id: 'Consent.category:consentCategory',
        path: 'Consent.category',
        sliceName: 'consentCategory',
        binding: { strength: 'extensible', valueSet: CATEGORY_VALUE_SET },
      },
      {
        // The pattern sits on the child Coding only, which a `$this`
        // discriminator does not look at.
        id: 'Consent.category:sct',
        path: 'Consent.category',
        sliceName: 'sct',
      },
      {
        id: 'Consent.category:sct.coding',
        path: 'Consent.category.coding',
        patternCoding: { system: 'http://snomed.info/sct', code: '248326004' },
      },
    ]), null, loader);

    const issues = buildUndiscriminatedSliceIssues(
      [{ text: 'first' }, { text: 'second' }],
      result?.slices ?? [],
      'Consent.category',
      PROFILE_URL,
    );

    expect(issues.map(issue => [issue.path, issue.severity, issue.details?.sliceName])).toEqual([
      ['Consent.category[0]', 'error', 'consentCategory'],
      ['Consent.category[0]', 'error', 'sct'],
      ['Consent.category[1]', 'error', 'consentCategory'],
      ['Consent.category[1]', 'error', 'sct'],
    ]);
    expect(issues[0].message).toContain('Slicing cannot be evaluated');
  });

  it.each(['fixedUri', 'patternUri', 'required-binding', 'unresolved-profile', 'missing-child', 'unconstrained-child'])(
    'distinguishes child discriminator evidence: %s', async kind => {
      const profile = consentProfile([{
        id: 'Consent.category:system', path: 'Consent.category', sliceName: 'system',
        ...(kind === 'unresolved-profile' ? { type: [{ code: 'Coding', profile: ['https://example.test/missing'] }] } : {}),
      }, ...(kind === 'missing-child' ? [] : [{
        id: 'Consent.category:system.system', path: 'Consent.category.system',
        ...(kind === 'fixedUri' || kind === 'patternUri' ? { [kind]: 'http://loinc.org' } : {}),
        ...(kind === 'required-binding' ? { binding: { strength: 'required', valueSet: CATEGORY_VALUE_SET } } : {}),
      }])]);
      profile.snapshot!.element![0].slicing!.discriminator = [{ type: 'value', path: 'system' }];
      const result = await extractSlicingInfo('Consent.category', profile, null, null);
      expect(Boolean(result?.slices[0].undiscriminated)).toBe(kind === 'unconstrained-child');
    },
  );

});
