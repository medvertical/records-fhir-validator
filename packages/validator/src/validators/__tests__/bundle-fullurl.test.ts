import { describe, it, expect } from 'vitest';
import { BundleValidator } from '../bundle-validator';

const validator = new BundleValidator();

describe('BundleValidator fullUrl enforcement', () => {
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

  it('anchors cross-entry errors at the resource when source fullUrl is missing', async () => {
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
    expect(crossEntryIssue?.path).toBe('Bundle.entry[0].resource');
  });

  it('flags missing fullUrl as error in transaction Bundle', async () => {
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
    const fullUrlIssues = issues.filter(i => i.code === 'bundle-entry-missing-fullurl');
    expect(fullUrlIssues.length).toBe(1);
    expect(fullUrlIssues[0].severity).toBe('error');
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
