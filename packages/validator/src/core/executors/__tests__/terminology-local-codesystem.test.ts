import { beforeEach, describe, expect, it } from 'vitest';
import { TerminologyExecutor } from '../terminology-executor';
import { getValueAtPath } from '../../validation-utils';
import { ValueSetCache } from '../../../validators/valueset-cache';
import type { StructureDefinition } from '../../structure-definition-types';

const valueSetCache = new ValueSetCache();

describe('TerminologyExecutor local CodeSystem validation', () => {
  beforeEach(() => {
    valueSetCache.clear();
    valueSetCache.setCodeSystem('http://terminology.hl7.org/CodeSystem/benefit-type', {
      resourceType: 'CodeSystem',
      url: 'http://terminology.hl7.org/CodeSystem/benefit-type',
      content: 'complete',
      concept: [
        { code: 'copay', display: 'Copayment per service' },
        { code: 'deductible', display: 'Deductible' },
      ],
    });
  });

  it('validates CodeableConcept codings from local CodeSystems with concrete array paths', async () => {
    const resource = {
      resourceType: 'CoverageEligibilityResponse',
      insurance: [{
        item: [{
          benefit: [
            {
              type: {
                coding: [{
                  system: 'http://terminology.hl7.org/CodeSystem/benefit-type',
                  code: 'copay',
                  display: 'Copay',
                }],
              },
            },
            {
              type: {
                coding: [{
                  system: 'http://terminology.hl7.org/CodeSystem/benefit-type',
                  code: 'coinsurance',
                  display: 'Coinsurance',
                }],
              },
            },
          ],
        }],
      }],
    };
    const structureDef = {
      url: 'http://hl7.org/fhir/StructureDefinition/CoverageEligibilityResponse',
      type: 'CoverageEligibilityResponse',
      snapshot: {
        element: [{
          id: 'CoverageEligibilityResponse.insurance.item.benefit.type',
          path: 'CoverageEligibilityResponse.insurance.item.benefit.type',
          type: [{ code: 'CodeableConcept' }],
        }],
      },
    } as StructureDefinition;

    const issues = await new TerminologyExecutor(undefined, valueSetCache).validate({
      resource,
      structureDef,
      getValueAtPath,
      fhirVersion: 'R4',
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'terminology-display-mismatch',
        severity: 'error',
        path: 'CoverageEligibilityResponse.insurance[0].item[0].benefit[0].type.coding[0].display',
      }),
      expect.objectContaining({
        code: 'terminology-code-invalid',
        path: 'CoverageEligibilityResponse.insurance[0].item[0].benefit[1].type.coding[0].code',
      }),
    ]));
  });
});
