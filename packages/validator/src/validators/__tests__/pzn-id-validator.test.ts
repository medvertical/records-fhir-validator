import { describe, expect, it } from 'vitest';
import { hasInvalidPznCheckDigit } from '../pzn-id-validator';
import { validateCodingHygiene } from '../../core/executors/terminology-coding-hygiene-rules';

const system = 'http://fhir.de/CodeSystem/ifa/pzn';
const medication = (code: string) => ({ resourceType: 'Medication', code: { coding: [{ system, code }] } });

describe('German PZN check digits', () => {
  // IFA's published PZN and PPN calculation examples, including a leading zero.
  it.each(['27580899', '03752864', '3752864'])(
    'does not reject %s or treat its checksum as catalog membership', code => {
      expect(hasInvalidPznCheckDigit(code)).toBe(false);
      expect(validateCodingHygiene(medication(code), [])).toEqual([]);
    },
  );

  it.each(['27580898', '03752865', '3752865', '28580899', '10000060'])(
    'rejects invalid PZN %s without suggesting a different product', code => {
      const issues = validateCodingHygiene(medication(code), []);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        code: 'terminology-code-invalid', severity: 'error', path: 'Medication.code.coding[0].code',
        details: { system, code, reason: 'pzn-check-digit' },
      });
      expect(issues[0].details).not.toHaveProperty('suggestedCode');
    },
  );

  it.each(['110375286414', '375286', '027580899', 'PZN27580899', '2758089A'])(
    'leaves %s outside the numeric PZN check-digit scope', code => {
      expect(hasInvalidPznCheckDigit(code)).toBe(false);
    },
  );

  it('does not apply German PZN weights to another namespace or an Identifier.value', () => {
    expect(validateCodingHygiene({
      resourceType: 'Medication',
      identifier: [{ system, value: '27580898' }],
      code: { coding: [{ system: 'https://example.test/other-product-codes', code: '27580898' }] },
    }, [])).toEqual([]);
  });

  it('supports a PZN in a Coding-valued extension', () => {
    const issues = validateCodingHygiene({ resourceType: 'Medication', extension: [{
      url: 'https://example.test/product', valueCoding: { system, code: '27580898' },
    }] }, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('Medication.extension[0].valueCoding.code');
  });

  it('checks Coding arrays whose field name is code rather than coding', () => {
    const issues = validateCodingHygiene({ resourceType: 'Questionnaire', item: [{
      linkId: 'product', type: 'choice', code: [{ system, code: '27580898' }],
    }] }, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('Questionnaire.item[0].code[0].code');
  });

  it('leaves Bundle entry resources to their own validation pass', () => {
    const resource = medication('27580898');
    expect(validateCodingHygiene({ resourceType: 'Bundle', entry: [{ resource }] }, [])).toEqual([]);
    expect(validateCodingHygiene(resource, [])).toHaveLength(1);
  });

  it('does not duplicate an invalid-code issue already produced for the same field', () => {
    const resource = medication('27580898');
    const existing = validateCodingHygiene(resource, []);
    expect(validateCodingHygiene(resource, existing)).toEqual([]);
  });
});
