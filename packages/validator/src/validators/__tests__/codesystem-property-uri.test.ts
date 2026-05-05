import { describe, expect, it } from 'vitest';
import { TerminologyResourceValidator } from '../terminology-resource-validator';

describe('TerminologyResourceValidator — HL7 concept-property URI allowlist', () => {
  const validator = new TerminologyResourceValidator();

  function cs(property: any[]) {
    return {
      resourceType: 'CodeSystem',
      url: 'http://example.org/cs',
      status: 'active',
      content: 'complete',
      caseSensitive: true,
      concept: [{ code: 'a', display: 'a' }],
      property,
    };
  }

  it('flags unknown URIs in the HL7 concept-properties namespace', () => {
    const issues = validator.validate(cs([
      { code: 'order', uri: 'http://hl7.org/fhir/concept-properties#order', type: 'decimal' },
    ]));
    const unknown = issues.filter(i => i.code === 'business-rule-cs-unknown-hl7-property');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].severity).toBe('error');
    expect(unknown[0].path).toBe('CodeSystem.property[0]');
    expect(unknown[0].message).toContain("Unknown CodeSystem Property 'http://hl7.org/fhir/concept-properties#order'");
    expect(unknown[0].message).toContain('do not create it in the HL7 namespace');
  });

  it('accepts the spec-listed property URIs', () => {
    const allowed = ['status', 'inactive', 'effectiveDate', 'deprecationDate', 'parent',
                     'child', 'partOf', 'synonym', 'comment', 'notSelectable'];
    for (const suffix of allowed) {
      const issues = validator.validate(cs([
        { code: suffix, uri: `http://hl7.org/fhir/concept-properties#${suffix}`, type: 'string' },
      ]));
      expect(
        issues.some(i => i.code === 'business-rule-cs-unknown-hl7-property'),
        `${suffix} should be accepted`,
      ).toBe(false);
    }
  });

  it('does not flag custom property URIs outside the HL7 namespace', () => {
    const issues = validator.validate(cs([
      { code: 'priority', uri: 'http://example.org/cs-properties#priority', type: 'integer' },
    ]));
    expect(issues.some(i => i.code === 'business-rule-cs-unknown-hl7-property')).toBe(false);
  });

  it('does not run on non-CodeSystem resources', () => {
    const issues = validator.validate({
      resourceType: 'ValueSet',
      url: 'http://example.org/vs',
      status: 'active',
    });
    expect(issues.some(i => i.code === 'business-rule-cs-unknown-hl7-property')).toBe(false);
  });
});
