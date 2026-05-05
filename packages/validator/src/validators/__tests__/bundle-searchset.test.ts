import { describe, it, expect } from 'vitest';
import { BundleValidator } from '../bundle-validator';

const validator = new BundleValidator();

describe('BundleValidator document/message reachability', () => {
  it('flags entries unreachable from the Composition in a urn:-addressed document', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'urn:uuid:c0',
          resource: {
            resourceType: 'Composition',
            id: 'c0',
            status: 'final',
            type: { text: 'X' },
            date: '2024-01-01',
            title: 'T',
            author: [{ reference: 'urn:uuid:p0' }],
          },
        },
        { fullUrl: 'urn:uuid:p0', resource: { resourceType: 'Practitioner', id: 'p0' } },
        // Orphan: not reachable from the Composition.
        { fullUrl: 'urn:uuid:orphan', resource: { resourceType: 'Patient', id: 'orphan' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const orphans = issues.filter(i => i.code === 'bundle-entry-not-reachable');
    expect(orphans).toHaveLength(1);
    expect(orphans[0].path).toBe('Bundle.entry[2]');
    expect(orphans[0].message).toContain("Entry 'urn:uuid:orphan' isn't reachable");
    expect(orphans[0].message).toContain('Composition');
  });

  it('treats urn:-source relative refs as unresolvable for reachability', async () => {
    // Composition uses a `Patient/p0` relative ref but its own fullUrl is
    // urn:, so per FHIR R4 §2.1.0.5.2 the relative ref cannot resolve and
    // the Patient entry is reported as unreachable.
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'urn:uuid:c0',
          resource: {
            resourceType: 'Composition',
            id: 'c0',
            status: 'final',
            type: { text: 'X' },
            date: '2024-01-01',
            title: 'T',
            subject: { reference: 'Patient/p0' },
          },
        },
        { fullUrl: 'urn:uuid:p0', resource: { resourceType: 'Patient', id: 'p0' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const orphans = issues.filter(i => i.code === 'bundle-entry-not-reachable');
    expect(orphans).toHaveLength(1);
    expect(orphans[0].path).toBe('Bundle.entry[1]');
  });

  it('uses MessageHeader as the root label for message bundles', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'message',
      entry: [
        {
          fullUrl: 'urn:uuid:m0',
          resource: { resourceType: 'MessageHeader', id: 'm0' },
        },
        { fullUrl: 'urn:uuid:orphan', resource: { resourceType: 'Patient', id: 'orphan' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const orphans = issues.filter(i => i.code === 'bundle-entry-not-reachable');
    expect(orphans).toHaveLength(1);
    expect(orphans[0].message).toContain('MessageHeader');
  });

  it('skips reachability when fullUrls are malformed (e.g. relative)', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        // Relative fullUrls — the absolute-fullUrl rule already flags
        // these; reachability would over-emit on top of that.
        {
          fullUrl: 'Composition/1',
          resource: { resourceType: 'Composition', id: '1', status: 'final', type: { text: 'X' }, date: '2024-01-01', title: 'T' },
        },
        { fullUrl: 'Patient/1', resource: { resourceType: 'Patient', id: '1' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'bundle-entry-not-reachable')).toHaveLength(0);
  });

  it('does not run reachability on collection / searchset bundles', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { fullUrl: 'urn:uuid:a', resource: { resourceType: 'Patient', id: 'a' } },
        { fullUrl: 'urn:uuid:b', resource: { resourceType: 'Patient', id: 'b' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'bundle-entry-not-reachable')).toHaveLength(0);
  });
});

describe('BundleValidator searchset rules', () => {
  it('warns when a searchset bundle has no self link', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 0,
      entry: [],
    };

    const issues = await validator.validateBundle(bundle);
    const selfLink = issues.filter(i => i.code === 'bundle-searchset-missing-self-link');
    expect(selfLink).toHaveLength(1);
    expect(selfLink[0].severity).toBe('warning');
  });

  it('does not warn about self link when one is present', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 0,
      link: [{ relation: 'self', url: 'http://example.org/Patient?_id=1' }],
      entry: [],
    };

    const issues = await validator.validateBundle(bundle);
    const selfLink = issues.filter(i => i.code === 'bundle-searchset-missing-self-link');
    expect(selfLink).toHaveLength(0);
  });

  it('warns about missing search modes only when the self link is also missing', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [
        { fullUrl: 'http://nothing/1', resource: { resourceType: 'Patient', id: 'p1' } },
        { fullUrl: 'http://nothing/2', resource: { resourceType: 'Patient', id: 'p2' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const modeWarnings = issues.filter(i => i.code === 'bundle-searchset-missing-search-mode');
    expect(modeWarnings).toHaveLength(1);
    expect(modeWarnings[0].severity).toBe('warning');
    expect(modeWarnings[0].path).toBe('Bundle');
  });

  it('suppresses the search-mode warning when the bundle has a self link (Java parity)', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      link: [{ relation: 'self', url: 'http://example.org/Patient' }],
      entry: [
        { fullUrl: 'http://nothing/1', resource: { resourceType: 'Patient', id: 'p1' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'bundle-searchset-missing-search-mode')).toHaveLength(0);
  });

  it('does not warn when every entry has search.mode', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [
        {
          fullUrl: 'http://nothing/1',
          resource: { resourceType: 'Patient', id: 'p1' },
          search: { mode: 'match' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const modeWarnings = issues.filter(i => i.code === 'bundle-searchset-missing-search-mode');
    expect(modeWarnings).toHaveLength(0);
  });

  it('errors when a search match entry has no resource id', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      link: [{ relation: 'self', url: 'http://example.org/Patient' }],
      entry: [
        {
          fullUrl: 'http://nothing/1',
          resource: { resourceType: 'Immunization', status: 'completed' },
          search: { mode: 'match' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const idIssues = issues.filter(i => i.code === 'bundle-searchset-entry-missing-id');
    expect(idIssues).toHaveLength(1);
    expect(idIssues[0].severity).toBe('error');
    expect(idIssues[0].path).toBe('Bundle.entry[0].resource');
    expect(idIssues[0].message).toContain('Search results must have ids');
  });

  it('errors when a mode=outcome entry is not an OperationOutcome', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      link: [{ relation: 'self', url: 'http://example.org/Patient' }],
      entry: [
        {
          fullUrl: 'http://nothing/1',
          resource: { resourceType: 'Immunization', status: 'completed' },
          search: { mode: 'outcome' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const wrongType = issues.filter(i => i.code === 'bundle-searchset-outcome-wrong-type');
    expect(wrongType).toHaveLength(1);
    expect(wrongType[0].severity).toBe('error');
    expect(wrongType[0].message).toBe('This is not an OperationOutcome (Immunization)');
  });

  it('does not require an id when search.mode is missing (collection-style entry)', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      link: [{ relation: 'self', url: 'http://example.org/OperationOutcome' }],
      entry: [
        {
          fullUrl: 'http://nothing/1',
          resource: { resourceType: 'OperationOutcome', issue: [] },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const idIssues = issues.filter(i => i.code === 'bundle-searchset-entry-missing-id');
    expect(idIssues).toHaveLength(0);
  });

  it('does not flag id rule on an OperationOutcome with mode=outcome', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 0,
      link: [{ relation: 'self', url: 'http://example.org/Patient' }],
      entry: [
        {
          fullUrl: 'http://nothing/1',
          resource: { resourceType: 'OperationOutcome', issue: [] },
          search: { mode: 'outcome' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'bundle-searchset-entry-missing-id')).toHaveLength(0);
    expect(issues.filter(i => i.code === 'bundle-searchset-outcome-wrong-type')).toHaveLength(0);
  });

  it('does not apply searchset rules to collection bundles', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          fullUrl: 'http://nothing/1',
          resource: { resourceType: 'Immunization', status: 'completed' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'bundle-searchset-missing-self-link')).toHaveLength(0);
    expect(issues.filter(i => i.code === 'bundle-searchset-missing-search-mode')).toHaveLength(0);
    expect(issues.filter(i => i.code === 'bundle-searchset-entry-missing-id')).toHaveLength(0);
  });

  it('errors when an entry resource type does not match the self link path type', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      link: [{ relation: 'self', url: 'base/Patient?name=test' }],
      entry: [
        {
          fullUrl: 'http://nothing/1',
          resource: { resourceType: 'Immunization', id: 'imm1', status: 'completed' },
          search: { mode: 'match' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const wrong = issues.filter(i => i.code === 'bundle-searchset-entry-wrong-type');
    expect(wrong).toHaveLength(1);
    expect(wrong[0].severity).toBe('error');
    expect(wrong[0].message).toBe(
      'This is not a matching resource type for the specified search (Immunization expecting [Patient])',
    );
  });

  it('honours _type query parameter when matching expected types', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      link: [{ relation: 'self', url: 'base?name=test&_type=Observation,DocumentReference' }],
      entry: [
        {
          fullUrl: 'http://nothing/1',
          resource: { resourceType: 'OperationOutcome', issue: [] },
          search: { mode: 'match' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const wrong = issues.filter(i => i.code === 'bundle-searchset-entry-wrong-type');
    expect(wrong).toHaveLength(1);
    expect(wrong[0].message).toContain('OperationOutcome expecting [Observation, DocumentReference]');
  });

  it('does not flag the type mismatch on outcome-mode entries', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      link: [{ relation: 'self', url: 'base/Patient?name=test' }],
      entry: [
        {
          fullUrl: 'http://nothing/1',
          resource: { resourceType: 'OperationOutcome', issue: [] },
          search: { mode: 'outcome' },
        },
        {
          fullUrl: 'http://nothing/2',
          resource: { resourceType: 'Patient', id: 'p1' },
          search: { mode: 'match' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'bundle-searchset-entry-wrong-type')).toHaveLength(0);
  });

  it('does not flag the type mismatch when self link does not constrain a type', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      link: [{ relation: 'self', url: 'http://example.org/?_count=10' }],
      entry: [
        {
          fullUrl: 'http://nothing/1',
          resource: { resourceType: 'Patient', id: 'p1' },
          search: { mode: 'match' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'bundle-searchset-entry-wrong-type')).toHaveLength(0);
  });
});
