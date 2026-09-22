import { describe, expect, it } from 'vitest';
import { hasInvalidSnomedCheckDigit } from '../snomed-id-validator';
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
