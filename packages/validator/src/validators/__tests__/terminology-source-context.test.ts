import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setProfileSource, type ProfileSourceContext } from '../../persistence';
import { validateCodeSystemReference } from '../../core/executors/terminology-code-system-reference-rules';
import { TerminologyApiClient } from '../terminology-api-client';
import { RecordsValidator } from '../../core/validator-engine';
import type { StructureDefinition } from '../../core/structure-definition-types';
import { TerminologyRequestBroker } from '../terminology-request-broker';
import { canonicalPinCacheKey, withPinnedCanonicalSource } from '../../package/canonical-pin-scope';
import { ValueSetCache } from '../valueset-cache';
import { ValueSetPackageLoader } from '../valueset-package-loader';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access';
import { ValueSetValidator } from '../valueset-validator';
import { createMemberOfFunction } from '../fhirpath-custom-functions';
import { loadInlineValueSet } from '../valueset-inline-definition';

const canonical = 'https://example.test/ValueSet/scoped';
const system = 'https://example.test/CodeSystem/scoped';
const version = '2026.1.0';
const requested = `${canonical}|${version}`;
const a: ProfileSourceContext = { organizationId: 73, serverId: 9, fhirVersion: 'R4' };
const b: ProfileSourceContext = { organizationId: 74, serverId: 10, fhirVersion: 'R5' };
const rows = [
  { axis: 'fhir-source', second: { ...a, fhirVersion: 'R5' as const }, explicit: false },
  { axis: 'fhir-explicit', second: { ...a, fhirVersion: 'R5' as const }, explicit: true },
  { axis: 'tenant', second: { ...a, organizationId: 74 }, explicit: false },
  { axis: 'server', second: { ...a, serverId: 10 }, explicit: false },
];
function codeFor(context?: ProfileSourceContext) {
  return context?.organizationId === 73 && context?.serverId === 9 && context?.fhirVersion === 'R4' ? 'a' : 'b';
}
function valueSet(url = canonical, code = 'a') {
  return { resourceType: 'ValueSet' as const, url, version, status: 'active', compose: { include: [{ system, concept: [{ code }] }] } };
}
function installSource() {
  const calls: Array<{ url: string; resourceType: string; version?: string; context?: ProfileSourceContext }> = [];
  setProfileSource({ findCanonicalResource: async (url, resourceType, requestedVersion, context) => {
    calls.push({ url, resourceType, version: requestedVersion, context: context ? { ...context } : undefined });
    if (url.endsWith('/missing')) return null;
    return resourceType === 'ValueSet' ? valueSet(url, codeFor(context))
      : { resourceType: 'CodeSystem', url, version, status: 'active', content: 'complete', concept: [{ code: codeFor(context) }] };
  } });
  return calls;
}
function loader(cache = new ValueSetCache()) { return new ValueSetPackageLoader(cache, new ValueSetPackageResourceAccess([])); }
function validator(cache = new ValueSetCache()) {
  const result = new ValueSetValidator(cache, undefined, []);
  result.setResolutionConfig({ strategy: 'local-only' });
  return result;
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
afterEach(() => { setProfileSource({}); vi.restoreAllMocks(); });

describe('request-owned terminology contexts', () => {
  it.each(rows)('keeps identical canonical and business version separate for $axis through warm and clear', async row => {
    const calls = installSource(); const cache = new ValueSetCache(); const loaded = loader(cache);
    for (const context of [a, row.second, a]) {
      loaded.setSourceContext(context);
      const explicit = row.explicit ? context.fhirVersion : undefined;
      const cold = loader(); cold.setSourceContext(context);
      expect(await loaded.loadValueSet(requested, explicit)).toEqual(await cold.loadValueSet(requested, explicit));
      expect(await loaded.loadValueSet(requested, explicit)).toContain(`${system}|${codeFor(context)}`);
    }
    cache.clear(); loaded.clearLookupState();
    expect(await loaded.loadValueSet(requested)).toContain(`${system}|a`);
    expect(calls.filter(call => call.resourceType === 'ValueSet').every(call => call.version === version)).toBe(true);
  });

  it.each(rows)('preserves valid, invalid, and unverified binding outcomes across $axis', async row => {
    installSource(); const checked = validator();
    for (const context of [a, row.second, a]) {
      checked.setSourceContext(context);
      const explicit = row.explicit ? context.fhirVersion : undefined;
      expect(await checked.resolveCodeBindingForBinding(codeFor(context), system, requested, 'required', explicit)).toBe('valid');
      expect(await checked.resolveCodeBindingForBinding('absent', system, requested, 'required', explicit)).toBe('invalid');
      expect(await checked.resolveCodeBindingForBinding('absent', system, `${canonical}/missing|${version}`, 'required', explicit)).toBe('unverified');
    }
  });

  it.each(['fhir', 'tenant', 'server'].flatMap(axis => [false, true].map(distinct => ({ axis, distinct }))))('retains A during overlapping $axis requests with distinct=$distinct', async row => {
    const second = row.axis === 'fhir' ? { ...a, fhirVersion: 'R5' as const }
      : row.axis === 'tenant' ? { ...a, organizationId: 74 } : { ...a, serverId: 10 };
    const entered = gate(); const resume = gate(); let first = true;
    const calls: ProfileSourceContext[] = [];
    setProfileSource({ findCanonicalResource: async (url, resourceType, _version, context) => {
      if (resourceType === 'ValueSet') {
        if (first) { first = false; entered.resolve(); await resume.promise; }
        return { ...valueSet(url), compose: { include: [{ system: row.distinct ? url.replace('/ValueSet/', '/CodeSystem/') : system }] } };
      }
      calls.push({ ...context });
      return { resourceType, url, content: 'complete', concept: [{ code: codeFor(context) }] };
    } });
    const loaded = loader(); loaded.setSourceContext(a);
    const pendingA = loaded.loadValueSet(requested, 'R4'); await entered.promise;
    loaded.setSourceContext(second);
    expect(await loaded.loadValueSet(row.distinct ? `${canonical}-b|${version}` : requested, second.fhirVersion)).toContain('b');
    resume.resolve(); expect(await pendingA).toContain('a');
    expect(calls).toContainEqual(a);
    expect(calls).toContainEqual(second);
  });

  it('pins the actual host and revision throughout an awaiting request, then uses the replacement for new work', async () => {
    const entered = gate(); const resume = gate(); let first = true;
    setProfileSource({ findCanonicalResource: async (url, resourceType) => {
      if (resourceType === 'ValueSet') {
        if (first) { first = false; entered.resolve(); await resume.promise; }
        return { ...valueSet(url), compose: { include: [{ system }] } };
      }
      return { resourceType, url, content: 'complete', concept: [{ code: 'original' }] };
    } });
    const loaded = loader(); loaded.setSourceContext(a);
    const pending = loaded.loadValueSet(requested); await entered.promise;
    setProfileSource({ findCanonicalResource: async (url, resourceType) => resourceType === 'ValueSet'
      ? valueSet(url, 'replacement') : { resourceType, url, content: 'complete', concept: [{ code: 'replacement' }] } });
    resume.resolve(); expect(await pending).toContain('original');
    expect(await loaded.loadValueSet(requested)).toContain('replacement');
  });

  it('keeps source misses separate and clears them without changing the requested business version', async () => {
    const calls = installSource(); const cache = new ValueSetCache(); const loaded = loader(cache);
    loaded.setSourceContext(a); expect(await loaded.loadCodeSystem(`${system}/missing`, '4', version)).toBeNull();
    loaded.setSourceContext(b); expect(await loaded.loadCodeSystem(system, '5', version)).toMatchObject({ concept: [{ code: 'b' }] });
    loaded.setSourceContext(a); expect(await loaded.loadCodeSystem(`${system}/missing`, '4', version)).toBeNull();
    cache.clear(); loaded.clearLookupState();
    expect(await loaded.loadCodeSystem(system, '4', version)).toMatchObject({ concept: [{ code: 'a' }] });
    expect(calls.every(call => call.version === version || call.version === undefined)).toBe(true);
  });

  it.each([false, true])('shares the scoped expansion with synchronous memberOf explicit=%s, and does not publish a plain alias', async explicit => {
    installSource(); const cache = new ValueSetCache(); const checked = validator(cache);
    for (const context of [a, b, a]) {
      checked.setSourceContext(context); await checked.prewarmValueSet(requested);
      expect(await checked.resolveCodeBindingForBinding(codeFor(context), system, requested, 'required', explicit ? context.fhirVersion : undefined)).toBe('valid');
      expect(checked.withSourceContext(context, () => createMemberOfFunction(cache).fn([{ code: codeFor(context), system }], [requested]))).toEqual([true]);
      expect(checked.withSourceContext(context, () => createMemberOfFunction(cache).fn([{ code: 'absent', system }], [requested]))).toEqual([false]);
    }
    expect(createMemberOfFunction(cache).fn([{ code: 'a', system }], [requested])).toEqual([]);
  });

  it('keeps intentionally seeded plain caches compatible outside production host scopes', () => {
    const cache = new ValueSetCache(); validator(cache);
    cache.setExpandedCodes(requested, new Set([`${system}|a`]));
    expect(createMemberOfFunction(cache).fn([{ code: 'a', system }], [requested])).toEqual([true]);
    installSource();
    expect(cache.sourceContexts.runWith(a, () => createMemberOfFunction(cache).fn([{ code: 'a', system }], [requested]))).toEqual([]);
  });

  it('preserves complete inline definitions and nested business version identity across host contexts', async () => {
    setProfileSource({ findCanonicalResource: async (url, resourceType, requestedVersion, context) => {
      if (resourceType !== 'ValueSet' || requestedVersion !== version) return null;
      return url === canonical ? { ...valueSet(), compose: { include: [{ valueSet: [`${canonical}-nested|${version}`] }] } }
        : valueSet(url, codeFor(context));
    } });
    const loaded = loader();
    for (const context of [a, b, a]) {
      loaded.setSourceContext(context);
      const inline = await loadInlineValueSet(loaded, requested, context.fhirVersion);
      expect(inline).toMatchObject({ url: canonical, version, compose: { include: [{ valueSet: ['#vs-1'] }] }, contained: [{ version, compose: { include: [{ system, concept: [{ code: codeFor(context) }] }] } }] });
    }
    expect(await loadInlineValueSet(loaded, `${canonical}|2099.0.0`, 'R4')).toBeUndefined();
  });

  it('registers external definitions by explicit runtime and FHIR family without guessing tenant identity', async () => {
    const cache = new ValueSetCache(); const checked = validator(cache);
    checked.registerExternalTerminologyResource(valueSet(canonical, 'r4'), 'R4');
    checked.registerExternalTerminologyResource(valueSet(canonical, 'r5'), 'R5');
    for (const context of [a, b, a]) {
      checked.setSourceContext(context);
      const wanted = context.fhirVersion === 'R4' ? 'r4' : 'r5';
      expect(await checked.resolveCodeBindingForBinding(wanted, system, requested, 'required', context.fhirVersion)).toBe('valid');
      expect(await checked.resolveCodeBindingForBinding('wrong', system, requested, 'required', context.fhirVersion)).toBe('invalid');
    }
    checked.registerExternalTerminologyResource(valueSet(canonical, 'replacement'), 'R4');
    expect(await checked.resolveCodeBindingForBinding('replacement', system, requested, 'required', 'R4')).toBe('valid');
    expect(await checked.resolveCodeBindingForBinding('r4', system, requested, 'required', 'R4')).toBe('invalid');
    expect(await validator().resolveCodeBindingForBinding('r4', system, requested, 'required', 'R4')).toBe('unverified');
    checked.clearCache(); expect(await checked.resolveCodeBindingForBinding('r4', system, requested, 'required', 'R4')).toBe('unverified');
  });

  it.each(['host', 'registered'] as const)('separates requested business versions named R4/R5 from unversioned FHIR cache selectors for %s', async source => {
    const cache = new ValueSetCache(); const checked = validator(cache); const loaded = new ValueSetPackageLoader(cache, new ValueSetPackageResourceAccess([]));
    if (source === 'host') setProfileSource({ findCanonicalResource: async (url, resourceType, requestedVersion) => resourceType === 'ValueSet'
      ? { ...valueSet(url, requestedVersion ?? 'latest'), version: requestedVersion ?? '2026.1.0' }
      : { resourceType, url, content: 'complete', version: requestedVersion ?? '2026.1.0', concept: [{ code: requestedVersion ?? 'latest' }] } });
    else {
      for (const business of ['R4', 'R5', '2026.1.0']) {
        const code = business === '2026.1.0' ? 'latest' : business;
        checked.registerExternalTerminologyResource({ ...valueSet(canonical, code), version: business }, 'R4');
        checked.registerExternalTerminologyResource({ resourceType: 'CodeSystem', url: system, version: business, content: 'complete', concept: [{ code }] }, 'R4');
      }
    }
    loaded.setSourceContext(a);
    for (const business of [undefined, 'R4', undefined, 'R5', 'R4', undefined]) {
      const actual = await loaded.loadValueSet(business ? `${canonical}|${business}` : canonical, 'R4');
      expect(actual).toContain(`${system}|${business ?? 'latest'}`);
      expect(actual).not.toContain(`${system}|${business ? 'latest' : 'R4'}`);
      expect((await loaded.loadCodeSystem(system, '4', business))?.concept).toEqual([{ code: business ?? 'latest' }]);
      expect(await checked.resolveCodeBindingForBinding(business ?? 'latest', system, business ? `${canonical}|${business}` : canonical, 'required', 'R4')).toBe('valid');
    }
    if (source === 'registered') expect(await loaded.loadValueSet(`${canonical}|R6`, 'R4')).toBeNull();
  });

  it('preserves canonical package pin ownership for external registration', async () => {
    const checked = validator(); checked.registerExternalTerminologyResource(valueSet(), 'R4');
    expect(await checked.resolveCodeBindingForBinding('a', system, requested, 'required', 'R4')).toBe('valid');
    const result = await withPinnedCanonicalSource({ canonical, version, packageDirName: 'other#1.0.0' },
      () => checked.resolveCodeBindingForBinding('a', system, requested, 'required', 'R4'));
    expect(result).toBe('unverified');
  });

  it.each(['single', 'batch'] as const)('keeps actual RecordsValidator %s entry points scoped through warm context changes', async method => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'records-source-entry-'));
    const profileUrl = 'https://example.test/StructureDefinition/scoped-valueset';
    const profile = { resourceType: 'StructureDefinition', url: profileUrl, name: 'ScopedValueSet', status: 'active', kind: 'resource', type: 'ValueSet', abstract: false, derivation: 'constraint',
      snapshot: { element: [{ id: 'ValueSet', path: 'ValueSet', min: 0, max: '1' }, { id: 'ValueSet.status', path: 'ValueSet.status', min: 1, max: '1', type: [{ code: 'code' }], binding: { strength: 'required', valueSet: requested } }] } } as StructureDefinition;
    installSource();
    setProfileSource({ findByUrl: async () => profile, resolveProfile: async () => profile,
      findCanonicalResource: async (url, resourceType, _version, context) => resourceType === 'ValueSet' ? valueSet(url, codeFor(context)) : null });
    const engine = new RecordsValidator({ packageCachePath: directory, bundledProfilesPath: null, autoDownload: false, prewarmProfileSource: false, terminologyPackageDirectories: [] });
    engine.configureTerminologyResolution({ strategy: 'local-only' });
    const settings = { aspects: { structural: { enabled: false }, profile: { enabled: false }, terminology: { enabled: true }, reference: { enabled: false }, metadata: { enabled: false }, custom_rule: { enabled: false } } };
    try {
      for (const context of [a, b, a]) {
        for (const status of [codeFor(context), 'absent']) {
          const resource = { resourceType: 'ValueSet', status };
          const issues = method === 'single'
            ? await engine.validate(resource, profileUrl, context.fhirVersion, settings as never, undefined, undefined, context.organizationId, context.serverId)
            : [...(await engine.validateBatch([resource], { ...context, profileUrl, aspects: ['terminology'], settings: settings as never })).values()].flatMap(result => Array.isArray(result) ? result : result.aspects.flatMap(aspect => aspect.issues));
          expect(issues.some(issue => issue.code === 'terminology-binding-required-code')).toBe(status === 'absent');
          expect(issues.some(issue => issue.code?.includes('unverified'))).toBe(false);
        }
      }
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  it.each(['single', 'batch'] as const)('keeps the actual %s entry snapshot while another request completes', async method => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'records-source-overlap-'));
    const profileUrl = 'https://example.test/StructureDefinition/scoped-overlap';
    const profile = { resourceType: 'StructureDefinition', url: profileUrl, name: 'ScopedOverlap', status: 'active', kind: 'resource', type: 'ValueSet', abstract: false, derivation: 'constraint',
      snapshot: { element: [{ id: 'ValueSet', path: 'ValueSet', min: 0, max: '1' }, { id: 'ValueSet.status', path: 'ValueSet.status', min: 1, max: '1', type: [{ code: 'code' }], binding: { strength: 'required', valueSet: requested } }] } } as StructureDefinition;
    const entered = gate(); const resume = gate(); let first = true;
    const calls: ProfileSourceContext[] = [];
    setProfileSource({ findByUrl: async () => profile, resolveProfile: async () => profile,
      findCanonicalResource: async (url, resourceType, _version, context) => {
        if (resourceType === 'ValueSet') {
          if (first) { first = false; entered.resolve(); await resume.promise; }
          return { ...valueSet(url), compose: { include: [{ system }] } };
        }
        calls.push({ ...context });
        return { resourceType, url, content: 'complete', concept: [{ code: codeFor(context) }] };
      } });
    const engine = new RecordsValidator({ packageCachePath: directory, bundledProfilesPath: null, autoDownload: false, prewarmProfileSource: false, terminologyPackageDirectories: [] });
    const settings = { aspects: { structural: { enabled: false }, profile: { enabled: false }, terminology: { enabled: true }, reference: { enabled: false }, metadata: { enabled: false }, custom_rule: { enabled: false } } };
    const run = async (context: ProfileSourceContext) => {
      const resource = { resourceType: 'ValueSet', status: codeFor(context) };
      return method === 'single'
        ? engine.validate(resource, profileUrl, context.fhirVersion, settings as never, undefined, undefined, context.organizationId, context.serverId)
        : [...(await engine.validateBatch([resource], { ...context, profileUrl, aspects: ['terminology'], settings: settings as never })).values()].flatMap(result => Array.isArray(result) ? result : result.aspects.flatMap(aspect => aspect.issues));
    };
    try {
      const pending = run(a); await entered.promise;
      expect((await run(b)).some(issue => issue.code?.startsWith('terminology-binding-required'))).toBe(false);
      resume.resolve();
      expect((await pending).some(issue => issue.code?.startsWith('terminology-binding-required'))).toBe(false);
      expect(calls).toContainEqual(a); expect(calls).toContainEqual(b);
    } finally { resume.resolve(); await fs.rm(directory, { recursive: true, force: true }); }
  });

  it('checks a pinned R4 Device display using the actual ValueSet publication when the public FHIR argument is absent', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'records-source-display-'));
    const fixtures = path.join(import.meta.dirname, 'fixtures/fhir-publication-context');
    try {
      for (const release of ['r4', 'r5']) {
        const dest = path.join(directory, `hl7.fhir.${release}.core#${release === 'r4' ? '4.0.1' : '5.0.0'}`, 'package');
        await fs.mkdir(dest, { recursive: true });
        for (const kind of ['manifest', 'codesystem', 'valueset']) {
          await fs.copyFile(path.join(fixtures, `device-${release}-${kind}.json`), path.join(dest,
            kind === 'manifest' ? 'package.json' : `${kind === 'codesystem' ? 'CodeSystem' : 'ValueSet'}-device-nametype.json`));
        }
      }
      const checked = new ValueSetValidator(new ValueSetCache(), undefined, [directory]);
      checked.setResolutionConfig({ strategy: 'local-only' });
      const issues = await checked.validateBinding({ code: 'model-name', system: 'http://hl7.org/fhir/device-nametype', display: 'incorrect' },
        { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/device-nametype|4.0.1' }, 'Device.deviceName.type');
      expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-display-mismatch', severity: 'error' }));
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  it('runs queued remote work under its submitting request and canonical pin instead of the releasing request', async () => {
    const cache = new ValueSetCache(); const broker = new TerminologyRequestBroker();
    const entered = gate(); const resume = gate();
    const first = cache.sourceContexts.runWith(a, () => withPinnedCanonicalSource({ canonical, version, packageDirName: 'a#1.0.0' },
      () => broker.run('same-endpoint', 'valueset-expand', 1, async () => { entered.resolve(); await resume.promise; return cache.sourceContexts.context(); })));
    await entered.promise;
    const second = cache.sourceContexts.runWith(b, () => withPinnedCanonicalSource({ canonical, version, packageDirName: 'b#1.0.0' },
      () => broker.run('same-endpoint', 'valueset-expand', 1, async () => ({ context: cache.sourceContexts.context(), pin: canonicalPinCacheKey('') }))));
    expect(broker.getStats('same-endpoint')).toMatchObject({ queued: 1 });
    resume.resolve(); expect(await first).toEqual(a);
    expect(await second).toEqual({ context: b, pin: JSON.stringify([canonical, version, 'b#1.0.0', '']) });
  });

  it('retains the original host for CodeSystem availability after a delayed canonical lookup', async () => {
    const entered = gate(); const resume = gate(); let first = true;
    let originalCalls = 0, replacementCalls = 0;
    setProfileSource({ findCanonicalResource: async () => {
      if (first) { first = false; entered.resolve(); await resume.promise; }
      return null;
    }, hasCodeSystem: async () => { originalCalls++; return false; } });
    const pending = validateCodeSystemReference({ system, code: 'a' }, 'ValueSet.useContext.value.coding', 0, false, 'not-found', 'R4', a);
    await entered.promise;
    setProfileSource({ hasCodeSystem: async () => { replacementCalls++; return true; } });
    resume.resolve(); await pending;
    expect(originalCalls).toBe(1); expect(replacementCalls).toBe(0);
  });

  it('isolates real remote-operation singleflight and positive/negative result caches by submitting context', async () => {
    const cache = new ValueSetCache(); const entered = gate(); const resume = gate();
    const seen: Array<ProfileSourceContext | undefined> = [];
    const get = vi.spyOn(axios, 'get').mockImplementation(async () => {
      const context = cache.sourceContexts.context(); seen.push(context ? { ...context } : undefined);
      if (seen.length === 1) { entered.resolve(); await resume.promise; }
      return { data: { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: context?.organizationId === 73 }] } } as never;
    });
    const client = new TerminologyApiClient({ serverUrl: 'https://tx.example.test', strategy: 'server-first' }, cache);
    const first = cache.sourceContexts.runWith(a, () => client.validateCodeInCodeSystem('same', system));
    await entered.promise;
    const second = cache.sourceContexts.runWith(b, () => client.validateCodeInCodeSystem('same', system));
    try {
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2), { timeout: 200 });
      expect(await second).toMatchObject({ valid: false });
      resume.resolve(); expect(await first).toMatchObject({ valid: true });
      expect(seen).toEqual([a, b]);
      expect(await cache.sourceContexts.runWith(a, () => client.validateCodeInCodeSystem('same', system))).toMatchObject({ valid: true });
      expect(await cache.sourceContexts.runWith(b, () => client.validateCodeInCodeSystem('same', system))).toMatchObject({ valid: false });
      expect(get).toHaveBeenCalledTimes(2);
    } finally { resume.resolve(); await Promise.allSettled([first, second]); }
  });

});
