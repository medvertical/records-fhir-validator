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

  it('validates MIME type required bindings by BCP13 code syntax', async () => {
    const validator = new ValueSetValidator();
    localOnly(validator);

    await expect(validator.validateBinding(
      'application/fhir+json',
      { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/mimetypes|5.0.0' },
      'TestScript.setup.action.operation.accept',
    )).resolves.toHaveLength(0);

    await expect(validator.validateBinding(
      'application/xml',
      { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/mimetypes|5.0.0' },
      'TestScript.setup.action.operation.contentType',
    )).resolves.toHaveLength(0);
  });

  it('accepts Attachment content types the way the reference terminology server does', async () => {
    const validator = new ValueSetValidator();
    localOnly(validator);
    const binding = { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/mimetypes|4.0.1' } as const;
    const path = 'DocumentReference.content[0].attachment.contentType';

    // tx.fhir.org checks type and subtype only and leaves parameters unparsed.
    for (const accepted of ['text/plain; charset=utf-8', 'application/xml;charset=utf-8', 'text/plain;base64', 'text/plain; charset']) {
      await expect(validator.validateBinding(accepted, binding, path), accepted).resolves.toHaveLength(0);
    }
    for (const rejected of ['text/', 'a/b/c', 'textplain', 'text/;charset=utf-8']) {
      const issues = await validator.validateBinding(rejected, binding, path);
      expect(issues[0], rejected).toEqual(expect.objectContaining({ code: 'terminology-binding-required-code', path }));
    }
  });

  it('flags TestScript MIME shorthand codes that are not BCP13 media types', async () => {
    const validator = new ValueSetValidator();
    localOnly(validator);

    const jsonIssues = await validator.validateBinding(
      'json',
      { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/mimetypes|5.0.0' },
      'TestScript.test[0].action[0].operation.accept',
    );
    const noneIssues = await validator.validateBinding(
      'none',
      { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/mimetypes|5.0.0' },
      'TestScript.test[0].action[0].operation.contentType',
    );

    expect(jsonIssues[0]).toEqual(expect.objectContaining({
      code: 'terminology-binding-required-code',
      path: 'TestScript.test[0].action[0].operation.accept',
    }));
    expect(noneIssues[0]).toEqual(expect.objectContaining({
      code: 'terminology-binding-required-code',
      path: 'TestScript.test[0].action[0].operation.contentType',
    }));
  });

  it('accepts simple FHIR format codes only on elements that explicitly allow them', async () => {
    const validator = new ValueSetValidator();
    localOnly(validator);

    await expect(validator.validateBinding(
      'json',
      { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/mimetypes|4.0.1' },
      'CapabilityStatement.format[0]',
    )).resolves.toHaveLength(0);

    await expect(validator.validateBinding(
      'ttl',
      { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/mimetypes|4.0.1' },
      'Signature.targetFormat',
    )).resolves.toHaveLength(0);

    const issues = await validator.validateBinding(
      'json',
      { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/mimetypes|4.0.1' },
      'Attachment.contentType',
    );
    expect(issues[0]).toEqual(expect.objectContaining({
      code: 'terminology-binding-required-code',
      path: 'Attachment.contentType',
    }));
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
