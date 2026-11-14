import { describe, expect, it } from 'vitest';
import { hasInvalidSnomedCheckDigit, invalidSnomedCodingIdentifierReason } from '../snomed-id-validator';
import { validateCodingHygiene } from '../../core/executors/terminology-coding-hygiene-rules';

describe('SNOMED identifier check digits', () => {
  it.each(['100005', '322236009', '161765003', '429740004', '35901911000001104'])(
    'accepts the check digit of %s', code => {
      expect(hasInvalidSnomedCheckDigit(code)).toBe(false);
    },
  );

  it.each(['161511005', '161512003'])(
    'rejects %s locally even without an authoritative terminology edition', code => {
      const issues = validateCodingHygiene({
        resourceType: 'Condition', code: { coding: [{ system: 'http://snomed.info/sct', code }] },
      }, []);
      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'error', code: 'terminology-code-invalid',
        path: 'Condition.code.coding[0].code',
        details: expect.objectContaining({ reason: 'snomed-check-digit' }),
      }));
      expect(issues[0].details).not.toHaveProperty('suggestedCode');
    },
  );

  it('does not interpret a post-coordinated expression as a numeric SCTID', () => {
    expect(validateCodingHygiene({ resourceType: 'Condition', code: { coding: [{
      system: 'http://snomed.info/sct', code: '128045006:{363698007=56459004}',
    }] } }, [])).toEqual([]);
  });

  it('does not impose SNOMED check digits on another code system', () => {
    expect(validateCodingHygiene({ resourceType: 'Condition', code: { coding: [{
      system: 'https://example.test/codes', code: '161511005',
    }] } }, [])).toEqual([]);
  });
});

describe('SNOMED identifier component partitions', () => {
  // Examples from the SNOMED CT Release File Specification §6.8.
  it.each(['100005', '1290023401004', '11000001102', '10989121108', '999999990989121104'])(
    'does not reject a well-formed concept identifier %s', code => {
      expect(invalidSnomedCodingIdentifierReason(code)).toBeUndefined();
    },
  );

  it.each(['100014', '100022', '1290023401015', '9940000001029', '1290000001117', '9940000001126'])(
    'rejects a description or relationship identifier %s in Coding.code', code => {
      expect(hasInvalidSnomedCheckDigit(code)).toBe(false);
      const issues = validateCodingHygiene({ resourceType: 'Observation', code: { coding: [{
        system: 'http://snomed.info/sct', code,
      }] } }, []);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        code: 'terminology-code-invalid', severity: 'error', path: 'Observation.code.coding[0].code',
        details: { reason: 'snomed-component-kind' },
      });
      expect(issues[0].details).not.toHaveProperty('suggestedCode');
    },
  );

  it.each(['100545', '100033', '100993'])(
    'rejects reserved partitions even with a valid checksum: %s', code => {
      expect(hasInvalidSnomedCheckDigit(code)).toBe(false);
      expect(invalidSnomedCodingIdentifierReason(code)).toBe('snomed-partition');
    },
  );

  it('does not classify the assigned postcoordinated-expression partition as reserved', () => {
    expect(hasInvalidSnomedCheckDigit('11000001160')).toBe(false);
    expect(invalidSnomedCodingIdentifierReason('11000001160')).toBeUndefined();
  });

  it('reports one primary identifier defect when both the partition and check digit are invalid', () => {
    const issues = validateCodingHygiene({ resourceType: 'Observation', code: { coding: [{
      system: 'http://snomed.info/sct', code: '100540',
    }] } }, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].details).toMatchObject({ reason: 'snomed-check-digit' });
  });

  it('does not treat the description-id extension value as a concept coding', () => {
    expect(validateCodingHygiene({ resourceType: 'Observation', code: { coding: [{
      system: 'http://snomed.info/sct', code: '100005',
      extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/coding-sctdescid', valueId: '100014' }],
    }] } }, [])).toEqual([]);
  });
});
