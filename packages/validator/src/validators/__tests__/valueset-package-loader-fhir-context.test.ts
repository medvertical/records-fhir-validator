import { versionedCacheKey } from '../valueset-package-utils.js';
import { createHash } from 'node:crypto';
import { readFileSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValueSetCache } from '../valueset-cache';
import { ValueSetPackageLoader } from '../valueset-package-loader';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access';
import { ValueSetValidator } from '../valueset-validator';
import { clearPackageCanonicalIndex } from '../valueset-package-search';
import type { CodeSystem, ValueSet } from '../valueset-types';

const fixtureUrl = new URL('./fixtures/fhir-publication-context/', import.meta.url);
const metadata = JSON.parse(readFileSync(new URL('metadata-manifest.json', fixtureUrl), 'utf8')) as {
  entries: Array<{ id: string; file: string; sha256: string; packageDirectory: string; packageVersion: string;
    fhirVersions: string[]; codeSystemBusinessVersion: string; conceptCodes: string[] }>;
};
const definitions = new Map(metadata.entries.map(entry => [entry.id,
  JSON.parse(readFileSync(new URL(entry.file, fixtureUrl), 'utf8')) as CodeSystem]));
const canonical = 'https://example.test/ValueSet/publication-context';
const system = 'http://hl7.org/fhir/encounter-status';
const roots: string[] = [];
const wrapper = (version = '2026.1.0', include: { system: string; version?: string } = { system }): ValueSet => ({
  resourceType: 'ValueSet', url: canonical, version, status: 'active', compose: { include: [include] },
});

async function put(root: string, packageDirectory: string, filename: string, resource: unknown): Promise<void> {
  const directory = path.join(root, packageDirectory, 'package');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, filename), JSON.stringify(resource));
}

async function harness(valueSet: ValueSet = wrapper(), systems = ['r4', 'r5', 'tho']) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-fhir-context-'));
  roots.push(root);
  for (const id of systems) {
    const entry = metadata.entries.find(candidate => candidate.id === id)!;
    const resource = definitions.get(id)!;
    await put(root, entry.packageDirectory, `CodeSystem-${resource.url.split('/').pop()}.json`, resource);
  }
  await put(root, 'example.context#1.0.0', 'ValueSet-publication-context.json', valueSet);
  const cache = new ValueSetCache();
  const access = new ValueSetPackageResourceAccess([root]);
  const loader = new ValueSetPackageLoader(cache, access);
  return { root, cache, access, loader, valueSet };
}

const qualifiedCodes = (definition: CodeSystem) => (definition.concept ?? []).map(concept => `${definition.url}|${concept.code}`);
const actualQualified = (codes: string[] | null) => (codes ?? []).filter(code => code.includes('|')).sort();
const expectedQualified = (id: string) => qualifiedCodes(definitions.get(id)!).sort();

afterEach(async () => {
  vi.restoreAllMocks();
  clearPackageCanonicalIndex();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('FHIR publication context is independent of terminology business versions', () => {
  it.each(metadata.entries)('pins original $id CodeSystem bytes and publication metadata', entry => {
    const bytes = readFileSync(new URL(entry.file, fixtureUrl));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    expect(definitions.get(entry.id)?.version).toBe(entry.codeSystemBusinessVersion);
    expect((definitions.get(entry.id)?.concept ?? []).map(concept => concept.code)).toEqual(entry.conceptCodes);
    expect(entry.fhirVersions).toEqual(entry.id === 'r5' ? ['5.0.0'] : ['4.0.1']);
    if (entry.id === 'tho') {
      expect(entry.packageVersion).toBe('7.2.0');
      expect(entry.codeSystemBusinessVersion).toBe('2.0.0');
    }
  });

  it.each(['4.0.1', '5.0.0', '2026.1.0'].flatMap(businessVersion =>
    (['R4', 'R5'] as const).flatMap(fhirVersion => ['codes', 'resource-first'].map(entry =>
      ({ businessVersion, fhirVersion, entry }))),
  ))('uses $fhirVersion context for business $businessVersion through $entry cold and warm paths', async row => {
    const { loader, access, cache } = await harness(wrapper(row.businessVersion));
    const requested = `${canonical}|${row.businessVersion}`;
    const resourceCalls = vi.spyOn(access, 'findResource');
    const codeCalls = vi.spyOn(loader, 'loadCodeSystem');
    if (row.entry === 'resource-first') {
      expect((await loader.loadValueSetResource(requested, row.fhirVersion))?.version).toBe(row.businessVersion);
    }
    for (let warm = 0; warm < 2; warm++) {
      expect(actualQualified(await loader.loadValueSet(requested, row.fhirVersion)))
        .toEqual(expectedQualified(row.fhirVersion === 'R4' ? 'r4' : 'r5'));
    }
    expect(resourceCalls.mock.calls.find(call => call[2] === 'ValueSet')?.slice(3))
      .toEqual([row.fhirVersion === 'R4' ? '4' : '5', row.businessVersion]);
    expect(codeCalls).toHaveBeenCalledWith(system, row.fhirVersion === 'R4' ? '4' : '5', undefined);
    expect(cache.sourceContexts.run(row.fhirVersion, () => cache.getValueSetFile(versionedCacheKey(canonical, row.businessVersion, row.fhirVersion))?.version)).toBe(row.businessVersion);
  });

  it.each(['4.0.1', '5.0.0', '2026.1.0'])('keeps publication preference unset without context for business %s', async version => {
    const { loader, access } = await harness(wrapper(version));
    const resourceCalls = vi.spyOn(access, 'findResource');
    const codeCalls = vi.spyOn(loader, 'loadCodeSystem');
    expect(actualQualified(await loader.loadValueSet(`${canonical}|${version}`))).toEqual(expectedQualified('r5'));
    expect(resourceCalls.mock.calls.find(call => call[2] === 'ValueSet')?.slice(3)).toEqual([undefined, version]);
    expect(codeCalls).toHaveBeenCalledWith(system, undefined, undefined);
  });

  it.each((['R4', 'R5'] as const).flatMap(sourceVersion => [false, true].map(explicit => ({ sourceVersion, explicit }))))(
    'uses native source $sourceVersion context, with explicit override $explicit', async ({ sourceVersion, explicit }) => {
      const { loader } = await harness();
      loader.setSourceContext({ organizationId: 73, fhirVersion: sourceVersion });
      const effective = explicit ? sourceVersion === 'R4' ? 'R5' : 'R4' : sourceVersion;
      const fhirVersion = explicit ? effective : undefined;
      const calls = vi.spyOn(loader, 'loadCodeSystem');
      expect(actualQualified(await loader.loadValueSet(`${canonical}|2026.1.0`, fhirVersion)))
        .toEqual(expectedQualified(effective === 'R4' ? 'r4' : 'r5'));
      expect(calls).toHaveBeenCalledWith(system, effective === 'R4' ? '4' : '5', undefined);
    },
  );

  it.each((['4.0.1', '5.0.0'] as const).flatMap(includeVersion => [false, true].map(piped => ({ includeVersion, piped }))))(
    'retains explicit CodeSystem $includeVersion with piped include $piped under opposite publication context', async ({ includeVersion, piped }) => {
      const fhirVersion = includeVersion === '4.0.1' ? 'R5' : 'R4';
      const include = piped ? { system: `${system}|${includeVersion}` } : { system, version: includeVersion };
      const { loader } = await harness(wrapper('2026.1.0', include));
      const calls = vi.spyOn(loader, 'loadCodeSystem');
      expect(actualQualified(await loader.loadValueSet(`${canonical}|2026.1.0`, fhirVersion)))
        .toEqual(expectedQualified(includeVersion === '4.0.1' ? 'r4' : 'r5'));
      expect(calls).toHaveBeenCalledWith(system, fhirVersion === 'R4' ? '4' : '5', includeVersion);
    },
  );

  it('uses genuine THO business version2.0.0 independently of its R4 publication and package7.2.0', async () => {
    const tho = definitions.get('tho')!;
    const { loader } = await harness(wrapper('2026.1.0', { system: tho.url, version: '2.0.0' }));
    const calls = vi.spyOn(loader, 'loadCodeSystem');
    expect(actualQualified(await loader.loadValueSet(`${canonical}|2026.1.0`, 'R4'))).toEqual(expectedQualified('tho'));
    expect(calls).toHaveBeenCalledWith(tho.url, '4', '2.0.0');
    expect((await loader.loadCodeSystem(tho.url, '4', '2.0.0'))?.version).toBe('2.0.0');
  });

  it.each([
    { code: 'finished', available: true, expected: 'valid' },
    { code: 'completed', available: true, expected: 'invalid' },
    { code: 'finished', available: false, expected: 'unverified' },
  ])('keeps required binding $code availability $available as $expected', async ({ code, available, expected }) => {
    const { root } = await harness(wrapper(), available ? ['r4'] : []);
    const validator = new ValueSetValidator(undefined, undefined, [root]);
    validator.setResolutionConfig({ strategy: 'local-only', serverDelegation: {
      expandValueSets: false, validateCodes: false, cacheResults: false, cacheTTLSeconds: 0,
    } });
    expect(await validator.resolveCodeMembership(code, system, `${canonical}|2026.1.0`, 'R4')).toBe(expected);
  });

  it('counts the declared expansion total using the supplied FHIR context', async () => {
    const valueSet = { ...wrapper(), expansion: { total: 9 } };
    const { loader } = await harness(valueSet, ['r4']);
    expect(await loader.hasIncompleteExpansion(`${canonical}|2026.1.0`, 'R4')).toBe(false);
  });

  it.each(['R4', 'R5'] as const)('preserves %s context across nested ValueSet composition', async fhirVersion => {
    const parent: ValueSet = { ...wrapper(), compose: { include: [{ valueSet: [`${canonical}-child|2040.1.0`] }] } };
    const { loader, root } = await harness(parent);
    await put(root, 'example.context#1.0.0', 'ValueSet-publication-context-child.json',
      { ...wrapper('2040.1.0'), url: `${canonical}-child` });
    const calls = vi.spyOn(loader, 'loadCodeSystem');
    expect(actualQualified(await loader.loadValueSet(`${canonical}|2026.1.0`, fhirVersion)))
      .toEqual(expectedQualified(fhirVersion === 'R4' ? 'r4' : 'r5'));
    expect(calls).toHaveBeenCalledWith(system, fhirVersion === 'R4' ? '4' : '5', undefined);
  });

  it('retains intentional same-business-major ValueSet and CodeSystem fallback', async () => {
    const { loader, cache } = await harness(wrapper(), ['r4']);
    const requested = `${canonical}|2026.1.9`;
    expect((await loader.loadValueSetResource(requested, 'R4'))?.version).toBe('2026.1.0');
    expect(cache.sourceContexts.run('R4', () => cache.getValueSetFile(versionedCacheKey(canonical, '2026.1.9', 'R4'))?.version)).toBe('2026.1.0');
    expect(actualQualified(await loader.loadValueSet(requested, 'R4'))).toEqual(expectedQualified('r4'));
    expect((await loader.loadCodeSystem(system, '4', '4.0.9'))?.version).toBe('4.0.1');
  });

  it('keeps cross-business-major absence unverified', async () => {
    const { loader, root } = await harness(wrapper(), ['r4']);
    expect(await loader.loadValueSetResource(`${canonical}|2027.1.0`, 'R4')).toBeNull();
    const validator = new ValueSetValidator(undefined, undefined, [root]);
    validator.setResolutionConfig({ strategy: 'local-only', serverDelegation: {
      expandValueSets: false, validateCodes: false, cacheResults: false, cacheTTLSeconds: 0,
    } });
    expect(await validator.resolveCodeMembership('finished', system, `${canonical}|2027.1.0`, 'R4')).toBe('unverified');
  });

  it('preserves the existing same-major R4/R4B neighbor policy with explicitly synthetic4.3 metadata', async () => {
    const { loader, root } = await harness(wrapper(), []);
    const syntheticNeighbor = { ...definitions.get('r4')!, version: '4.3.0' };
    await put(root, 'hl7.fhir.r4b.core#4.3.0', 'CodeSystem-encounter-status.json', syntheticNeighbor);
    expect((await loader.loadCodeSystem(system, '4', '4.0.1'))?.version).toBe('4.3.0');
  });
});


describe('publication context independent safety controls', () => {
  it.each(['R4', 'R5'] as const)('extracts direct business2026 metadata under explicit %s context', async fhirVersion => {
    const { loader, valueSet } = await harness();
    expect(actualQualified(await loader.extractCodesFromValueSet(valueSet, fhirVersion)))
      .toEqual(expectedQualified(fhirVersion === 'R4' ? 'r4' : 'r5'));
  });

  it.each(['R4', 'R5'] as const)('rejects the opposite publication-only code through cold and warm %s binding', async fhirVersion => {
    const { root } = await harness();
    const validator = new ValueSetValidator(undefined, undefined, [root]);
    validator.setResolutionConfig({ strategy: 'local-only', serverDelegation: {
      expandValueSets: false, validateCodes: false, cacheResults: false, cacheTTLSeconds: 0,
    } });
    const code = fhirVersion === 'R4' ? 'completed' : 'finished';
    for (let warm = 0; warm < 2; warm++) {
      expect(await validator.resolveCodeMembership(code, system, `${canonical}|2026.1.0`, fhirVersion))
        .toBe('invalid');
    }
  });

  it.each(['R4', 'R5'] as const)('preserves explicit publication context through %s to the other publication and back', async initial => {
    const { loader } = await harness();
    const other = initial === 'R4' ? 'R5' : 'R4';
    for (const fhirVersion of [initial, other, initial] as const) {
      expect(actualQualified(await loader.loadValueSet(`${canonical}|2026.1.0`, fhirVersion)))
        .toEqual(expectedQualified(fhirVersion === 'R4' ? 'r4' : 'r5'));
    }
  });

  it.each(['R4', 'R5'] as const)('keeps a wrong core publication unavailable under explicit %s context', async fhirVersion => {
    const available = fhirVersion === 'R4' ? 'r5' : 'r4';
    const { loader, root } = await harness(wrapper(), [available]);
    expect(actualQualified(await loader.loadValueSet(`${canonical}|2026.1.0`, fhirVersion))).toEqual([]);
    expect(await loader.getUnenumerableSystemIncludes(`${canonical}|2026.1.0`, fhirVersion)).toEqual([system]);
    const validator = new ValueSetValidator(undefined, undefined, [root]);
    validator.setResolutionConfig({ strategy: 'local-only', serverDelegation: {
      expandValueSets: false, validateCodes: false, cacheResults: false, cacheTTLSeconds: 0,
    } });
    expect(await validator.resolveCodeMembership('in-progress', system, `${canonical}|2026.1.0`, fhirVersion))
      .toBe('unverified');
  });
});


describe('unversioned ValueSet context changes use distinct release definitions', () => {
  it.each((['R4', 'R5'] as const).flatMap(initial => [false, true].map(explicit => ({ initial, explicit }))))(
    'keeps $initial to the other context and back with explicit override $explicit', async ({ initial, explicit }) => {
      const { loader, root } = await harness();
      await fs.rm(path.join(root, 'example.context#1.0.0/package/ValueSet-publication-context.json'));
      for (const release of ['r4', 'r5']) {
        const entry = metadata.entries.find(row => row.id === release)!;
        const code = release === 'r4' ? 'finished' : 'completed';
        await put(root, entry.packageDirectory, 'ValueSet-publication-context.json', {
          ...wrapper(release === 'r4' ? '4.0.1' : '5.0.0'),
          compose: { include: [{ system, concept: [{ code }] }] },
        });
      }
      const other = initial === 'R4' ? 'R5' : 'R4';
      for (const fhirVersion of [initial, other, initial] as const) {
        if (!explicit) loader.setSourceContext({ organizationId: 73, fhirVersion });
        expect(actualQualified(await loader.loadValueSet(canonical, explicit ? fhirVersion : undefined)))
          .toEqual([`${system}|${fhirVersion === 'R4' ? 'finished' : 'completed'}`]);
      }
    },
  );
});
