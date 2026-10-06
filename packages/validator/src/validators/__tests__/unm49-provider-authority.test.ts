import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import jurisdiction from './fixtures/unm49-jurisdiction-valueset.json';
import { builtInProviderSnapshot, providerCodeMembership, providerFilterMembership, assessProviderDisplay,
  scopedProviderSnapshot, validateProviderCode, type ProviderSnapshot, unm49Canonical as system } from '../built-in-terminology-provider.js';
import { ValueSetCache } from '../valueset-cache.js';
import { ValueSetPackageLoader } from '../valueset-package-loader.js';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access.js';
import { ValueSetValidator } from '../valueset-validator.js';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { createValidationDependencySnapshot } from '../../validation-dependency-snapshot.js';
import { isVerifiedCodeSystemResult } from '../code-system-validation-evidence.js';
import { validateCodeInLocalCodeSystem } from '../valueset-local-code-system-validation.js';
import type { CodeSystem, ValueSetComposeInclude } from '../valueset-types.js';
const source = getProfileSource();
const roots: string[] = [];
const region = { property: 'class', op: '=', value: 'region' };
afterEach(async () => { vi.restoreAllMocks(); setProfileSource(source); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function loader() {
  const cache = new ValueSetCache();
  return { cache, packageLoader: new ValueSetPackageLoader(cache, new ValueSetPackageResourceAccess([])) };
}
function validator(include?: ValueSetComposeInclude[], exclude?: ValueSetComposeInclude[]) {
  const instance = new ValueSetValidator(new ValueSetCache(), undefined, []);
  instance.setResolutionConfig({ strategy: 'local-only', reportUnverifiedBindings: true });
  expect(instance.registerExternalTerminologyResource(include ? { ...jurisdiction, compose: { include, exclude } } : jurisdiction, 'R4')).toBe(true);
  return instance;
}
function ownCS(overrides: Partial<CodeSystem> = {}): CodeSystem {
  return { resourceType: 'CodeSystem', url: system, content: 'complete', version: '1.0.0', language: 'en',
    concept: [{ code: '001', display: 'Tenant World' }], ...overrides };
}
describe('source-pinned UN-M49 provider data authority', () => {
  const snapshot = builtInProviderSnapshot(system)!;
  it('retains source identity, 270 literal rows and no terminology business edition', () => {
    expect(snapshot.source.sha256).toBe('c74f2aee15497470321af64e95d897796e5dda94b70797c47792ca535bee2c60');
    expect(snapshot.businessVersion).toBeNull(); expect(snapshot.rows).toHaveLength(270);
    expect(new Set(snapshot.rows.map(row => row[0])).size).toBe(270);
    expect(snapshot.rows.filter(row => row[3] === 'region')).toHaveLength(29);
    expect(createHash('sha256').update(JSON.stringify(snapshot.rows)).digest('hex')).toBe('fa5d0902be5d064ac6808852edb6923770aead1fe848829da09708233a9e6472');
    expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.rows[0])).toBe(true);
  });
  it.each(['0.14.1', '4.0.1', '*', ''])('named edition %j cannot borrow a source revision', version => expect(builtInProviderSnapshot(system, version)).toBeNull());
  it.each([
    ['001', 'World', 'region'], ['004', 'Afghanistan (AFG)', 'country'],
    ['384', "Côte d'Ivoire (CIV)", 'country'], ['830', 'Channel Islands', 'country'], ['680', 'Sark', 'country'],
  ])('genuine %s has its own display/class', (code, display, category) => {
    expect(providerCodeMembership(snapshot, code)).toBe(true);
    expect(providerFilterMembership(snapshot, code, { ...region, value: category })).toBe(true);
    expect(providerFilterMembership(snapshot, code, { ...region, value: category === 'region' ? 'country' : 'region' })).toBe(false);
    expect(providerFilterMembership(snapshot, code, { property: 'type', op: '=', value: category })).toBe(true);
    expect(assessProviderDisplay(snapshot, code, display, 'en-US').outcome).toBe('accepted');
    expect(assessProviderDisplay(snapshot, code, 'Incorrect', 'en').outcome).toBe('mismatch');
    expect(assessProviderDisplay(snapshot, code, display, 'fr').outcome).toBe('unverified');
  });
  it.each(['999', '1', '001 ', 'AFG'])('unlisted %j cannot be rejected or verified from a partial snapshot', code => {
    expect(providerCodeMembership(snapshot, code)).toBeNull(); expect(providerFilterMembership(snapshot, code, region)).toBeNull();
    expect(validateProviderCode(snapshot, code, 'World')).toBeNull();
  });
  it.each([
    { property: 'concept', op: 'is-a', value: '001' }, { property: 'Class', op: '=', value: 'region' },
    { ...region, op: 'in' }, { ...region, value: '' }, { ...region, modifierExtension: [{ url: 'urn:unknown' }] },
  ])('unproven filter %j stays U', filter => expect(providerFilterMembership(snapshot, '001', filter)).toBeNull());
  it.each(['rows', 'source', 'businessVersion', 'language'] as const)('changed %s cannot assert membership/display', field => {
    const changed = structuredClone(snapshot) as unknown as Record<string, unknown>;
    changed[field] = field === 'rows' ? [] : field === 'source' ? {} : 'changed';
    const invalid = changed as unknown as ProviderSnapshot;
    expect(providerCodeMembership(invalid, '001')).toBeNull(); expect(validateProviderCode(invalid, '001', 'World')).toBeNull();
    expect(assessProviderDisplay(invalid, '001', 'World').outcome).toBe('unverified');
  });
  it('integrity check rejects circular input without throwing', () => {
    const circular = { ...snapshot, source: {} }; Object.assign(circular.source, { circular });
    expect(providerCodeMembership(circular as unknown as ProviderSnapshot, '001')).toBeNull();
  });
  it('scope mismatch remains U after a plain-data clone', () => {
    const selected = structuredClone({ kind: 'provider' as const, snapshot, scopeKey: 'A' });
    expect(scopedProviderSnapshot(selected, 'A')).not.toBeNull(); expect(scopedProviderSnapshot(selected, 'B')).toBeNull();
  });
  it('completion marks code evidence while preserving own display U/N', () => {
    for (const [display, language, reason] of [['World', 'en', undefined], ['World', 'fr', 'display-unverified'], ['Wrong', 'en', 'display-mismatch']] as const) {
      const result = validateProviderCode(snapshot, '001', display, language)!;
      expect(isVerifiedCodeSystemResult(result)).toBe(true); expect(result.reason).toBe(reason);
      expect(result.valid).toBe(reason !== 'display-mismatch');
    }
  });
});
describe('actual shared selector, cache and capture guards', () => {
  it.each(['code', 'file'] as const)('cache-only %s CodeSystem wins over the provider', async kind => {
    const deps = loader(); setProfileSource({});
    if (kind === 'code') deps.cache.setCodeSystem(system, ownCS()); else deps.cache.setCodeSystemFile(system, ownCS());
    await expect(validateCodeInLocalCodeSystem(deps, '001', system, 'World', 'R4')).resolves.toMatchObject({ valid: false, reason: 'display-mismatch', display: 'Tenant World' });
    await expect(deps.packageLoader.loadLocalTerminologyAuthority(system, 'R4')).resolves.toMatchObject({ kind: 'code-system' });
  });
  it.each(['not-present', 'supplement'] as const)('selected %s cannot borrow provider codes', async content => {
    const deps = loader(); setProfileSource({}); deps.cache.setCodeSystem(system, ownCS({ content }));
    await expect(validateCodeInLocalCodeSystem(deps, '001', system, 'World', 'R4')).resolves.toBeNull();
  });
  it.each(['example', 'fragment'] as const)('selected %s keeps known display N and incomplete missing-code U', async content => {
    const deps = loader(); setProfileSource({}); deps.cache.setCodeSystem(system, ownCS({ content }));
    await expect(validateCodeInLocalCodeSystem(deps, '001', system, 'World', 'R4')).resolves.toMatchObject({ valid: false, reason: 'display-mismatch', display: 'Tenant World' });
    await expect(validateCodeInLocalCodeSystem(deps, '004', system, 'Afghanistan (AFG)', 'R4')).resolves.toMatchObject({ valid: false, reason: 'code-unknown', incompleteCodeSystem: true });
  });
  it('cache-only authority for another canonical is preserved', async () => {
    const deps = loader(); setProfileSource({}); const url = 'https://example.test/CodeSystem/owned';
    deps.cache.setCodeSystem(url, { ...ownCS(), url });
    await expect(validateCodeInLocalCodeSystem(deps, '001', url, 'Tenant World', 'R4')).resolves.toMatchObject({ valid: true });
  });
  it.each(['code', 'file'] as const)('R5 core %s cache cannot speak for an R4 filter/display', async kind => {
    setProfileSource({}); const cache = new ValueSetCache(); const instance = new ValueSetValidator(cache, undefined, []);
    instance.setResolutionConfig({ strategy: 'local-only', reportUnverifiedBindings: true });
    const canonical = 'http://hl7.org/fhir/resource-types';
    const wrong: CodeSystem = { ...ownCS(), url: canonical, version: '5.0.0', property: [{ code: 'class', type: 'code' }],
      concept: [{ code: '001', display: 'Tenant World', property: [{ code: 'class', valueCode: 'region' }] }] };
    if (kind === 'code') cache.setCodeSystem(canonical, wrong); else cache.setCodeSystemFile(canonical, wrong);
    expect(instance.registerExternalTerminologyResource({ ...jurisdiction, compose: { include: [{ system: canonical, filter: [region] }] } }, 'R4')).toBe(true);
    await expect(instance.resolveCodeBindingForBinding('001', canonical, jurisdiction.url, 'required', 'R4')).resolves.toBe('unverified');
    await expect(instance.validateCodeInLocalCodeSystemWithLanguage('001', canonical, 'Tenant World', 'R4')).resolves.toBeNull();
    const issues = await instance.validateBinding({ system: canonical, code: '001', display: 'Tenant World' },
      { strength: 'required', valueSet: jurisdiction.url }, 'Observation.code', { fhirVersion: 'R4' });
    expect(issues.some(issue => issue.code === 'terminology-display-unverified')).toBe(true);
  });
  it('named requested edition cannot take a host same-major fallback', async () => {
    setProfileSource({ findCanonicalResource: async () => ownCS() as unknown as Record<string, unknown> });
    const deps = loader(); deps.packageLoader.setSourceContext({ organizationId: 1, fhirVersion: 'R4' });
    await expect(validateCodeInLocalCodeSystem(deps, '001', system, 'Tenant World', 'R4', '1.1.0')).resolves.toBeNull();
  });
  it('failed host selection stays blocked cold/warm and across captured loaders', async () => {
    const find = vi.fn(async () => { throw new Error('Host unavailable'); }); setProfileSource({ findCanonicalResource: find });
    const first = loader(), second = loader(); for (const deps of [first, second]) deps.packageLoader.setSourceContext({ organizationId: 1, fhirVersion: 'R4' });
    const snapshot = createValidationDependencySnapshot({ requireProfileLookup: false });
    await snapshot.run(async () => {
      for (const deps of [first, second, first]) await expect(deps.packageLoader.loadLocalTerminologyAuthority(system, 'R4')).resolves.toBeNull();
    });
    expect(find).toHaveBeenCalledTimes(1); expect(snapshot.evidence().status).toBe('unattested');
    await expect(first.packageLoader.loadLocalTerminologyAuthority(system, 'R4')).resolves.toBeNull();
    expect(find).toHaveBeenCalledTimes(1);
    first.packageLoader.clearLookupState(); first.cache.clear();
    setProfileSource({ findCanonicalResource: async () => null });
    await expect(first.packageLoader.loadLocalTerminologyAuthority(system, 'R4')).resolves.toMatchObject({ kind: 'provider' });
  });
  it('parallel organizations share neither host authority nor lookup failure', async () => {
    setProfileSource({ findCanonicalResource: async (_url, _type, _version, context) => {
      await Promise.resolve(); if (context?.organizationId === 1) throw new Error('Unavailable');
      return context?.organizationId === 2 ? ownCS() as unknown as Record<string, unknown> : null;
    } });
    const deps = loader();
    const outcomes = await Promise.all([1, 2, 3].map(organizationId => deps.cache.sourceContexts.runWith({ organizationId, fhirVersion: 'R4' },
      () => deps.packageLoader.loadLocalTerminologyAuthority(system, 'R4'))));
    expect(outcomes.map(outcome => outcome?.kind ?? 'unknown')).toEqual(['unknown', 'code-system', 'provider']);
    await deps.cache.sourceContexts.runWith({ organizationId: 1, fhirVersion: 'R4' }, async () => {
      expect(deps.packageLoader.providerSnapshotForContext(outcomes[2], 'R4')).toBeNull();
    });
  });
  it('provider selection is captured, detached and invalidated on source change', async () => {
    setProfileSource({}); const deps = loader(); const captured = createValidationDependencySnapshot({ requireProfileLookup: false });
    await captured.run(async () => {
      const selected = await deps.packageLoader.loadLocalTerminologyAuthority(system, 'R4');
      expect(deps.packageLoader.providerSnapshotForContext(selected, 'R4')).not.toBeNull();
      if (selected?.kind === 'provider') (selected.snapshot.rows as unknown as string[][])[0][0] = 'changed';
      const next = await deps.packageLoader.loadLocalTerminologyAuthority(system, 'R4');
      expect(deps.packageLoader.providerSnapshotForContext(next, 'R4')).not.toBeNull();
      setProfileSource({}); expect(deps.packageLoader.providerSnapshotForContext(next, 'R4')).toBeNull();
    });
    expect(captured.evidence()).toMatchObject({ status: 'captured' });
  });
  it('an inferred R4 publication keeps failed host selection in the actual lookup scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-unm49-publication-')); roots.push(root);
    const packagePath = join(root, 'hl7.fhir.r4.core#4.0.1', 'package'); await mkdir(packagePath, { recursive: true });
    await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: 'hl7.fhir.r4.core', version: '4.0.1', fhirVersions: ['4.0.1'] }));
    await writeFile(join(packagePath, 'ValueSet-jurisdiction.json'), JSON.stringify(jurisdiction));
    await writeFile(join(packagePath, '.index.json'), JSON.stringify({ 'index-version': 2, files: [{ filename: 'ValueSet-jurisdiction.json', resourceType: 'ValueSet', url: jurisdiction.url, version: jurisdiction.version }] }));
    setProfileSource({ findCanonicalResource: async (_url, type) => { if (type === 'CodeSystem') throw new Error('Host unavailable'); return null; } });
    const cache = new ValueSetCache(); const packageLoader = new ValueSetPackageLoader(cache, new ValueSetPackageResourceAccess([root]));
    packageLoader.setSourceContext({ organizationId: 1 });
    const selected = await packageLoader.loadValueSetResource(jurisdiction.url);
    expect(selected).not.toBeNull();
    await expect(packageLoader.loadLocalTerminologyAuthority(system, undefined, undefined, selected!)).resolves.toBeNull();
  });
  it.each(['missing', 'invalid-json', 'wrong-url', 'valid'] as const)('declared example %s is distinguished from absent authority cold/warm', async kind => {
    setProfileSource({}); const root = await mkdtemp(join(tmpdir(), 'records-unm49-example-')); roots.push(root);
    const packagePath = join(root, 'fixture#1.0.0', 'package'); await mkdir(join(packagePath, 'example'), { recursive: true });
    await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', fhirVersions: ['4.0.1'] }));
    await writeFile(join(packagePath, '.index.json'), JSON.stringify({ 'index-version': 2, files: [] }));
    await writeFile(join(packagePath, 'example', '.index.json'), JSON.stringify({ 'index-version': 2, files: [{ filename: 'CodeSystem-owned.json', resourceType: 'CodeSystem', url: system }] }));
    if (kind !== 'missing') await writeFile(join(packagePath, 'example', 'CodeSystem-owned.json'), kind === 'invalid-json' ? '{' : JSON.stringify(ownCS(kind === 'wrong-url' ? { url: 'https://wrong.test' } : {})));
    const cache = new ValueSetCache(); const packageLoader = new ValueSetPackageLoader(cache, new ValueSetPackageResourceAccess([root]));
    for (let round = 0; round < 2; round++) {
      const selected = await packageLoader.loadLocalTerminologyAuthority(system, 'R4');
      if (kind === 'valid') expect(selected).toMatchObject({ kind: 'code-system', codeSystem: { concept: [{ code: '001', display: 'Tenant World' }] } });
      else expect(selected).toBeNull();
    }
  });
  it('a declared missing CodeSystem blocks rather than impersonating absence', async () => {
    setProfileSource({}); const root = await mkdtemp(join(tmpdir(), 'records-unm49-missing-')); roots.push(root);
    const packagePath = join(root, 'fixture#1.0.0', 'package'); await mkdir(packagePath, { recursive: true });
    await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', fhirVersions: ['4.0.1'] }));
    await writeFile(join(packagePath, '.index.json'), JSON.stringify({ 'index-version': 2, files: [{ filename: 'CodeSystem-missing.json', resourceType: 'CodeSystem', url: system }] }));
    const cache = new ValueSetCache(); const packageLoader = new ValueSetPackageLoader(cache, new ValueSetPackageResourceAccess([root]));
    await expect(packageLoader.loadLocalTerminologyAuthority(system, 'R4')).resolves.toBeNull();
  });
});
describe('actual binding owner compose algebra', () => {
  it.each([
    ['001', undefined, 'valid'], ['004', undefined, 'invalid'], ['999', undefined, 'unverified'], ['001', '4.0.1', 'unverified'],
  ] as const)('genuine jurisdiction %s edition=%s yields %s', async (code, edition, outcome) => {
    setProfileSource({}); const instance = validator();
    for (let round = 0; round < 2; round++) await expect(instance.resolveCodeBindingForBinding(code, system, jurisdiction.url, 'required', 'R4', undefined, edition)).resolves.toBe(outcome);
  });
  it.each([
    ['class N AND U', [{ system, filter: [region, { property: 'unknown', op: '=', value: 'x' }] }], undefined, '004', 'invalid'],
    ['class P AND U', [{ system, filter: [region, { property: 'unknown', op: '=', value: 'x' }] }], undefined, '001', 'unverified'],
    ['class P OR U', [{ system, filter: [region] }, { system, filter: [{ property: 'unknown', op: '=', value: 'x' }] }], undefined, '001', 'valid'],
    ['class P minus known exclusion', [{ system, filter: [region] }], [{ system, concept: [{ code: '001' }] }], '001', 'invalid'],
    ['class P minus unknown exclusion', [{ system, filter: [region] }], [{ system, filter: [{ property: 'unknown', op: '=', value: 'x' }] }], '001', 'unverified'],
  ] as const)('%s preserves proof logic', async (_name, include, exclude, code, outcome) => {
    setProfileSource({}); const instance = validator(structuredClone(include) as ValueSetComposeInclude[], exclude ? structuredClone(exclude) as ValueSetComposeInclude[] : undefined);
    await expect(instance.resolveCodeBindingForBinding(code, system, jurisdiction.url, 'required', 'R4')).resolves.toBe(outcome);
  });
});
