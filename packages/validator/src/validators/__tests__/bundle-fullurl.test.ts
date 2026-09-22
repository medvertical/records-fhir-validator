import { describe, it, expect } from 'vitest';
import { BundleValidator } from '../bundle-validator';
import { validateBundleEntryIdConsistency } from '../bundle-entry-rules';

const validator = new BundleValidator();

describe('BundleValidator fullUrl enforcement', () => {
  it('leaves a non-string fullUrl to structural type validation without throwing', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{
        fullUrl: { invalidType: true },
        resource: { resourceType: 'Patient', id: 'p1' },
      }],
    };

    await expect(validator.validateBundle(bundle)).resolves.toBeDefined();
    expect(validateBundleEntryIdConsistency(bundle)).toEqual([]);
  });

  it('flags missing fullUrl as error in document Bundle', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        { resource: { resourceType: 'Composition', id: 'comp-1', status: 'final', type: {}, date: '2024-01-01', title: 'T', subject: { reference: 'Patient/p1' }, author: [{ reference: 'Practitioner/pr1' }] } },
        { resource: { resourceType: 'Patient', id: 'p1' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const fullUrlIssues = issues.filter(i => i.code === 'bundle-entry-missing-fullurl');
    expect(fullUrlIssues.length).toBe(2);
    expect(fullUrlIssues[0].severity).toBe('error');
  });

  it('keeps the concrete reference path when source fullUrl is missing', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          resource: {
            resourceType: 'Composition',
            id: 'comp-1',
            status: 'final',
            type: {},
            date: '2024-01-01',
            title: 'T',
            author: [{ reference: 'Practitioner/pr1' }],
          },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const crossEntryIssue = issues.find(i => i.code === 'bundle-cross-entry-reference-missing');

    expect(crossEntryIssue).toBeDefined();
    expect(crossEntryIssue?.path).toBe('Bundle.entry[0].resource.author[0]');
  });

  it('flags missing fullUrl as error in transaction Bundle', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          resource: { resourceType: 'Patient', id: 'p1' },
          request: { method: 'PUT', url: 'Patient/p1' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const fullUrlIssues = issues.filter(i => i.code === 'bundle-entry-missing-fullurl');
    expect(fullUrlIssues.length).toBe(1);
    expect(fullUrlIssues[0].severity).toBe('error');
  });

  // Bundle.entry.fullUrl: "The fullUrl element SHALL have a value except that:
  // fullUrl can be empty on a POST (although it does not need to when
  // specifying a temporary id for reference in the bundle)."
  it('leaves a POST entry without a fullUrl alone', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          resource: { resourceType: 'Patient', id: 'p1' },
          request: { method: 'POST', url: 'Patient' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'bundle-entry-missing-fullurl')).toEqual([]);
  });

  it('reports each missing transaction request.url at the concrete entry path', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          resource: { resourceType: 'Patient', id: 'p1' },
          request: { method: 'PUT' },
        },
        {
          resource: { resourceType: 'Patient', id: 'p2' },
          request: { method: 'PUT' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const requestUrlIssues = issues.filter(i => i.code === 'reference-bundle-request-missing-url');

    expect(requestUrlIssues.map(i => i.path)).toEqual([
      'Bundle.entry[0].request.url',
      'Bundle.entry[1].request.url',
    ]);
  });

  it('flags missing fullUrl as warning in collection Bundle', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p1' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const fullUrlIssues = issues.filter(i => i.code === 'bundle-entry-missing-fullurl');
    expect(fullUrlIssues.length).toBe(1);
    expect(fullUrlIssues[0].severity).toBe('warning');
  });

  it('does not flag an empty searchset Bundle without entries', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 0,
      link: [{ relation: 'self', url: 'https://example.org/fhir/Patient?name=none' }],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'reference-bundle-missing-entries')).toHaveLength(0);
    expect(issues.filter(i => i.code === 'bundle-missing-entries')).toHaveLength(0);
  });

  it('does not flag entries that have fullUrl', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'urn:uuid:comp-1',
          resource: { resourceType: 'Composition', id: 'comp-1', status: 'final', type: {}, date: '2024-01-01', title: 'T', subject: { reference: 'Patient/p1' }, author: [{ reference: 'Practitioner/pr1' }] },
        },
        {
          fullUrl: 'urn:uuid:p1',
          resource: { resourceType: 'Patient', id: 'p1' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const fullUrlIssues = issues.filter(i => i.code === 'bundle-entry-missing-fullurl');
    expect(fullUrlIssues).toHaveLength(0);
  });

  it('explains absolute reference mismatches when the same type/id exists under another fullUrl', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      identifier: { system: 'http://example.org/documents', value: 'doc-1' },
      timestamp: '2024-01-01T00:00:00Z',
      entry: [
        {
          fullUrl: 'http://local.example/fhir/Composition/comp-1',
          resource: {
            resourceType: 'Composition',
            id: 'comp-1',
            status: 'final',
            type: {},
            date: '2024-01-01',
            title: 'T',
            subject: { reference: 'https://server.fire.ly/Patient/p1' },
            author: [{ reference: 'http://local.example/fhir/Practitioner/pr1' }],
          },
        },
        {
          fullUrl: 'http://local.example/fhir/Patient/p1',
          resource: { resourceType: 'Patient', id: 'p1' },
        },
        {
          fullUrl: 'http://local.example/fhir/Practitioner/pr1',
          resource: { resourceType: 'Practitioner', id: 'pr1' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const crossEntryIssue = issues.find(i =>
      i.code === 'bundle-cross-entry-reference-missing' &&
      i.path === 'Bundle.entry[0].resource.subject');

    expect(crossEntryIssue).toBeDefined();
    expect(crossEntryIssue?.severity).toBe('error');
    expect(crossEntryIssue?.message).toContain('same type and id');
    expect(crossEntryIssue?.message).toContain('different absolute URL');
    expect(crossEntryIssue?.details).toEqual(expect.objectContaining({
      reference: 'https://server.fire.ly/Patient/p1',
      logicalReference: 'Patient/p1',
      hasTypeIdMatch: true,
      matchedFullUrls: ['http://local.example/fhir/Patient/p1'],
    }));
  });

  it('explains document bundle references that only match entry request.url', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      identifier: { system: 'http://example.org/documents', value: 'doc-1' },
      timestamp: '2024-01-01T00:00:00Z',
      entry: [
        {
          fullUrl: 'urn:uuid:comp-1',
          resource: {
            resourceType: 'Composition',
            status: 'final',
            type: {},
            date: '2024-01-01',
            title: 'T',
            author: [{ reference: 'Practitioner/pr1' }],
          },
        },
        {
          fullUrl: 'urn:uuid:pr1',
          resource: { resourceType: 'Practitioner' },
          request: { method: 'PUT', url: 'Practitioner/pr1' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const crossEntryIssue = issues.find(i =>
      i.code === 'bundle-cross-entry-reference-missing' &&
      i.path === 'Bundle.entry[0].resource.author[0]');

    expect(crossEntryIssue).toBeDefined();
    expect(crossEntryIssue?.severity).toBe('error');
    expect(crossEntryIssue?.message).toContain('entry.request.url matches');
    expect(crossEntryIssue?.details).toEqual(expect.objectContaining({
      reference: 'Practitioner/pr1',
      hasTypeIdMatch: false,
      matchedRequestUrls: [{ entryIndex: 1, requestUrl: 'Practitioner/pr1' }],
      fixHint: expect.stringContaining('Do not rely on entry.request.url'),
    }));
  });

  it('does not resolve relative message references from an inconsistent REST fullUrl', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'message',
      entry: [
        {
          fullUrl: 'http://example.org/MessageHeader/wrong-id',
          resource: {
            resourceType: 'MessageHeader',
            id: 'actual-id',
            eventCoding: { system: 'http://example.org/events', code: 'event' },
            source: { endpoint: 'http://example.org/source' },
            focus: [{ reference: 'Organization/org' }],
          },
        },
        {
          fullUrl: 'http://example.org/Organization/org',
          resource: { resourceType: 'Organization', id: 'org' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'bundle-cross-entry-reference-missing',
      path: 'Bundle.entry[0].resource.focus[0]',
    }));
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'bundle-entry-not-reachable',
      path: 'Bundle.entry[1]',
      severity: 'warning',
    }));
  });

  it('skips entries without a resource', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        { request: { method: 'DELETE', url: 'Patient/p1' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const fullUrlIssues = issues.filter(i => i.code === 'bundle-entry-missing-fullurl');
    expect(fullUrlIssues).toHaveLength(0);
  });

  it('does not apply bdl-7 duplicate fullUrl uniqueness to history bundles', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'history',
      entry: [
        { fullUrl: 'http://example.org/fhir/Patient/p1', resource: { resourceType: 'Patient', id: 'p1' } },
        { fullUrl: 'http://example.org/fhir/Patient/p1', resource: { resourceType: 'Patient', id: 'p1' } },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'structural-bundle-fullurl-duplicate')).toHaveLength(0);
  });

  it('flags version-specific fullUrl values as bdl-8 violations', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          fullUrl: 'http://example.org/fhir/Patient/p1/_history/2',
          resource: { resourceType: 'Patient', id: 'p1' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    const bdl8 = issues.filter(i => i.code === 'bdl-8-violation');
    expect(bdl8).toHaveLength(1);
    expect(bdl8[0].path).toBe('Bundle.entry[0].fullUrl');
  });

  it('flags document bundles missing identifier system/value or timestamp', async () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      identifier: { system: 'http://example.org/documents' },
      entry: [
        {
          fullUrl: 'urn:uuid:comp-1',
          resource: { resourceType: 'Composition', id: 'comp-1', status: 'final', type: {}, date: '2024-01-01', title: 'T' },
        },
      ],
    };

    const issues = await validator.validateBundle(bundle);
    expect(issues.filter(i => i.code === 'bdl-9-violation')).toHaveLength(1);
    expect(issues.filter(i => i.code === 'bdl-10-violation')).toHaveLength(1);
  });

  it('flags empty document and message bundles for first-entry invariants', async () => {
    const documentIssues = await validator.validateBundle({
      resourceType: 'Bundle',
      type: 'document',
      identifier: { system: 'http://example.org/documents', value: 'doc-1' },
      timestamp: '2024-01-01T00:00:00Z',
      entry: [],
    });
    const messageIssues = await validator.validateBundle({
      resourceType: 'Bundle',
      type: 'message',
      entry: [],
    });

    expect(documentIssues.filter(i => i.code === 'bundle-document-first-entry-not-composition')).toHaveLength(1);
    expect(messageIssues.filter(i => i.code === 'bundle-message-first-entry-not-messageheader')).toHaveLength(1);
  });
});
