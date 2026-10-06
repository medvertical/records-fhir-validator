import { describe, expect, it, vi } from 'vitest';
import { resolveVersionedLocalBinding } from '../valueset-versioned-local-binding.js';
import type { CodeSystem, ValueSet, ValueSetComposeInclude } from '../valueset-types.js';

const system = 'https://example.test/CodeSystem/coverage';
const url = 'https://example.test/ValueSet/coverage';
function harness(include: ValueSetComposeInclude[] = [{ system }], exclude?: ValueSetComposeInclude[]) {
  const codeSystem: CodeSystem = { resourceType: 'CodeSystem', url: system, version: '1.02', content: 'complete', concept: [{ code: '1' }, { code: '2' }] };
  const valueSet: ValueSet = { resourceType: 'ValueSet', url, version: '2.0.0', status: 'active', compose: { include, exclude } };
  const loader = {
    loadCodeSystem: vi.fn(async () => codeSystem as CodeSystem | null),
    loadValueSetResource: vi.fn(async (_reference: string) => valueSet as ValueSet | null),
  };
  return { codeSystem, valueSet, loader, resolve: (reference = url, code = '1') =>
    resolveVersionedLocalBinding(loader, code, system, '1.02', reference, 'R4') };
}

describe('exact local CodeSystem versions in ValueSet bindings', () => {
  it('verifies a code against the exact CodeSystem even when the ValueSet version differs', async () => {
    const check = harness();
    await expect(check.resolve(`${url}|2.0.0`)).resolves.toBe('valid');
    expect(check.loader.loadCodeSystem).toHaveBeenCalledWith(system, '4', '1.02');
  });
  it.each(['1.01', undefined])('does not confirm a code using CodeSystem version %s', async version => {
    const check = harness(); check.codeSystem.version = version;
    await expect(check.resolve()).resolves.toBe('unverified');
  });
  it.each(['not-present', 'supplement'] as const)('does not infer membership from %s content', async content => {
    const check = harness(); check.codeSystem.content = content;
    await expect(check.resolve()).resolves.toBe('unverified');
  });
  it('does not confuse CodeSystem membership with ValueSet membership', async () => {
    await expect(harness([{ system, concept: [{ code: '2' }] }]).resolve()).resolves.toBe('invalid');
    await expect(harness([{ system: 'https://example.test/other' }]).resolve()).resolves.toBe('invalid');
    await expect(harness([{ system, version: '1.01' }]).resolve()).resolves.toBe('invalid');
  });
  it('honors exclusions and intersections of imported ValueSets', async () => {
    await expect(harness([{ system }], [{ system, concept: [{ code: '1' }] }]).resolve()).resolves.toBe('invalid');
    const check = harness([{ system, valueSet: [`${url}-nested`] }]);
    check.loader.loadValueSetResource.mockImplementation(async reference => reference === url ? check.valueSet : {
      ...check.valueSet, url: `${url}-nested`, compose: { include: [{ system, concept: [{ code: '2' }] }] },
    });
    await expect(check.resolve()).resolves.toBe('invalid');
    await expect(check.resolve(url, '2')).resolves.toBe('valid');
  });
  it('keeps unresolved exclusions, imports, filters, cycles and mismatched ValueSet versions unverified', async () => {
    const excluded = harness([{ system }], [{ valueSet: [`${url}-missing`] }]);
    excluded.loader.loadValueSetResource.mockImplementation(async reference => reference === url ? excluded.valueSet : null);
    await expect(excluded.resolve()).resolves.toBe('unverified');
    await expect(harness([{ valueSet: [url] }]).resolve()).resolves.toBe('unverified');
    await expect(harness([{ system, filter: [{ property: 'opaque', op: '=', value: '1' }] }]).resolve()).resolves.toBe('unverified');
    await expect(harness().resolve(`${url}|1.0.0`)).resolves.toBe('unverified');
  });
  it('does not use a versionless expansion as proof', async () => {
    const check = harness(); check.valueSet.compose = undefined;
    check.valueSet.expansion = { contains: [{ system, code: '1' }] };
    await expect(check.resolve()).resolves.toBe('unverified');
  });
  it('preserves unknown codes as unverified when the exact CodeSystem does not contain them', async () => {
    await expect(harness().resolve(url, 'missing')).resolves.toBe('unverified');
  });
  it('accepts a listed concept but leaves an unlisted one unverified without the exact CodeSystem release', async () => {
    const listed = harness([{ system, version: '1.00', concept: [{ code: '1' }] }]);
    listed.loader.loadCodeSystem.mockResolvedValue(null);
    await expect(listed.resolve()).resolves.toBe('valid');
    await expect(listed.resolve(url, '2')).resolves.toBe('unverified');
  });
  it('keeps a list without a pinned release unverified for a release that is not at hand', async () => {
    const unpinned = harness([{ system, concept: [{ code: '1' }] }]);
    unpinned.loader.loadCodeSystem.mockResolvedValue(null);
    await expect(unpinned.resolve()).resolves.toBe('unverified');
  });
  it('keeps whole-system and filtered includes unverified without the exact release', async () => {
    const whole = harness([{ system }]);
    whole.loader.loadCodeSystem.mockResolvedValue(null);
    await expect(whole.resolve()).resolves.toBe('unverified');
    const filtered = harness([{ system, concept: [{ code: '1' }] }, { system, filter: [{ property: 'concept', op: 'is-a', value: '2' }] }]);
    filtered.loader.loadCodeSystem.mockResolvedValue(null);
    await expect(filtered.resolve(url, '3')).resolves.toBe('unverified');
  });
});
