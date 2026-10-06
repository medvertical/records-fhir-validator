import { describe, expect, it } from 'vitest';
import { validateBundleFullUrlPresence } from '../bundle-type-rules';

// The defect corpus (quality-corpus/r4/generated/bundle-entry-missing-fullurl)
// matches this exact path — a drift here silently costs recall instead of
// failing this suite.
describe('validateBundleFullUrlPresence path contract', () => {
  it('reports Bundle.entry[i].fullUrl for a collection entry with a resource but no fullUrl', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }],
    };

    const issues = validateBundleFullUrlPresence(bundle, 'collection');

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'bundle-entry-missing-fullurl',
      severity: 'error',
      path: 'Bundle.entry[0].fullUrl',
    });
  });

  it('emits nothing when the collection entry carries a fullUrl', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{
        fullUrl: 'urn:uuid:0c3151bd-1cbf-4d64-b04d-cd9187a4c6e0',
        resource: { resourceType: 'Patient', id: 'p1' },
      }],
    };

    expect(validateBundleFullUrlPresence(bundle, 'collection')).toEqual([]);
  });

  it('reports a relative reference on the Bundle itself, outside any entry, but not in its signature', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      identifier: { system: 'urn:ietf:rfc:3986', value: 'urn:uuid:1', assigner: { reference: 'Organization/1' } },
      signature: [{ who: { reference: 'Practitioner/1' } }],
      entry: [{ fullUrl: 'urn:uuid:2', resource: { resourceType: 'Patient', id: 'p1' }, request: { method: 'PUT', url: 'Patient/p1' } }],
    };

    expect(validateBundleFullUrlPresence(bundle, 'transaction')).toEqual([
      expect.objectContaining({
        code: 'bundle-entry-missing-fullurl-relative-ref',
        severity: 'error',
        path: 'Bundle.identifier.assigner',
      }),
    ]);
    expect(validateBundleFullUrlPresence({ ...bundle, type: 'transaction-response' }, 'transaction-response')).toEqual([]);
  });

  it('reports a relative reference in a collection entry without fullUrl, as the reference validator does', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: { resourceType: 'Condition', id: 'c1', subject: { reference: 'Patient/1' } } }],
    };

    expect(validateBundleFullUrlPresence(bundle, 'collection').map(issue => [issue.code, issue.path])).toEqual([
      ['bundle-entry-missing-fullurl', 'Bundle.entry[0].fullUrl'],
      ['bundle-entry-missing-fullurl-relative-ref', 'Bundle.entry[0].resource.subject'],
    ]);
  });
});
