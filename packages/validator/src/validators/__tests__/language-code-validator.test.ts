import { describe, expect, it } from 'vitest';
import { parseLanguageTag, validateResourceLanguage } from '../language-code-validator';

describe('parseLanguageTag (RFC 5646 with the IANA registry)', () => {
  it.each(['en', 'de', 'de-CH', 'en-US', 'en-AU', 'zh-Hans', 'sga', 'sr-Latn-RS',
    'EN', 'de-de', 'i-klingon', 'I-AMI', 'en-GB-oed', 'x-private', 'X-A-12345678',
    'de-DE-x-goethe', 'en-x-x', 'qaa-Qaaa-QM', 'qtz-Qabx-XZ', 'no-QQ',
    'sl-rozaj-biske-1994', 'en-u-ca-gregory', 'en-t-de-DE-u-ca-gregory', 'zh-cmn-Hans-CN',
    'sgn-ase', 'de-1901-1996', 'en-a-foobar', 'en-001', 'und', 'mul', 'zxx'])(
    'accepts the registered tag %s',
    tag => {
      expect(parseLanguageTag(tag)).toBeNull();
    },
  );

  it.each([
    ['zz', 'unregistered primary subtag'],
    ['zz-INVALID', 'unregistered primary subtag with region-ish rest'],
    ['not a lang!', 'free text'],
  ])('rejects %s on the primary subtag (%s)', tag => {
    expect(parseLanguageTag(tag)).not.toBeNull();
  });

  it.each([
    ['de-AB', 'unknown region'],
    ['en-US-INVALID', 'unknown variant'],
    ['en-xyz', 'x is a whole private-use singleton, not a prefix'],
    ['en-cmn', 'extlang has a different registered prefix'],
    ['en-123456789', 'subtag too long'],
    ['en-u', 'extension has no subtags'],
    ['en-u-a', 'extension subtag is too short'],
    ['en-u-ca-gregory-U-nu-latn', 'duplicate singleton ignoring case'],
    ['sl-rozaj-ROZAJ', 'duplicate variant ignoring case'],
    ['en-x', 'private-use sequence has no subtags'],
    ['x', 'private-use-only tag has no subtags'],
    ['en--US', 'empty subtag'],
    ['en-US-Latn', 'script occurs after region'],
    ['en_US', 'separator is not a hyphen'],
    ['en-12345678-', 'trailing separator'],
    ['en-İS', 'non-ASCII letter'],
    ['en-x-K', 'Unicode case folding must not turn a non-ASCII letter into a subtag'],
    ['qzz', 'outside the private-use language range'],
    ['en-Qaby', 'outside the private-use script range'],
  ])('rejects %s on a later part (%s)', tag => {
    expect(parseLanguageTag(tag)).not.toBeNull();
  });
});

describe('validateResourceLanguage', () => {
  it('warns on an invalid Resource.language', () => {
    const issues = validateResourceLanguage(
      { resourceType: 'Patient', language: 'zz-INVALID' },
      'Patient',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'language-code-invalid',
      severity: 'warning',
      path: 'Patient.language',
    });
  });

  it('accepts a valid Resource.language', () => {
    expect(validateResourceLanguage({ resourceType: 'Patient', language: 'de-CH' }, 'Patient'))
      .toHaveLength(0);
  });

  it('ignores resources without a language', () => {
    expect(validateResourceLanguage({ resourceType: 'Patient' }, 'Patient')).toHaveLength(0);
    expect(validateResourceLanguage({ resourceType: 'Patient', language: '' }, 'Patient'))
      .toHaveLength(0);
  });

  it('never looks at nested language properties like Expression.language', () => {
    const resource = {
      resourceType: 'Measure',
      library: [{ language: 'text/cql' }],
    };
    expect(validateResourceLanguage(resource, 'Measure')).toHaveLength(0);
  });
});
