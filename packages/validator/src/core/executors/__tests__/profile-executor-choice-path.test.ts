import { describe, expect, it, vi } from 'vitest';
import { ProfileExecutor, type ProfileValidationContext } from '../profile-executor';
import type { ElementDefinition, StructureDefinition } from '../../structure-definition-types';

vi.mock('../../../../validators/extension-validator', () => ({
  ExtensionValidator: vi.fn().mockImplementation(() => ({
    validateExtensions: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('../../../../validators/slicing-validator', () => ({
  SlicingValidator: vi.fn().mockImplementation(() => ({
    validateSlicing: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('../../../../validators/constraint-validator', () => ({
  ConstraintValidator: vi.fn().mockImplementation(() => ({
    validate: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('../../../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('ProfileExecutor choice path resolution', () => {
  it('does not mistake a prefix-sharing sibling for a choice value', async () => {
    const { ExtensionValidator } = await import('../../../validators/extension-validator');
    const { SlicingValidator } = await import('../../../validators/slicing-validator');
    const { ConstraintValidator } = await import('../../../validators/constraint-validator');
    const slicingValidator = new SlicingValidator();
    const validateSlicing = vi.fn().mockResolvedValue([]);
    slicingValidator.validateSlicing = validateSlicing;
    const executor = new ProfileExecutor(
      new ExtensionValidator(),
      slicingValidator,
      new ConstraintValidator(),
    );
    const coding = {
      system: 'http://fhir.de/CodeSystem/ifa/pzn',
      code: '00266040',
    };
    const structureDef: StructureDefinition = {
      id: 'medication',
      url: 'http://test.org/StructureDefinition/Medication',
      type: 'Medication',
      snapshot: {
        element: [
          {
            id: 'Medication.ingredient',
            path: 'Medication.ingredient',
            min: 0,
            max: '*',
          } as ElementDefinition,
          {
            id: 'Medication.ingredient.item[x].coding',
            path: 'Medication.ingredient.item[x].coding',
            min: 0,
            max: '*',
            slicing: {
              discriminator: [{ type: 'pattern', path: '$this' }],
              rules: 'open',
            },
          } as ElementDefinition,
        ],
      },
    };
    const context: ProfileValidationContext = {
      resource: {
        resourceType: 'Medication',
        ingredient: [
          {
            itemSet: 'not-a-choice-property',
            itemCodeableConcept: { coding: [coding] },
          },
          {
            itemSet: 'still-not-a-choice-property',
            itemCodeableConcept: {
              coding: [{ system: 'http://fhir.de/CodeSystem/ifa/pzn', code: '01126111' }],
            },
          },
        ],
      },
      resourceType: 'Medication',
      profileUrl: structureDef.url,
      fhirVersion: 'R4',
      structureDef,
      strictMode: false,
      getValueAtPath: (resource, path) => {
        const parts = path.split('.');
        let value: unknown = resource;
        for (const part of parts.slice(1)) {
          value = (value as Record<string, unknown> | undefined)?.[part];
        }
        return value;
      },
    };

    await executor.validate(context);

    expect(validateSlicing).toHaveBeenCalledWith(
      [coding],
      'Medication.ingredient.item[x].coding',
      expect.anything(),
      undefined,
      'Medication.ingredient.item[x].coding',
      'R4',
      expect.anything(),
      'Medication.ingredient[0].itemCodeableConcept.coding',
    );
  });
});
