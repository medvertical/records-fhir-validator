import { describe, expect, it, vi } from 'vitest';
import { ProfileExecutor } from '../profile-executor';
import type { ElementDefinition, StructureDefinition } from '../../structure-definition-types';
import { getValueAtPath } from '../../validation-utils';

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

// KBV's Mutterpass requires a German display name on every finding's coding,
// an extension the coding's primitive display carries in its `_display`.
const GERMAN_DISPLAY = 'https://fhir.kbv.de/StructureDefinition/KBV_EX_Base_Terminology_German';
const finding = (german: string) => ({
  itemCodeableConcept: { coding: [{
    system: 'http://snomed.info/sct',
    code: '416413003',
    display: 'Advanced maternal age gravida (finding)',
    _display: { extension: [{ url: GERMAN_DISPLAY, extension: [{ url: 'content', valueString: german }] }] },
  }] },
});

describe('slicing below a primitive of a repeating element', () => {
  it('slices the extensions each primitive carries in its sidecar', async () => {
    const { ExtensionValidator } = await import('../../../validators/extension-validator');
    const { SlicingValidator } = await import('../../../validators/slicing-validator');
    const { ConstraintValidator } = await import('../../../validators/constraint-validator');
    const slicingValidator = new SlicingValidator();
    const validateSlicing = vi.fn().mockResolvedValue([]);
    slicingValidator.validateSlicing = validateSlicing;
    const executor = new ProfileExecutor(new ExtensionValidator(), slicingValidator, new ConstraintValidator());
    const element = (path: string, max: string, extra: Partial<ElementDefinition> = {}) =>
      ({ id: path, path, min: 0, max, ...extra }) as ElementDefinition;
    const structureDef = {
      url: 'https://fhir.kbv.de/StructureDefinition/KBV_PR_MIO_MR_ClinicalImpression_Pregnancy_Examination_Discharge_Summary',
      type: 'ClinicalImpression',
      snapshot: { element: [
        element('ClinicalImpression', '*'),
        element('ClinicalImpression.finding', '*'),
        element('ClinicalImpression.finding.itemCodeableConcept', '1'),
        element('ClinicalImpression.finding.itemCodeableConcept.coding', '1'),
        element('ClinicalImpression.finding.itemCodeableConcept.coding.display', '1'),
        element('ClinicalImpression.finding.itemCodeableConcept.coding.display.extension', '*', {
          slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'closed' },
        }),
      ] },
    } as unknown as StructureDefinition;
    const resource = { resourceType: 'ClinicalImpression', finding: [finding('Schwangere über 35 Jahren'), finding('Mehrlingsschwangerschaft')] };

    await executor.validate({
      resource,
      resourceType: 'ClinicalImpression',
      profileUrl: structureDef.url,
      fhirVersion: 'R4',
      structureDef,
      strictMode: false,
      getValueAtPath,
    });

    const sliced = validateSlicing.mock.calls.map(call => call[0]);
    expect(sliced).toEqual([
      resource.finding[0].itemCodeableConcept.coding[0]._display.extension,
      resource.finding[1].itemCodeableConcept.coding[0]._display.extension,
    ]);
  });
});
