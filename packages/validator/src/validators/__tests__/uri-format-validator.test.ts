import { describe, expect, it } from 'vitest';
import { validateUriFormat } from '../uri-format-validator';

describe('validateUriFormat', () => {
  it('suggests urn:oid for bare OID values', () => {
    const issue = validateUriFormat(
      '2.16.840.1.113883.6.88',
      'Observation.code.coding[0].system',
      'Observation',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      details: expect.objectContaining({
        value: '2.16.840.1.113883.6.88',
        suggestedUri: 'urn:oid:2.16.840.1.113883.6.88',
        fixHint: expect.stringContaining('urn:oid:2.16.840.1.113883.6.88'),
      }),
    }));
  });

  it('suggests an https URI for www-prefixed values without a scheme', () => {
    const issue = validateUriFormat(
      'www.uwearme.com/measures',
      'Observation.code.coding[0].system',
      'Observation',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      details: expect.objectContaining({
        value: 'www.uwearme.com/measures',
        suggestedUri: 'https://www.uwearme.com/measures',
        fixHint: expect.stringContaining('https://www.uwearme.com/measures'),
      }),
    }));
  });

  it('keeps generic absolute URI guidance when there is no safe direct rewrite', () => {
    const issue = validateUriFormat(
      'any_data_to_fhir/tags',
      'Observation.meta.tag[0].system',
      'Observation',
    );

    expect(issue).toEqual(expect.objectContaining({
      code: 'structural-invalid-uri',
      details: expect.objectContaining({
        value: 'any_data_to_fhir/tags',
        fixHint: expect.stringContaining('absolute URI'),
      }),
    }));
    expect(issue?.details).not.toHaveProperty('suggestedUri');
  });
});
