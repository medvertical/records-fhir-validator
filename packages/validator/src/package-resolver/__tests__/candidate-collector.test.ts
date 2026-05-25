import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectCanonicalCandidates } from '../candidate-collector';
import { pinCanonicals } from '../canonical-pinner';

/**
 * Build a temporary directory mirroring the HL7 NPM package layout so
 * the collector exercises the real filesystem walk without relying on
 * any host-specific package cache.
 */
function makeTempPackageRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'records-pkg-collector-'));

  // pkg-a: one StructureDefinition + one ValueSet
  const a = path.join(root, 'org.example.a#1.0.0', 'package');
  fs.mkdirSync(a, { recursive: true });
  fs.writeFileSync(path.join(a, 'package.json'), '{}');
  fs.writeFileSync(
    path.join(a, 'StructureDefinition-patient.json'),
    JSON.stringify({
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/Patient',
      version: '1.0.0',
      status: 'active',
    }),
  );
  fs.writeFileSync(
    path.join(a, 'ValueSet-shared.json'),
    JSON.stringify({
      resourceType: 'ValueSet',
      url: 'http://example.org/ValueSet/shared',
      version: '1.0.0',
      status: 'active',
    }),
  );

  // pkg-b: two competing versions of the same ValueSet, plus a non-canonical Patient instance
  const b = path.join(root, 'org.example.b#2.1.0', 'package');
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, 'package.json'), '{}');
  fs.writeFileSync(
    path.join(b, 'ValueSet-shared.json'),
    JSON.stringify({
      resourceType: 'ValueSet',
      url: 'http://example.org/ValueSet/shared',
      version: '2.0.0',
      status: 'active',
    }),
  );
  fs.writeFileSync(
    path.join(b, 'Patient-example.json'),
    JSON.stringify({
      resourceType: 'Patient',
      id: 'example',
      name: [{ family: 'Example' }],
    }),
  );
  fs.writeFileSync(
    path.join(b, 'CodeSystem-codes.json'),
    JSON.stringify({
      resourceType: 'CodeSystem',
      url: 'http://example.org/CodeSystem/codes',
      version: '2.1.0',
      status: 'active',
      content: 'complete',
    }),
  );

  // pkg-empty: package metadata only
  const e = path.join(root, 'org.example.empty#1.0.0', 'package');
  fs.mkdirSync(e, { recursive: true });
  fs.writeFileSync(path.join(e, 'package.json'), '{}');

  // pkg-broken-json: invalid file should be skipped silently
  fs.writeFileSync(path.join(b, 'broken.json'), '{ this is not json');

  return root;
}

describe('collectCanonicalCandidates', () => {
  let root: string;

  beforeAll(() => {
    root = makeTempPackageRoot();
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('walks each package and emits one candidate per canonical url', () => {
    const result = collectCanonicalCandidates(
      ['org.example.a#1.0.0', 'org.example.b#2.1.0'],
      { searchPaths: [root] },
    );

    expect(result.totalCandidates).toBe(4);
    expect(result.missingPackages).toEqual([]);
    expect(result.candidatesByUrl.get('http://example.org/StructureDefinition/Patient')).toHaveLength(1);
    expect(result.candidatesByUrl.get('http://example.org/CodeSystem/codes')).toHaveLength(1);

    // Same URL, two versions across packages
    const shared = result.candidatesByUrl.get('http://example.org/ValueSet/shared');
    expect(shared).toHaveLength(2);
    expect(shared!.map(c => c.version).sort()).toEqual(['1.0.0', '2.0.0']);
    expect(shared!.map(c => c.sourcePackage).sort()).toEqual([
      'org.example.a#1.0.0',
      'org.example.b#2.1.0',
    ]);
  });

  it('skips non-canonical resources (e.g. Patient instances)', () => {
    const result = collectCanonicalCandidates(
      ['org.example.b#2.1.0'],
      { searchPaths: [root] },
    );
    // ValueSet + CodeSystem only — Patient instance is filtered out.
    expect(result.totalCandidates).toBe(2);
    expect(result.candidatesByUrl.has('http://example.org/Patient/example')).toBe(false);
  });

  it('records empty packages without emitting candidates', () => {
    const result = collectCanonicalCandidates(
      ['org.example.empty#1.0.0'],
      { searchPaths: [root] },
    );
    expect(result.totalCandidates).toBe(0);
    expect(result.emptyPackages).toEqual(['org.example.empty#1.0.0']);
  });

  it('records missing packages and continues with the rest', () => {
    const result = collectCanonicalCandidates(
      ['org.example.a#1.0.0', 'does.not.exist#0.0.1'],
      { searchPaths: [root], skipMissing: true },
    );
    expect(result.missingPackages).toEqual(['does.not.exist#0.0.1']);
    expect(result.totalCandidates).toBe(2);
  });

  it('feeds the result directly into pinCanonicals — duplicate URL collapses to one pin', () => {
    const collector = collectCanonicalCandidates(
      ['org.example.a#1.0.0', 'org.example.b#2.1.0'],
      { searchPaths: [root] },
    );
    const pinned = pinCanonicals(collector.candidatesByUrl);

    // Two ValueSet versions, but pinCanonicals selects one. Headcount of
    // distinct URLs in pinned (irrespective of version) must equal the
    // number of distinct URLs in the candidate map.
    const distinctPinnedUrls = new Set(Array.from(pinned.values()).map(p => p.url));
    expect(distinctPinnedUrls.size).toBe(collector.candidatesByUrl.size);

    // The chosen ValueSet/shared version is deterministic — both candidates
    // are 'active', neither is in a terminology or core package, so stage 4
    // (highest version) wins → 2.0.0.
    const chosen = Array.from(pinned.values()).find(
      p => p.url === 'http://example.org/ValueSet/shared',
    );
    expect(chosen?.version).toBe('2.0.0');
    expect(chosen?.resolvedBy).toBe('version-highest');
  });
});
