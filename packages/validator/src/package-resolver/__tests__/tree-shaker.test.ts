import { describe, it, expect } from 'vitest';
import { treeShake, extractOutgoingRefs, type CanonicalGraph } from '../tree-shaker';
import type { PinnedCanonical } from '../types';

function pinned(url: string, version: string): PinnedCanonical {
  return { url, version, sourcePackage: 'test@1.0.0', resolvedBy: 'only-candidate' };
}

describe('treeShake', () => {
  it('retains root and its transitive dependencies', () => {
    const map = new Map<string, PinnedCanonical>([
      ['http://a|1.0', pinned('http://a', '1.0')],
      ['http://b|1.0', pinned('http://b', '1.0')],
      ['http://c|1.0', pinned('http://c', '1.0')],
      ['http://orphan|1.0', pinned('http://orphan', '1.0')],
    ]);
    const graph: CanonicalGraph = {
      outgoingRefs: new Map([
        ['http://a', new Set(['http://b'])],
        ['http://b', new Set(['http://c'])],
      ]),
    };

    const result = treeShake(map, ['http://a'], graph);
    expect(result.size).toBe(3);
    expect(result.has('http://orphan|1.0')).toBe(false);
  });

  it('handles cycles without infinite loop', () => {
    const map = new Map<string, PinnedCanonical>([
      ['http://a|1.0', pinned('http://a', '1.0')],
      ['http://b|1.0', pinned('http://b', '1.0')],
    ]);
    const graph: CanonicalGraph = {
      outgoingRefs: new Map([
        ['http://a', new Set(['http://b'])],
        ['http://b', new Set(['http://a'])],
      ]),
    };

    const result = treeShake(map, ['http://a'], graph);
    expect(result.size).toBe(2);
  });

  it('returns all if no roots provided', () => {
    const map = new Map<string, PinnedCanonical>([
      ['http://a|1.0', pinned('http://a', '1.0')],
    ]);
    const result = treeShake(map, [], { outgoingRefs: new Map() });
    expect(result.size).toBe(1);
  });

  it('drops unreferenced canonicals', () => {
    const map = new Map<string, PinnedCanonical>();
    for (let i = 0; i < 100; i++) {
      map.set(`http://term/${i}|1.0`, pinned(`http://term/${i}`, '1.0'));
    }
    map.set('http://root|1.0', pinned('http://root', '1.0'));

    const graph: CanonicalGraph = {
      outgoingRefs: new Map([
        ['http://root', new Set(['http://term/0', 'http://term/5'])],
      ]),
    };

    const result = treeShake(map, ['http://root'], graph);
    expect(result.size).toBe(3);
    expect(result.has('http://root|1.0')).toBe(true);
    expect(result.has('http://term/0|1.0')).toBe(true);
    expect(result.has('http://term/5|1.0')).toBe(true);
  });
});

describe('extractOutgoingRefs', () => {
  it('extracts baseDefinition', () => {
    const refs = extractOutgoingRefs({
      resourceType: 'StructureDefinition',
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
    });
    expect(refs).toContain('http://hl7.org/fhir/StructureDefinition/Patient');
  });

  it('strips version suffix', () => {
    const refs = extractOutgoingRefs({
      baseDefinition: 'http://example.org/SD/Test|4.0.1',
    });
    expect(refs).toContain('http://example.org/SD/Test');
    expect(refs).not.toContain('http://example.org/SD/Test|4.0.1');
  });

  it('extracts from nested element types', () => {
    const refs = extractOutgoingRefs({
      snapshot: {
        element: [
          {
            type: [
              { profile: ['http://hl7.org/fhir/StructureDefinition/HumanName'] },
            ],
          },
        ],
      },
    });
    expect(refs).toContain('http://hl7.org/fhir/StructureDefinition/HumanName');
  });

  it('extracts ValueSet binding from elements', () => {
    const refs = extractOutgoingRefs({
      differential: {
        element: [
          {
            binding: {
              valueSet: 'http://hl7.org/fhir/ValueSet/languages',
            },
          },
        ],
      },
    });
    expect(refs).toContain('http://hl7.org/fhir/ValueSet/languages');
  });

  it('deduplicates', () => {
    const refs = extractOutgoingRefs({
      baseDefinition: 'http://a',
      snapshot: { element: [{ type: [{ profile: ['http://a'] }] }] },
    });
    expect(refs.filter(r => r === 'http://a')).toHaveLength(1);
  });

  it('ignores non-URL strings', () => {
    const refs = extractOutgoingRefs({
      status: 'active',
      name: 'TestProfile',
    });
    expect(refs).toHaveLength(0);
  });
});
