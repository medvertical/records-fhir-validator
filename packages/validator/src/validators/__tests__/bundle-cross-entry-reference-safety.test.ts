import { describe, expect, it } from 'vitest';

import {
  buildReferenceIndexes,
  resolveReferenceInBundle,
} from '../bundle-cross-entry-reference-resolution';
import { validateBundleCrossEntryReferences } from '../bundle-cross-entry-references';
import { extractReferencesWithPaths } from '../bundle-reference-utils';

describe('bundle cross-entry reference safety', () => {
  it('contains cyclic resources and skips malformed entries', () => {
    const resource: Record<string, unknown> = {
      resourceType: 'Patient',
      id: 'source',
      managingOrganization: {
        reference: 'Organization/missing',
      },
    };
    resource.loop = resource;

    const issues = validateBundleCrossEntryReferences({
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        null,
        42,
        { fullUrl: 99, resource },
      ],
    }, 'document');

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'bundle-cross-entry-reference-missing',
        path: 'Bundle.entry[2].resource.managingOrganization',
      }),
    ]);
  });

  it('extracts a shared reference at each concrete path without following cycles', () => {
    const shared = { reference: 'Patient/p1' };
    const resource: Record<string, unknown> = {
      subject: shared,
      performer: [shared],
    };
    resource.loop = resource;
    const hits: Array<{ reference: string; path: string }> = [];

    extractReferencesWithPaths(resource, '', hits);

    expect(hits).toEqual([
      { reference: 'Patient/p1', path: 'subject' },
      { reference: 'Patient/p1', path: 'performer[0]' },
    ]);
  });

  it('indexes only usable entry fields and preserves type/id match diagnostics', () => {
    const entries = [
      null,
      { fullUrl: 42, resource: { resourceType: 'Patient', id: 'p1' } },
      { resource: { resourceType: 'Patient', id: 'p1' } },
      { request: { url: 42 } },
    ];
    const indexes = buildReferenceIndexes(entries);
    const resolved = resolveReferenceInBundle(
      'Patient/p1',
      'Patient/p1',
      undefined,
      indexes,
    );

    expect(indexes.fullUrlIndex.size).toBe(0);
    expect(resolved).toMatchObject({
      resolvable: false,
      hasTypeIdMatch: true,
      multipleMatches: true,
      matchCount: 2,
    });
  });

  it('returns no issues for malformed bundle roots', () => {
    expect(validateBundleCrossEntryReferences(null, null)).toEqual([]);
    expect(validateBundleCrossEntryReferences({ entry: {} }, null)).toEqual([]);
  });
});

describe('closed bundle anchors', () => {
  const messageBundle = {
    resourceType: 'Bundle',
    type: 'message',
    entry: [
      {
        fullUrl: 'urn:uuid:118ee8fd-5e69-49b9-bc55-1826217ab907',
        resource: {
          resourceType: 'MessageHeader',
          sender: { reference: 'https://server.example.test/Organization/PRV-123' },
          focus: [{ reference: 'https://server.example.test/Claim/c1' }],
        },
      },
      {
        fullUrl: 'urn:uuid:f8bb1e7f-0ade-4230-b6f9-303784edad02',
        resource: {
          resourceType: 'Claim',
          id: 'f8bb1e7f-0ade-4230-b6f9-303784edad02',
          patient: { reference: 'https://server.example.test/Patient/1002003004' },
          insurer: { reference: 'urn:uuid:00000000-0000-0000-0000-000000000001' },
        },
      },
    ],
  };

  it('requires MessageHeader.focus in the bundle but lets other entries point at a server', () => {
    const issues = validateBundleCrossEntryReferences(messageBundle, 'message');
    const errors = issues.filter(issue => issue.severity === 'error');

    expect(errors.map(issue => issue.path)).toEqual(['Bundle.entry[0].resource.focus[0]']);
  });

  it('reports an unresolved urn outside the anchors as a warning', () => {
    const issues = validateBundleCrossEntryReferences(messageBundle, 'message');

    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      path: 'Bundle.entry[1].resource.insurer',
    }));
  });
});
