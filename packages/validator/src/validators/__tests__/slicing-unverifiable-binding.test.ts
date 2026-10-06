import { describe, expect, it, vi } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types';
import { SlicingValidator } from '../slicing-validator';

const clockProfile = {
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/uv/phd/StructureDefinition/PhdCoincidentTimeStampObservation',
  name: 'PhdCoincidentTimeStampObservation',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Observation',
  snapshot: {
    element: [
      {
        id: 'Observation.code.coding',
        path: 'Observation.code.coding',
        min: 1,
        max: '*',
        slicing: { discriminator: [{ type: 'value', path: '$this' }], rules: 'open' },
      },
      {
        id: 'Observation.code.coding:MDCType',
        path: 'Observation.code.coding',
        sliceName: 'MDCType',
        min: 1,
        max: '1',
        type: [{ code: 'Coding' }],
        binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/uv/phd/ValueSet/MDCClockTypes' },
      },
    ],
  },
} as unknown as StructureDefinition;

describe('SlicingValidator binding slices without a local expansion', () => {
  const validator = new SlicingValidator({ valueSetLoader: { loadValueSet: vi.fn(async () => null) } });

  it('does not claim a missing slice it cannot evaluate, as the reference validator does offline', async () => {
    const issues = await validator.validateSlicing(
      [{ system: 'urn:iso:std:iso:11073:10101', code: '68225' }],
      'Observation.code.coding',
      clockProfile,
    );

    expect(issues.filter(issue => issue.severity === 'error')).toEqual([]);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-slice-validation-incomplete', severity: 'information' }));
  });

  it('still reports the required slice when nothing is present', async () => {
    const issues = await validator.validateSlicing([], 'Observation.code.coding', clockProfile);

    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-slice-min-cardinality' }));
  });
});
