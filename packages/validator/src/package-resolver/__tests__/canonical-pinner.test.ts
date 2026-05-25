import { describe, it, expect } from 'vitest';
import { pinCanonicals } from '../canonical-pinner';
import type { CanonicalCandidate } from '../types';

function candidate(overrides: Partial<CanonicalCandidate> = {}): CanonicalCandidate {
  return {
    url: 'http://example.org/SD/Test',
    version: '1.0.0',
    sourcePackage: 'test.pkg@1.0.0',
    status: 'active',
    ...overrides,
  };
}

function buildMap(entries: CanonicalCandidate[]): Map<string, CanonicalCandidate[]> {
  const map = new Map<string, CanonicalCandidate[]>();
  for (const e of entries) {
    const list = map.get(e.url) || [];
    list.push(e);
    map.set(e.url, list);
  }
  return map;
}

describe('pinCanonicals', () => {
  it('pins single candidate as only-candidate', () => {
    const map = buildMap([candidate()]);
    const pinned = pinCanonicals(map);
    expect(pinned.size).toBe(1);
    const entry = [...pinned.values()][0];
    expect(entry.resolvedBy).toBe('only-candidate');
    expect(entry.version).toBe('1.0.0');
  });

  it('stage 1: prefers active over draft', () => {
    const map = buildMap([
      candidate({ version: '2.0.0', status: 'draft' }),
      candidate({ version: '1.0.0', status: 'active' }),
    ]);
    const pinned = pinCanonicals(map);
    expect([...pinned.values()][0].version).toBe('1.0.0');
    expect([...pinned.values()][0].resolvedBy).toBe('status-active');
  });

  it('stage 2: prefers terminology package', () => {
    const map = buildMap([
      candidate({ version: '1.0.0', sourcePackage: 'some.pkg@1.0.0', status: 'active' }),
      candidate({ version: '1.0.0', sourcePackage: 'hl7.terminology.r4@5.0.0', status: 'active' }),
    ]);
    const pinned = pinCanonicals(map);
    expect([...pinned.values()][0].sourcePackage).toBe('hl7.terminology.r4@5.0.0');
    expect([...pinned.values()][0].resolvedBy).toBe('terminology-priority');
  });

  it('stage 3: prefers core package', () => {
    const map = buildMap([
      candidate({ version: '1.0.0', sourcePackage: 'some.pkg@1.0.0', status: 'active' }),
      candidate({ version: '1.0.0', sourcePackage: 'hl7.fhir.r4.core@4.0.1', status: 'active' }),
    ]);
    const pinned = pinCanonicals(map);
    expect([...pinned.values()][0].sourcePackage).toBe('hl7.fhir.r4.core@4.0.1');
    expect([...pinned.values()][0].resolvedBy).toBe('core-priority');
  });

  it('stage 4: selects highest version', () => {
    const map = buildMap([
      candidate({ version: '1.0.0', sourcePackage: 'a@1.0.0', status: 'active' }),
      candidate({ version: '3.0.0', sourcePackage: 'a@3.0.0', status: 'active' }),
      candidate({ version: '2.0.0', sourcePackage: 'a@2.0.0', status: 'active' }),
    ]);
    const pinned = pinCanonicals(map);
    expect([...pinned.values()][0].version).toBe('3.0.0');
    expect([...pinned.values()][0].resolvedBy).toBe('version-highest');
  });

  it('excludes pre-expanded ValueSets', () => {
    const map = buildMap([
      candidate({ version: '1.0.0', hasExpansion: true }),
      candidate({ version: '2.0.0' }),
    ]);
    const pinned = pinCanonicals(map);
    expect([...pinned.values()][0].version).toBe('2.0.0');
  });

  it('excludes example packages', () => {
    const map = buildMap([
      candidate({ version: '2.0.0', sourcePackage: 'hl7.fhir.r4.examples@4.0.1' }),
      candidate({ version: '1.0.0', sourcePackage: 'hl7.fhir.r4.core@4.0.1' }),
    ]);
    const pinned = pinCanonicals(map);
    expect([...pinned.values()][0].sourcePackage).toBe('hl7.fhir.r4.core@4.0.1');
  });

  it('excludes CodeSystems where content != complete', () => {
    const map = buildMap([
      candidate({ version: '1.0.0', content: 'not-present' }),
      candidate({ version: '2.0.0', content: 'complete' }),
    ]);
    const pinned = pinCanonicals(map);
    expect([...pinned.values()][0].version).toBe('2.0.0');
  });

  it('override: skip removes package from candidates', () => {
    const map = buildMap([
      candidate({ version: '1.0.0', sourcePackage: 'bad-pkg@1.0.0' }),
      candidate({ version: '2.0.0', sourcePackage: 'good-pkg@2.0.0' }),
    ]);
    const pinned = pinCanonicals(map, [
      { action: 'skip', package: 'bad-pkg@1.0.0' },
    ]);
    expect([...pinned.values()][0].sourcePackage).toBe('good-pkg@2.0.0');
  });

  it('override: pin forces specific version', () => {
    const map = buildMap([
      candidate({ version: '1.0.0', sourcePackage: 'a@1.0.0' }),
      candidate({ version: '2.0.0', sourcePackage: 'a@2.0.0' }),
    ]);
    const pinned = pinCanonicals(map, [
      { action: 'pin', canonical: 'http://example.org/SD/Test', version: '1.0.0' },
    ]);
    expect([...pinned.values()][0].version).toBe('1.0.0');
    expect([...pinned.values()][0].resolvedBy).toBe('override-pin');
  });

  it('handles multiple URLs independently', () => {
    const map = buildMap([
      candidate({ url: 'http://a', version: '1.0.0' }),
      candidate({ url: 'http://b', version: '2.0.0' }),
    ]);
    const pinned = pinCanonicals(map);
    expect(pinned.size).toBe(2);
  });

  it('returns empty map for empty input', () => {
    const pinned = pinCanonicals(new Map());
    expect(pinned.size).toBe(0);
  });
});
