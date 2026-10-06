import { describe, expect, it } from 'vitest';
import { copyProfilePackageProvenance, lookupProfilePackageProvenance, recordProfilePackageProvenance } from './canonical-pin-provenance';

const url = 'http://example.org/StructureDefinition/Parent';

describe('profile package origin', () => {
  it('does not infer origin from equal FHIR content or canonical identity', () => {
    const loaded = { url, version: '1' };
    const host = { url, version: '1' };
    recordProfilePackageProvenance(loaded, 'example.owner#2.0.0');
    expect(lookupProfilePackageProvenance(loaded)).toEqual({ name: 'example.owner', version: '2.0.0' });
    expect(lookupProfilePackageProvenance(host)).toBeNull();
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(host));
  });

  it.each([{ url: `${url}-other` }, { version: '2' }])('rejects a copied origin after an identity change: %j', mutation => {
    const loaded = { url, version: '1' };
    recordProfilePackageProvenance(loaded, 'example.owner#1.0.0');
    expect(lookupProfilePackageProvenance({ ...loaded, ...mutation })).toBeNull();
    expect(lookupProfilePackageProvenance(loaded)).toEqual({ name: 'example.owner', version: '1.0.0' });
  });

  it('retains known origin for a profile without a business version', () => {
    const loaded = { url };
    recordProfilePackageProvenance(loaded, 'example.owner#1.0.0');
    expect(lookupProfilePackageProvenance({ ...loaded })).toEqual({ name: 'example.owner', version: '1.0.0' });
    expect(lookupProfilePackageProvenance({ ...loaded, version: '1' })).toBeNull();
  });

  it('does not invent provenance from a malformed package or missing canonical', () => {
    const malformed = { url, version: '1' };
    const unnamed = { version: '1' };
    recordProfilePackageProvenance(malformed, 'not-a-versioned-package');
    recordProfilePackageProvenance(unnamed, 'example.owner#1.0.0');
    expect(lookupProfilePackageProvenance(malformed)).toBeNull();
    expect(lookupProfilePackageProvenance(unnamed)).toBeNull();
  });
});


describe('detached issued origin copies', () => {
  it('copies the same authentic authority across both detachments without changing FHIR content', () => {
    const original = { url, version: '7.0.0' };
    recordProfilePackageProvenance(original, 'example.owner#3.0.0');
    const first = structuredClone(original), second = structuredClone(first);
    copyProfilePackageProvenance(original, first); copyProfilePackageProvenance(first, second);
    expect(lookupProfilePackageProvenance(second)).toBe(lookupProfilePackageProvenance(original));
    expect(JSON.stringify(second)).toBe(JSON.stringify(original));
    expect(Object.keys(second)).toEqual(Object.keys(original));
  });

  it.each([false, true])('preserves an authentic versionless origin (%s)', versionless => {
    const original = { url, ...(versionless ? {} : { version: '7.0.0' }) };
    recordProfilePackageProvenance(original, 'example.owner#3.0.0');
    const copy = structuredClone(original); copyProfilePackageProvenance(original, copy);
    expect(lookupProfilePackageProvenance(copy)).toBe(lookupProfilePackageProvenance(original));
  });

  it.each([
    ['original', { url: `${url}-foreign` }], ['original', { version: 'foreign' }],
    ['copy', { url: `${url}-foreign` }], ['copy', { version: 'foreign' }],
  ])('rejects a changed %s identity %j', (side, mutation) => {
    const original = { url, version: '7.0.0' };
    recordProfilePackageProvenance(original, 'example.owner#3.0.0');
    const copy = structuredClone(original);
    Object.assign(side === 'original' ? original : copy, mutation);
    copyProfilePackageProvenance(original, copy);
    expect(lookupProfilePackageProvenance(copy)).toBeNull();
  });

  it('does not transfer a forged origin, host identity or serialized origin', () => {
    const original = { url, version: '7.0.0' };
    recordProfilePackageProvenance(original, 'example.owner#3.0.0');
    const symbol = Object.getOwnPropertySymbols(original)[0];
    const forged = { url, version: '7.0.0', [symbol]: { url, version: '7.0.0',
      packageRef: { name: 'example.owner', version: '3.0.0' } } };
    for (const source of [forged, { url, version: '7.0.0' }, JSON.parse(JSON.stringify(original))]) {
      const copy = structuredClone(original); copyProfilePackageProvenance(source, copy);
      expect(lookupProfilePackageProvenance(copy)).toBeNull();
    }
  });

  it.each([null, undefined, 'profile', 7, []])('does not interpret nonprofile values as issued authority: %j', value => {
    const profile = { url, version: '7.0.0' };
    recordProfilePackageProvenance(profile, 'example.owner#3.0.0');
    expect(() => copyProfilePackageProvenance(value, {})).not.toThrow();
    expect(() => copyProfilePackageProvenance(profile, value)).not.toThrow();
  });
});
