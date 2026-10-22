import { describe, expect, it } from 'vitest';

import { externalQualitySourceSchema, parseExternalQualitySource } from '../external-quality-source';

const source = {
  schemaVersion: 1,
  id: 'mii-dqa-cql',
  providerType: 'git',
  providerName: 'MII DQA-CQL',
  repositoryUrl: 'https://github.com/medizininformatik-initiative/DQA-CQL',
  sourceSubpath: 'scripts',
  trackingRef: 'main',
  state: 'blocked-license',
  statusDetail: 'No compatible source license has been recorded.',
  resolvedCommitSha: 'a'.repeat(40),
  sourceContentHash: `sha256:${'b'.repeat(64)}`,
  adapter: { id: 'records-mii-dqa-cql', version: '1' },
  license: { status: 'missing', detail: 'No license file was found.' },
  inventory: { activeChecks: 3, modules: 1, native: 1, external: 1, catalogOnly: 1 },
  lastCheckedAt: '2026-10-03T00:00:00.000Z',
  lastSuccessfulImportAt: null,
} as const;

describe('external quality source contract', () => {
  it('accepts a completely classified immutable source snapshot', () => {
    expect(parseExternalQualitySource(source)).toEqual(source);
  });

  it('requires HTTPS and exact execution coverage', () => {
    expect(externalQualitySourceSchema.safeParse({
      ...source,
      repositoryUrl: 'http://example.test/source',
    }).success).toBe(false);
    expect(externalQualitySourceSchema.safeParse({
      ...source,
      inventory: { ...source.inventory, catalogOnly: 0 },
    }).success).toBe(false);
    expect(() => externalQualitySourceSchema.safeParse({
      ...source,
      repositoryUrl: 'not a URL',
    })).not.toThrow();
  });
});
