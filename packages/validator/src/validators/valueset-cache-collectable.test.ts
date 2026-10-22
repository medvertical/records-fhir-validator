import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectableDefinitionCache } from '../cache/collectable-definition-cache';
import { createValidationDependencySnapshot } from '../validation-dependency-snapshot';
import { setProfileSource } from '../persistence/profile-source';
import { ValueSetCache } from './valueset-cache';
import { ValueSetPackageLoader } from './valueset-package-loader';
import { ValueSetPackageResourceAccess } from './valueset-package-resource-access';
import { ValueSetValidator } from './valueset-validator';
import type { CodeSystem } from './valueset-types';

const system = 'https://example.test/CodeSystem/frozen';
const canonical = 'https://example.test/ValueSet/frozen';
const context = { organizationId: 73, serverId: 9, fhirVersion: 'R4' as const,
  terminologySnapshotSha256: 'a'.repeat(64) };
const definition = (): CodeSystem => ({ resourceType: 'CodeSystem', url: system, version: '1',
  content: 'complete', concept: [{ code: 'present' }] });

function controlledCollection() {
  const references: { target: object | undefined }[] = [];
  vi.stubGlobal('WeakRef', class<T extends object> {
    private readonly entry: { target: object | undefined };
    constructor(target: T) { this.entry = { target }; references.push(this.entry); }
    deref(): T | undefined { return this.entry.target as T | undefined; }
  });
  return { references, collect: () => { for (const entry of references) entry.target = undefined; } };
}

afterEach(() => { vi.unstubAllGlobals(); setProfileSource({}); });

describe('collectable immutable terminology definitions', () => {
  it('keeps mutable and ordinary definitions strongly owned', () => {
    const { references, collect } = controlledCollection();
    const cache = new ValueSetCache();
    const frozen = Object.freeze(definition());
    cache.setCodeSystem(system, frozen);
    cache.sourceContexts.runWith(context, () => cache.setCodeSystem(system, definition()));
    expect(references).toHaveLength(0);
    collect();
    expect(cache.getCodeSystem(system)).toBe(frozen);
    cache.sourceContexts.runWith(context, () => expect(cache.getCodeSystem(system)).toEqual(definition()));
  });

  it('drops collected definitions in all raw domains while retaining negative results', () => {
    const { references, collect } = controlledCollection();
    const cache = new ValueSetCache();
    cache.sourceContexts.runWith(context, () => {
      const frozen = Object.freeze(definition());
      cache.setCodeSystem(system, frozen); cache.setCodeSystemFile(system, frozen);
      cache.setValueSetFile(canonical, Object.freeze({ resourceType: 'ValueSet', url: canonical }));
      cache.setCodeSystemFile('missing', null);
      expect(cache.getCodeSystem(system)).toBe(frozen);
      expect(references).toHaveLength(3);
      collect();
      expect(cache.hasCodeSystem(system)).toBe(false);
      expect(cache.hasCodeSystemFile(system)).toBe(false);
      expect(cache.hasValueSetFile(canonical)).toBe(false);
      expect(cache.getCodeSystemFile('missing')).toBeNull();
      cache.clearNegativeEntries(); expect(cache.hasCodeSystemFile('missing')).toBe(false);
    });
  });

  it('preserves bounded LRU eviction and explicit invalidation', () => {
    controlledCollection();
    const cache = new CollectableDefinitionCache<CodeSystem>(2);
    const frozen = Object.freeze(definition());
    cache.set('a', frozen, true); cache.set('b', null);
    expect(cache.get('a')).toBe(frozen);
    cache.set('c', frozen, true);
    expect([...cache.keys()]).toEqual(['a', 'c']); expect(cache.has('b')).toBe(false);
    cache.delete('a'); expect(cache.size).toBe(1);
    cache.clear(); expect(cache.size).toBe(0);
  });

  it('keeps snapshot, tenant, server, FHIR and business editions isolated', () => {
    controlledCollection();
    const cache = new ValueSetCache();
    const frozen = Object.freeze(definition());
    cache.sourceContexts.runWith(context, () => cache.setCodeSystem(`${system}|1`, frozen));
    for (const other of [{ ...context, organizationId: 74 }, { ...context, serverId: 10 },
      { ...context, fhirVersion: 'R5' as const }, { ...context, terminologySnapshotSha256: 'b'.repeat(64) }]) {
      cache.sourceContexts.runWith(other, () => expect(cache.getCodeSystem(`${system}|1`)).toBeUndefined());
    }
    cache.sourceContexts.runWith(context, () => {
      expect(cache.getCodeSystem(`${system}|1`)).toBe(frozen);
      expect(cache.getCodeSystem(`${system}|2`)).toBeUndefined();
    });
  });

  it('keeps explicitly registered definitions strongly owned until invalidation', () => {
    const { references, collect } = controlledCollection();
    const cache = new ValueSetCache();
    const frozen = Object.freeze(definition());
    cache.sourceContexts.runWith(context, () => {
      cache.registerResource('CodeSystem', system, '1', 'R4', frozen);
      collect();
      expect(references).toHaveLength(0);
      expect(cache.getCodeSystem(`${system}|1`)).toBe(frozen);
      cache.clear(); expect(cache.getCodeSystem(`${system}|1`)).toBeUndefined();
    });
  });

  it('dereferences before dependency capture and preserves detached reads and evidence hashes', async () => {
    const { collect } = controlledCollection();
    const cache = new ValueSetCache();
    const capture = () => cache.sourceContexts.runWith(context, async () => {
      const snapshot = createValidationDependencySnapshot({ requireProfileLookup: false });
      await snapshot.run(async () => {
        const first = cache.getCodeSystem(system)!;
        first.concept![0].code = 'mutated';
        expect(cache.getCodeSystem(system)?.concept?.[0].code).toBe('present');
      });
      return snapshot.evidence();
    });
    cache.sourceContexts.runWith(context, () => cache.setCodeSystem(system, Object.freeze(definition())));
    const warm = await capture();
    collect();
    cache.sourceContexts.runWith(context, () => {
      expect(cache.getCodeSystem(system)).toBeUndefined();
      cache.setCodeSystem(system, Object.freeze(definition()));
    });
    expect(await capture()).toEqual(warm);
    expect(warm).toMatchObject({ status: 'captured', terminologyCount: 1 });
  });

  it('reloads collected catalogs from the same closed source and preserves binding outcomes', async () => {
    const { collect } = controlledCollection();
    const source = vi.fn(async (url: string, type: string) => {
      if (url.includes('meddra')) return null;
      return Object.freeze(type === 'ValueSet' ? { resourceType: 'ValueSet', url: canonical,
        compose: { include: [{ system, version: '1' }] } } : definition());
    });
    setProfileSource({ findCanonicalResource: source });
    const cache = new ValueSetCache();
    const loader = new ValueSetPackageLoader(cache, new ValueSetPackageResourceAccess([]));
    loader.setSourceContext(context);
    const validator = new ValueSetValidator(cache, undefined, []);
    validator.setSourceContext(context); validator.setResolutionConfig({ strategy: 'local-only' });
    for (const phase of ['cold', 'warm', 'collected']) {
      if (phase === 'collected') collect();
      expect(await loader.loadCodeSystem(system, 'R4', '1')).toEqual(definition());
      expect(await validator.resolveCodeBindingForBinding('present', system, canonical, 'required')).toBe('valid');
      expect(await validator.resolveCodeBindingForBinding('absent', system, canonical, 'required')).toBe('invalid');
      expect(await validator.resolveCodeBindingForBinding('absent', system, 'https://example.test/meddra', 'required')).toBe('unverified');
    }
    expect(source.mock.calls.filter(([, type]) => type === 'CodeSystem')).toHaveLength(2);
    expect(source.mock.calls.every(call => call[0].startsWith('https://example.test/'))).toBe(true);
  });
});
