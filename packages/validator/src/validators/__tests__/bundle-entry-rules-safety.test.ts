import { describe, expect, it } from 'vitest';

import {
  bundleHasDuplicateEntryIds,
  detectDuplicateBundleEntries,
  validateBundleEntryIdConsistency,
  validateBundleFullUrls,
  validateBundleLinkRelations,
} from '../bundle-entry-rules';

describe('bundle entry rules safety', () => {
  it('ignores malformed collection shapes without throwing', () => {
    expect(validateBundleFullUrls(null, null)).toEqual([]);
    expect(validateBundleFullUrls({ entry: {} }, null)).toEqual([]);
    expect(validateBundleEntryIdConsistency({ entry: [null, 42] })).toEqual([]);
    expect(validateBundleLinkRelations({ link: [null, { relation: Symbol('next') }] })).toEqual([]);
    expect(detectDuplicateBundleEntries({ entry: [null, 'entry'] })).toEqual([]);
    expect(bundleHasDuplicateEntryIds({ entry: {} })).toBe(false);
  });

  it('uses collision-free fullUrl and version identity keys', () => {
    const issues = validateBundleFullUrls({
      entry: [
        {
          fullUrl: 'urn:example:x|v',
          resource: { meta: { versionId: 'z' } },
        },
        {
          fullUrl: 'urn:example:x',
          resource: { meta: { versionId: 'v|z' } },
        },
      ],
    }, 'collection');

    expect(issues).toEqual([]);
  });

  it('reports actual duplicate fullUrl/version pairs at the concrete field', () => {
    const issues = validateBundleFullUrls({
      entry: [
        {
          fullUrl: 'https://example.test/fhir/Patient/p1',
          resource: { meta: { versionId: '2' } },
        },
        {
          fullUrl: 'https://example.test/fhir/Patient/p1',
          resource: { meta: { versionId: '2' } },
        },
      ],
    }, 'collection');

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'structural-bundle-fullurl-duplicate',
        path: 'Bundle.entry[1].fullUrl',
      }),
    ]);
  });

  it('limits the REST identity check to known-type/valid-id fullUrls (Java parity)', () => {
    // Percent-encoded segments are outside the FHIR id grammar, so the URL
    // does not "look RESTful" and the Java validator never compares it.
    expect(validateBundleEntryIdConsistency({
      entry: [{
        fullUrl: 'https://example.test/fhir/Patient/p%31',
        resource: { resourceType: 'Patient', id: 'p1' },
      }],
    })).toEqual([]);

    expect(validateBundleEntryIdConsistency({
      entry: [{
        fullUrl: 'https://example.test/fhir/Patient/%invalid',
        resource: { resourceType: 'Patient', id: 'p1' },
      }],
    })).toEqual([]);

    // IG page links end with Type-id.html under a non-resource-type segment
    // (ihe.iti.pdqm examples); the HL7 validator accepts them unflagged.
    expect(validateBundleEntryIdConsistency({
      entry: [{
        fullUrl: 'https://profiles.ihe.net/ITI/PDQm/Patient-ex-patient.html',
        resource: { resourceType: 'Patient', id: 'ex-patient' },
      }],
    })).toEqual([]);

    // Genuine RESTful mismatches stay errors (hl7.fhir.us.core
    // Bundle-66c8856b, confirmed against the HL7 validator).
    expect(validateBundleEntryIdConsistency({
      entry: [{
        fullUrl: 'http://52.90.126.238:8080/fhir/baseDstu3/Endpoint/Endpoint-71',
        resource: { resourceType: 'Endpoint', id: '71' },
      }],
    })).toEqual([
      expect.objectContaining({
        code: 'bundle-entry-fullurl-id-mismatch',
        path: 'Bundle.entry[0].fullUrl',
        severity: 'error',
      }),
    ]);
  });

  it('reports duplicate link relations at relation fields and ignores non-strings', () => {
    const issues = validateBundleLinkRelations({
      link: [
        { relation: { malformed: true } },
        { relation: 'next' },
        { relation: 'next' },
      ],
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'bundle-link-relation-duplicate',
        path: 'Bundle.link[2].relation',
        message: expect.stringContaining('Bundle.link[1].relation'),
      }),
    ]);
  });

  it('rejects a paging link relation outside a paged bundle type', () => {
    const issues = validateBundleLinkRelations({
      type: 'document',
      link: [{ relation: 'self' }, { relation: 'first' }],
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'bundle-link-relation-prohibited',
        path: 'Bundle.link[1].relation',
        message: expect.stringContaining("'first'"),
      }),
    ]);
  });

  it('allows paging link relations in searchset and history bundles', () => {
    for (const type of ['searchset', 'history']) {
      const issues = validateBundleLinkRelations({
        type,
        link: [{ relation: 'self' }, { relation: 'next' }, { relation: 'last' }],
      });
      expect(issues).toEqual([]);
    }
  });

  it('stays quiet about paging relations when the bundle declares no type', () => {
    const issues = validateBundleLinkRelations({
      link: [{ relation: 'next' }],
    });

    expect(issues).toEqual([]);
  });

  it('uses collision-free logical resource/version keys', () => {
    const issues = detectDuplicateBundleEntries({
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1|v',
            meta: { versionId: 'z' },
          },
        },
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
            meta: { versionId: 'v|z' },
          },
        },
      ],
    });

    expect(issues).toEqual([]);
  });
});
