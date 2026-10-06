import { describe, expect, it } from 'vitest';
import { checkUriIdentifierValue } from '../identifier-uri-value-rule';

describe('checkUriIdentifierValue', () => {
  it.each(['2.16.840.1.113883.19.5', 'c757873d-ec9a-4326-a141-556f43239520', 'file:x'])(
    'rejects %s as the value of a urn:ietf:rfc:3986 identifier',
    (value) => {
      expect(checkUriIdentifierValue({ system: 'urn:ietf:rfc:3986', value }, 'Organization.identifier[0]'))
        .toMatchObject({ code: 'identifier-uri-value-not-absolute', severity: 'error', path: 'Organization.identifier[0].value' });
    },
  );

  it.each(['urn:oid:2.16.840.1.113883.19.5', 'urn:uuid:c757873d-ec9a-4326-a141-556f43239520', 'https://example.org/id/1', 'file:///tmp/x'])(
    'accepts %s',
    (value) => {
      expect(checkUriIdentifierValue({ system: 'urn:ietf:rfc:3986', value }, 'Organization.identifier[0]')).toBeNull();
    },
  );

  it('leaves identifiers of other systems alone', () => {
    expect(checkUriIdentifierValue({ system: 'http://example.org/mrn', value: '12345' }, 'Patient.identifier[0]')).toBeNull();
  });
});
