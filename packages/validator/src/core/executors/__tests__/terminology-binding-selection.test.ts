import { describe, expect, it } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../structure-definition-types';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { applyValueSetSliceMembershipPolicy } from '../terminology-binding-selection';
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
