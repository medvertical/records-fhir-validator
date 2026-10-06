import { describe, expect, it } from 'vitest';
import { resolveFhirSegmentElement, resolveFhirSegmentValue } from '../../core/fhir-primitive-sidecar';
import { typeCodeMatchesValue } from '../slice-type-discriminator';
import { inferType } from '../slice-value-type';

describe('the type of a choice value found below repeating parents', () => {
  // Da Vinci PCT slices ExplanationOfBenefit.benefitBalance.financial.allowed[x]
  // by type; a Money carries no shape of its own to tell it by.
  it('is the one its property names, on the caller\'s own object', () => {
    const financial = { allowedMoney: { value: 1, currency: 'USD' }, usedUnsignedInt: 2 };
    const allowed = resolveFhirSegmentValue(financial, 'allowed[x]');

    expect(allowed).toBe(financial.allowedMoney);
    expect(inferType(allowed)).toBe('Money');
    expect(typeCodeMatchesValue('Money', inferType(allowed), allowed)).toBe(true);
    expect(typeCodeMatchesValue('string', inferType(allowed), allowed)).toBe(false);
    expect(inferType(resolveFhirSegmentValue(financial, 'used[x]'))).toBe('integer');
  });

  // KBV's Impfpass slices doseNumber[x] by type and requires a
  // data-absent-reason on doseNumberString, carried beside the value.
  it('is read with the primitive\'s sidecar where the element\'s children come next', () => {
    const extension = [{ url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason', valueCode: 'unknown' }];
    const applied = { doseNumberString: 'unknown', _doseNumberString: { extension } };
    const node = resolveFhirSegmentElement(applied, 'doseNumber[x]');

    expect(resolveFhirSegmentValue(node, 'extension')).toEqual(extension);
    expect(inferType(node)).toBe('string');
    expect(resolveFhirSegmentElement({ doseNumberString: 'unknown' }, 'doseNumber[x]')).toBe('unknown');
  });
});

