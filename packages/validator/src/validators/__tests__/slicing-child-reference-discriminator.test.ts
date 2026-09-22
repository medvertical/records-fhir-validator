import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { SlicingValidator } from '../slicing-validator.js';
import { matchDiscriminator } from '../slice-discriminator-matcher.js';
import { referenceDiscriminatorCouldNotBeResolved } from '../slicing-match-policy.js';
import { codingMatchesBindingCodes, matchesPattern } from '../slice-utils.js';
import type { SliceDefinition } from '../slice-types.js';
import { testStructureDefinition } from './slicing-test-builders.js';

const CONDITION = 'http://hl7.org/fhir/StructureDefinition/Condition';
const OBSERVATION = 'http://hl7.org/fhir/StructureDefinition/Observation';

// Mirrors fhir-test-cases/validator/profile-slicing-type-resolve.xml: List.entry
// is sliced closed by the type of whatever `item` points at. The discriminator
// evidence sits on the child `item`, not on the slice root, and the reference
// to resolve is read at `item` rather than at the sliced element itself.
const listProfile = testStructureDefinition({
  url: 'http://hl7.org/fhir/test/StructureDefinition/profile-slicing-type-resolve',
  name: 'TestProfileTypeResolve',
  type: 'List',
  snapshot: {
    element: [
      {
        id: 'List.entry',
        path: 'List.entry',
        min: 0,
        max: '*',
        type: [{ code: 'BackboneElement' }],
        slicing: {
          discriminator: [{ type: 'type', path: 'item.resolve()' }],
          ordered: false,
          rules: 'closed',
        },
      },
      {
        id: 'List.entry:slice1',
        path: 'List.entry',
        sliceName: 'slice1',
        min: 1,
        max: '1',
        type: [{ code: 'BackboneElement' }],
      },
      {
        id: 'List.entry:slice1.item',
        path: 'List.entry.item',
        min: 1,
        max: '1',
        type: [{ code: 'Reference', targetProfile: [CONDITION] }],
      },
      {
        id: 'List.entry:slice2',
        path: 'List.entry',
        sliceName: 'slice2',
        min: 1,
        max: '3',
        type: [{ code: 'BackboneElement' }],
      },
      {
        id: 'List.entry:slice2.item',
        path: 'List.entry.item',
        min: 1,
        max: '1',
        type: [{ code: 'Reference', targetProfile: [OBSERVATION] }],
      },
    ] as any,
  },
});

const contained: Record<string, Record<string, unknown>> = {
  '#i1': { resourceType: 'Condition', id: 'i1', subject: { reference: 'Patient/example' } },
  '#i2': { resourceType: 'Observation', id: 'i2', status: 'final', code: { text: 'final' } },
  '#i3': { resourceType: 'Condition', id: 'i3', subject: { reference: 'Patient/example' } },
};
const resolveContained = (reference: string): unknown => contained[reference] ?? null;

const entry = (reference: string) => ({ item: { reference } });

function errorCodes(issues: ValidationIssue[]): string[] {
  return issues.filter(issue => issue.severity === 'error').map(issue => issue.code);
}

describe('type discriminator through a child reference (item.resolve())', () => {
  it('assigns each entry to the slice whose item targetProfile matches the resolved resource', async () => {
    const issues = await new SlicingValidator().validateSlicing(
      [entry('#i1'), entry('#i2')],
      'List.entry',
      listProfile,
      resolveContained,
    );

    expect(errorCodes(issues)).toEqual([]);
  });

  it('reports slice cardinality from the resolved targets instead of failing the closed slicing', async () => {
    const issues = await new SlicingValidator().validateSlicing(
      [entry('#i1'), entry('#i3')],
      'List.entry',
      listProfile,
      resolveContained,
    );

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-slice-max-cardinality',
      details: expect.objectContaining({ sliceName: 'slice1' }),
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-slice-min-cardinality',
      details: expect.objectContaining({ sliceName: 'slice2' }),
    }));
    expect(errorCodes(issues)).not.toContain('profile-slice-closed-unmatched');
  });

  it('withholds cardinality errors while the child reference cannot be resolved', async () => {
    const issues = await new SlicingValidator().validateSlicing(
      [entry('Condition/remote'), entry('Observation/remote')],
      'List.entry',
      listProfile,
      resolveContained,
    );

    expect(errorCodes(issues)).toEqual([]);
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'profile-slice-validation-error',
      details: expect.objectContaining({ reason: 'unresolved-reference-discriminator' }),
    }));
  });

  it('matches the discriminator against the resource the child reference resolves to', () => {
    const conditionSlice: SliceDefinition = {
      sliceName: 'slice1',
      path: 'List.entry',
      min: 1,
      max: '1',
      type: [{ code: 'BackboneElement' }],
      childTypes: new Map([['item', [{ code: 'Reference', targetProfile: [CONDITION] }]]]),
    };
    const observationSlice: SliceDefinition = {
      ...conditionSlice,
      sliceName: 'slice2',
      childTypes: new Map([['item', [{ code: 'Reference', targetProfile: [OBSERVATION] }]]]),
    };
    const discriminator = { type: 'type', path: 'item.resolve()' } as const;
    const slices = [conditionSlice, observationSlice];

    const matches = (element: unknown, slice: SliceDefinition) => matchDiscriminator(
      element, slice, discriminator, resolveContained, matchesPattern, codingMatchesBindingCodes, slices,
    );

    expect(matches(entry('#i1'), conditionSlice)).toBe(true);
    expect(matches(entry('#i1'), observationSlice)).toBe(false);
    expect(matches(entry('#i2'), observationSlice)).toBe(true);
    expect(matches(entry('#i2'), conditionSlice)).toBe(false);
  });

  it('reads the reference at the child path when deciding whether resolution failed', () => {
    const discriminator = { type: 'type', path: 'item.resolve()' } as const;

    expect(referenceDiscriminatorCouldNotBeResolved(entry('#i1'), discriminator, resolveContained)).toBe(false);
    expect(referenceDiscriminatorCouldNotBeResolved(entry('Condition/remote'), discriminator, resolveContained)).toBe(true);
  });
});
