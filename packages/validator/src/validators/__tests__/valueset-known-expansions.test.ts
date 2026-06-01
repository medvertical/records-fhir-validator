import { describe, expect, it } from 'vitest';
import { ValueSetValidator } from '../valueset-validator';
import { KNOWN_VALUE_SET_EXPANSIONS } from '../valueset-known-expansions';

// gap P-3 step a: newly bundled required-binding ValueSets validate locally
// (no terminology server), without producing false positives.

const localOnly = (v: ValueSetValidator) => v.setResolutionConfig({
  strategy: 'local-only',
  serverUrl: undefined,
  serverDelegation: {
    expandValueSets: false,
    validateCodes: false,
    cacheResults: false,
    cacheTTLSeconds: 0,
  },
});

describe('bundled required-binding ValueSet expansions (P-3a)', () => {
  it('accepts a valid code from a newly bundled ValueSet without a tx server', async () => {
    const validator = new ValueSetValidator();
    localOnly(validator);
    const issues = await validator.validateBinding(
      { system: 'http://hl7.org/fhir/publication-status', code: 'active' },
      { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/publication-status' },
      'StructureDefinition.status',
    );
    expect(issues).toHaveLength(0);
  });

  it('flags an invalid code against a locally-expandable required binding', async () => {
    const validator = new ValueSetValidator();
    localOnly(validator);
    const issues = await validator.validateBinding(
      { system: 'http://hl7.org/fhir/publication-status', code: 'bogus-status' },
      { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/publication-status' },
      'StructureDefinition.status',
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it('keeps every bundled expansion version-stable (system|code + bare code forms)', () => {
    for (const [url, codes] of Object.entries(KNOWN_VALUE_SET_EXPANSIONS)) {
      expect(codes.length, url).toBeGreaterThan(0);
      // Each entry mixes fully-qualified `system|code` and bare `code` forms.
      expect(codes.some(c => c.includes('|')), url).toBe(true);
      expect(codes.some(c => !c.includes('|')), url).toBe(true);
    }
  });
});
