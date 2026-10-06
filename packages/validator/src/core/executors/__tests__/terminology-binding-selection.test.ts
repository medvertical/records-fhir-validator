import { describe, expect, it } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../structure-definition-types';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { applyValueSetSliceMembershipPolicy, selectSliceScopedValues } from '../terminology-binding-selection';
import { TerminologySlicePlanCache } from '../terminology-slice-plan-cache';

// Mirrors us-core Condition.category: sibling slices told apart only by
// their required bindings ("slicing by value sets"), slicing rules open.
function buildValueSetSlicedProfile(): {
  structureDef: StructureDefinition;
  sliceElement: ElementDefinition;
} {
  const sliceElement: ElementDefinition = {
    id: 'Condition.category:us-core',
    path: 'Condition.category',
    sliceName: 'us-core',
    min: 1,
    binding: {
      strength: 'required',
      valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-problem-or-health-concern',
    },
  };
  const structureDef = {
    resourceType: 'StructureDefinition',
    snapshot: {
      element: [
        sliceElement,
        {
          id: 'Condition.category:screening-assessment',
          path: 'Condition.category',
          sliceName: 'screening-assessment',
          binding: {
            strength: 'required',
            valueSet: 'http://hl7.org/fhir/us/core/ValueSet/us-core-screening-assessment-condition-category',
          },
        },
      ],
    },
  } as StructureDefinition;
  return { structureDef, sliceElement };
}

function membershipViolation(path: string): ValidationIssue {
  return {
    id: `issue-${path}`,
    aspect: 'terminology',
    severity: 'error',
    code: 'terminology-binding-required',
    message: 'not in value set',
    path,
    timestamp: new Date(),
  } as ValidationIssue;
}

describe('applyValueSetSliceMembershipPolicy', () => {
  it('drops membership violations when another repeat satisfies the slice value set', () => {
    const { structureDef, sliceElement } = buildValueSetSlicedProfile();
    const kept = applyValueSetSliceMembershipPolicy(
      sliceElement,
      structureDef,
      [[], [membershipViolation('Condition.category')]],
      new TerminologySlicePlanCache(),
    );
    expect(kept).toEqual([]);
  });

  it('keeps membership violations when no repeat satisfies the slice value set', () => {
    const { structureDef, sliceElement } = buildValueSetSlicedProfile();
    const violations = [
      [membershipViolation('Condition.category')],
      [membershipViolation('Condition.category')],
    ];
    const kept = applyValueSetSliceMembershipPolicy(
      sliceElement,
      structureDef,
      violations,
      new TerminologySlicePlanCache(),
    );
    expect(kept).toHaveLength(2);
  });

  it('leaves non-value-set-discriminated slice bindings untouched', () => {
    const sliceElement: ElementDefinition = {
      id: 'Observation.category:vital',
      path: 'Observation.category',
      sliceName: 'vital',
      min: 1,
      binding: { strength: 'required', valueSet: 'http://example.org/vs' },
    };
    const structureDef = {
      resourceType: 'StructureDefinition',
      snapshot: { element: [sliceElement] },
    } as StructureDefinition;

    const kept = applyValueSetSliceMembershipPolicy(
      sliceElement,
      structureDef,
      [[], [membershipViolation('Observation.category')]],
      new TerminologySlicePlanCache(),
    );
    expect(kept).toHaveLength(1);
  });
});

describe('selectSliceScopedValues on choice type slices', () => {
  // CARIN BB binds ExplanationOfBenefit.item.location[x]:locationCodeableConcept.
  const sliceElement: ElementDefinition = {
    id: 'ExplanationOfBenefit.item.location[x]:locationCodeableConcept',
    path: 'ExplanationOfBenefit.item.location[x]',
    sliceName: 'locationCodeableConcept',
    type: [{ code: 'CodeableConcept' }],
    binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/us/carin-bb/ValueSet/CMSPlaceofServiceCodes' },
  };
  const structureDef = {
    resourceType: 'StructureDefinition',
    snapshot: {
      element: [
        {
          id: 'ExplanationOfBenefit.item.location[x]',
          path: 'ExplanationOfBenefit.item.location[x]',
          slicing: { discriminator: [{ type: 'type', path: '$this' }], rules: 'closed' },
          type: [{ code: 'CodeableConcept' }],
        },
        sliceElement,
      ],
    },
  } as StructureDefinition;
  const location = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/ex-serviceplace', code: '12' }] };
  const getValueAtPath = (_resource: unknown, path: string) =>
    path === 'ExplanationOfBenefit.item.locationCodeableConcept' ? [location] : undefined;

  it('selects the value whose JSON key carries the slice type, where the instance holds it', () => {
    const selection = selectSliceScopedValues(
      { resourceType: 'ExplanationOfBenefit', item: [{ sequence: 1 }, { sequence: 2, locationCodeableConcept: location }] },
      sliceElement,
      structureDef,
      getValueAtPath,
      new TerminologySlicePlanCache(),
    );

    expect(selection).toEqual({
      hasMatchingSliceElements: true,
      values: [location],
      paths: ['ExplanationOfBenefit.item[1].locationCodeableConcept'],
    });
  });
});

describe('selectSliceScopedValues below a pattern slice', () => {
  // CARIN BB: adjudication:benefitpaymentstatus is told apart by its category.
  const category = { coding: [{ system: 'http://hl7.org/fhir/us/carin-bb/CodeSystem/C4BBAdjudicationDiscriminator', code: 'benefitpaymentstatus' }] };
  const slice: ElementDefinition = {
    id: 'ExplanationOfBenefit.item.adjudication:benefitpaymentstatus',
    path: 'ExplanationOfBenefit.item.adjudication',
    sliceName: 'benefitpaymentstatus',
  };
  const reason: ElementDefinition = {
    id: 'ExplanationOfBenefit.item.adjudication:benefitpaymentstatus.reason',
    path: 'ExplanationOfBenefit.item.adjudication.reason',
    binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/us/carin-bb/ValueSet/C4BBPayerBenefitPaymentStatus' },
  };
  const structureDef = {
    resourceType: 'StructureDefinition',
    snapshot: {
      element: [
        { id: 'ExplanationOfBenefit.item.adjudication', path: 'ExplanationOfBenefit.item.adjudication',
          slicing: { discriminator: [{ type: 'pattern', path: 'category' }], rules: 'open' } },
        slice,
        { id: `${slice.id}.category`, path: 'ExplanationOfBenefit.item.adjudication.category', patternCodeableConcept: category },
        reason,
      ],
    },
  } as StructureDefinition;
  const x12 = { coding: [{ system: 'https://x12.org/codes/claim-adjustment-reason-codes', code: 'other' }] };
  const resource = {
    resourceType: 'ExplanationOfBenefit',
    item: [
      { adjudication: [{ category: { coding: [{ code: 'submitted' }] } }] },
      { adjudication: [{ category: { coding: [{ code: 'paidtoprovider' }] } }, { category, reason: x12 }] },
    ],
  };
  const getValueAtPath = (_resource: unknown, path: string) =>
    path === 'ExplanationOfBenefit.item.adjudication' ? resource.item.flatMap(item => item.adjudication) : undefined;

  it('locates the bound element of each matching repeat', () => {
    const selection = selectSliceScopedValues(resource, reason, structureDef, getValueAtPath, new TerminologySlicePlanCache());

    expect(selection).toEqual({
      hasMatchingSliceElements: true,
      values: [x12],
      paths: ['ExplanationOfBenefit.item[1].adjudication[1].reason'],
    });
  });
});

describe('selectSliceScopedValues with fixed values inside a nested slice', () => {
  // KBV MIO Impfpass: code.coding is sliced by system, and each coding slice
  // fixes the URL of an extension slice on its display.
  const base = 'Observation.code.coding';
  const loinc: ElementDefinition = {
    id: `${base}:loinc`, path: base, sliceName: 'loinc',
    binding: { strength: 'required', valueSet: 'https://fhir.kbv.de/ValueSet/KBV_VS_MIO_Vaccination_Lab_ImmuneReaction_Test_Presence|1.1.0' },
  };
  const structureDef = {
    resourceType: 'StructureDefinition',
    snapshot: {
      element: [
        { id: base, path: base, slicing: { discriminator: [{ type: 'value', path: 'system' }], rules: 'closed' } },
        loinc,
        { id: `${loinc.id}.system`, path: `${base}.system`, fixedUri: 'http://loinc.org' },
        { id: `${loinc.id}.display.extension`, path: `${base}.display.extension`,
          slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' } },
        { id: `${loinc.id}.display.extension:anzeigenameCodeLoinc`, path: `${base}.display.extension`, sliceName: 'anzeigenameCodeLoinc' },
        { id: `${loinc.id}.display.extension:anzeigenameCodeLoinc.url`, path: `${base}.display.extension.url`,
          fixedUri: 'https://fhir.kbv.de/StructureDefinition/KBV_EX_Base_Terminology_German' },
      ],
    },
  } as StructureDefinition;
  const coding = { system: 'http://loinc.org', version: '2.67', code: '22600-1', display: 'Varicella zoster virus Ab' };
  const resource = { resourceType: 'Observation', code: { coding: [coding] } };
  const getValueAtPath = (_resource: unknown, path: string) => (path === base ? resource.code.coding : undefined);

  it('places a coding by its discriminator, not by what the nested slice fixes', () => {
    const selection = selectSliceScopedValues(resource, loinc, structureDef, getValueAtPath, new TerminologySlicePlanCache());

    expect(selection).toEqual({ hasMatchingSliceElements: true, values: [coding], paths: ['Observation.code.coding[0]'] });
  });
});

