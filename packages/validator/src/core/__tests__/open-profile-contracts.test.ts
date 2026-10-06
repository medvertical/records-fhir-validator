import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { RecordsValidator } from '../validator-engine.js';
import { StructureDefinitionLoader } from '../structure-definition-loader.js';
import { SnapshotGenerator } from '../snapshot-generator.js';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context.js';
import { lookupProfilePackageProvenance } from '../../package/canonical-pin-provenance.js';
import { setProfileSource } from '../../persistence/profile-source.js';

// New verification of five retained open contracts; these are not reconstructed original inputs.
const roots: string[] = [];
const parentUrl = 'https://example.test/StructureDefinition/Referrer';
const targetUrl = 'https://example.test/StructureDefinition/DependentPatient';
const baseUrl = 'https://example.test/StructureDefinition/BasePatient';
const childUrl = 'https://example.test/StructureDefinition/ChildPatient';
const element = (id: string, extra: Partial<ElementDefinition> = {}): ElementDefinition => ({ id, path: id, ...extra });
const definition = (url: string, min: number, differential = false): StructureDefinition => {
  const elements = [element('Patient', { min: 0, max: '*' }),
    element('Patient.active', { min, max: '1', type: [{ code: 'boolean' }] })];
  return { resourceType: 'StructureDefinition', id: url.split('/').pop()!, url,
    version: '7.0.0', fhirVersion: '4.0.1', name: 'PatientProfile', status: 'active', abstract: false,
    kind: 'resource', type: 'Patient', derivation: 'constraint',
    baseDefinition: differential ? targetUrl : 'http://hl7.org/fhir/StructureDefinition/Patient',
    ...(differential ? { differential: { element: [elements[0]] } } : { snapshot: { element: elements } }) };
};
afterEach(async () => {
  vi.restoreAllMocks(); setProfileSource({}); clearCanonicalPinCaches();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function store() {
  const root = await mkdtemp(join(tmpdir(), 'records-new-profile-contract-')); roots.push(root);
  const writePackage = async (name: string, version: string, definitions: StructureDefinition[],
    dependencies: Record<string, string> = {}, fhirVersions = ['4.0.1']) => {
    const directory = join(root, `${name}#${version}`, 'package'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, fhirVersions, dependencies }));
    await writeFile(join(directory, '.index.json'), JSON.stringify({ 'index-version': 2, files: definitions.map((sd, index) => ({
      filename: `StructureDefinition-${index}.json`, resourceType: sd.resourceType, url: sd.url, version: sd.version,
    })) }));
    await Promise.all(definitions.map((sd, index) => writeFile(join(directory, `StructureDefinition-${index}.json`), JSON.stringify(sd))));
  };
  await writePackage('hl7.fhir.r4.core', '4.0.1', [
    { ...definition('http://hl7.org/fhir/StructureDefinition/Patient', 0), version: '4.0.1' },
    { ...definition('http://hl7.org/fhir/StructureDefinition/Observation', 0), version: '4.0.1', type: 'Observation', baseDefinition: undefined,
      snapshot: { element: [element('Observation')] } },
  ]);
  return { root, writePackage };
}
async function validatorFor(root: string) {
  const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
    prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
  await validator.waitForInitialization(); return validator;
}
function settingsFor() {
  const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  settings.profileSources = { simplifier: false, packageRegistry: false };
  settings.terminologyServers = []; settings.advisorRules = [];
  settings.aspects.reference.enabled = true; settings.aspects.custom_rule.enabled = false;
  return settings;
}
async function validate(validator: RecordsValidator, api: 'single' | 'multi', resource: Record<string, unknown>,
  profile: string, settings = settingsFor()): Promise<ValidationIssue[]> {
  return api === 'single' ? validator.validate(resource, `${profile}|7.0.0`, 'R4', settings)
    : (await validator.validateAspects(resource, { aspects: ['structural', 'profile', 'reference'], settings,
      fhirVersion: 'R4', profileUrl: `${profile}|7.0.0` })).aspects.flatMap(aspect => aspect.issues);
}
const incomplete = (issues: ValidationIssue[]) => issues.some(issue => issue.details?.validationComplete === false);

describe('Explicit retained open-profile contracts', () => {
  it.each(['single', 'multi'] as const)('uses the inherited targetProfile actual PackageDefiner through %s', async api => {
    for (const mode of ['inherited', 'override', 'missing-base-dependency'] as const) {
      const { root, writePackage } = await store();
      const target = (fixedBoolean: boolean): StructureDefinition => {
        const sd = definition(targetUrl, 1); sd.snapshot!.element[1].fixedBoolean = fixedBoolean; return sd;
      };
      await writePackage('example.target', '1.0.0', [target(true)]);
      await writePackage('example.target', '2.0.0', [target(false)]);
      const base: StructureDefinition = { ...definition(baseUrl, 0), type: 'Observation', baseDefinition: undefined,
        snapshot: { element: [element('Observation'), element('Observation.subject', {
          min: 1, max: '1', type: [{ code: 'Reference', targetProfile: [targetUrl] }],
        })] } };
      await writePackage('example.base', '1.0.0', [base], { 'example.target': mode === 'missing-base-dependency' ? '9.0.0' : '1.0.0' });
      const child: StructureDefinition = { ...base, url: childUrl, id: 'ChildPatient', snapshot: undefined, baseDefinition: baseUrl,
        differential: { element: [element('Observation'), element('Observation.subject', {
          mustSupport: true, ...(mode === 'override' ? { type: [{ code: 'Reference', targetProfile: [targetUrl] }] } : {}),
        })] } };
      await writePackage('example.child', '1.0.0', [child], { 'example.base': '1.0.0', 'example.target': '2.0.0' });
      const validator = await validatorFor(root); const loader = validator.getSdLoader();
      const original = loader.loadReferencedProfile.bind(loader);
      const receipts: Array<{ source?: ReturnType<typeof lookupProfilePackageProvenance>; selected?: ReturnType<typeof lookupProfilePackageProvenance> }> = [];
      vi.spyOn(loader, 'loadReferencedProfile').mockImplementation(async (...args) => {
        try {
          const result = await original(...args);
          if (args[0] === targetUrl) receipts.push({ source: args[1] ? lookupProfilePackageProvenance(args[1]) : undefined,
            selected: result ? lookupProfilePackageProvenance(result) : undefined });
          return result;
        } catch (error: unknown) {
          if (args[0] === targetUrl) receipts.push({ source: args[1] ? lookupProfilePackageProvenance(args[1]) : undefined });
          throw error;
        }
      });
      for (const active of mode === 'missing-base-dependency' ? [false] : [true, false]) {
        const resource = { resourceType: 'Observation', contained: [{ resourceType: 'Patient', id: 'p1', active }],
          subject: { reference: '#p1' } };
        for (let repeat = 0; repeat < 2; repeat++) {
          receipts.length = 0; const issues = await validate(validator, api, resource, childUrl);
          expect(issues.some(issue => issue.code === 'reference-target-profile-noncompliant')).toBe(
            mode !== 'missing-base-dependency' && active !== (mode === 'inherited'));
          expect(incomplete(issues)).toBe(mode === 'missing-base-dependency');
          expect(receipts).toContainEqual(expect.objectContaining({ source: {
            name: mode === 'override' ? 'example.child' : 'example.base', version: '1.0.0',
          }, ...(mode === 'missing-base-dependency' ? {} : { selected: {
            name: 'example.target', version: mode === 'override' ? '2.0.0' : '1.0.0',
          } }) }));
        }
      }
      vi.restoreAllMocks();
    }
  });

  it('refreshes an unscoped changing parent basis under one unchanged host owner', async () => {
    const { root } = await store(); let min = 1;
    const child = definition(parentUrl, 0, true);
    const host = { findByUrl: async (url: string) => url.split('|')[0] === targetUrl ? definition(targetUrl, min) : null };
    setProfileSource(host);
    const loader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
    await loader.waitForInitialization(); const generator = new SnapshotGenerator(loader);
    const childBytes = JSON.stringify(child);
    for (const required of [1, 0, 1]) {
      min = required;
      const coldLoader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
      await coldLoader.waitForInitialization();
      const cold = await new SnapshotGenerator(coldLoader).generateSnapshot(structuredClone(child), { fhirVersion: 'R4', cacheResults: false });
      expect(cold.find(item => item.path === 'Patient.active')?.min).toBe(required);
      const warm = await generator.generateSnapshot(child, { fhirVersion: 'R4', cacheResults: true });
      expect(warm).toEqual(cold);
      expect(JSON.stringify(child)).toBe(childBytes);
    }
    expect(generator.getCacheStats().size).toBeGreaterThan(0);
  });

  it('retains exact differential rules for explicit null base and untyped null base', async () => {
    const { root } = await store();
    const loader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
    await loader.waitForInitialization(); const generator = new SnapshotGenerator(loader);
    for (const typed of [true, false]) {
      const profile = { ...definition(parentUrl, 0, true), differential: { element: [
        element('Patient'), element('Patient.active', { min: 1, max: '1', type: [{ code: 'boolean' }] }),
      ] } };
      Reflect.set(profile, 'baseDefinition', null);
      if (!typed) Reflect.deleteProperty(profile, 'type');
      const bytes = JSON.stringify(profile);
      const snapshot = await generator.generateSnapshot(profile, { fhirVersion: 'R4', cacheResults: false });
      expect(snapshot).toEqual(profile.differential.element);
      expect(snapshot.find(item => item.path === 'Patient.active')).toMatchObject({ min: 1, max: '1' });
      expect(JSON.stringify(profile)).toBe(bytes);
    }
  });

  it.each(['single', 'multi'] as const)('retains actual selected ancestor pattern P/N/U through %s', async api => {
    const { root, writePackage } = await store();
    for (const [release, patternBoolean] of [['1.0.0', true], ['2.0.0', false]] as const) {
      const base = definition(targetUrl, 0); base.snapshot!.element[1].patternBoolean = patternBoolean;
      await writePackage('example.dependency', release, [base]);
    }
    await writePackage('example.referrer', '3.0.0', [definition(parentUrl, 0, true)], { 'example.dependency': '1.0.0' });
    const validator = await validatorFor(root); const settings = settingsFor();
    for (const release of ['1.0.0', '2.0.0', '9.0.0', '1.0.0']) {
      settings.packageDownload.pinnedVersions = { 'example.dependency': release };
      for (const active of [true, false]) {
        const issues = await validate(validator, api, { resourceType: 'Patient', active }, parentUrl, settings);
        expect(issues.some(issue => issue.code === 'profile-pattern-mismatch')).toBe(
          release !== '9.0.0' && active !== (release === '1.0.0'));
        expect(incomplete(issues)).toBe(release === '9.0.0');
      }
    }
  });

  it.each(['single', 'multi'] as const)('refuses wrong-FHIR dependency manifest authority through %s', async api => {
    for (const fhirVersions of [['4.0.1'], ['5.0.0']]) {
      const { root, writePackage } = await store();
      await writePackage('example.referrer', '3.0.0', [definition(parentUrl, 0, true)], { 'example.dependency': '1.0.0' });
      await writePackage('example.dependency', '1.0.0', [definition(targetUrl, 1)], {}, fhirVersions);
      const validator = await validatorFor(root); const wrongManifest = fhirVersions[0] === '5.0.0';
      for (const activePresent of [false, true]) for (let repeat = 0; repeat < 2; repeat++) {
        const issues = await validate(validator, api, { resourceType: 'Patient', ...(activePresent ? { active: true } : {}) }, parentUrl);
        expect(issues.some(issue => issue.code === 'structural-cardinality-min' && issue.path === 'Patient.active')).toBe(!wrongManifest && !activePresent);
        expect(issues.some(issue => issue.code === 'profile-reference-unavailable')).toBe(wrongManifest);
        expect(incomplete(issues)).toBe(wrongManifest);
      }
    }
  });
});


describe('Profile basis compatibility guards', () => {
  it.each(['5.0.0', undefined])('refuses a wrong-family canonical claim with own SD FHIR %s', async fhirVersion => {
    const { root, writePackage } = await store();
    await writePackage('example.referrer', '3.0.0', [definition(parentUrl, 0, true)], { 'example.dependency': '1.0.0' });
    await writePackage('example.dependency', '1.0.0', [{ ...definition(targetUrl, 1), fhirVersion }], {}, ['5.0.0']);
    await writePackage('example.foreign', '4.0.0', [definition(targetUrl, 0)]);
    const validator = await validatorFor(root); const loader = validator.getSdLoader();
    const parent = await loader.loadProfile(`${parentUrl}|7.0.0`, 'R4');
    if (!parent) throw new Error('Referrer fixture was not selected');
    await expect(loader.loadReferencedProfile(targetUrl, parent, 'R4')).rejects.toMatchObject({
      name: 'ProfileReferenceUnavailableError', receipt: { canonical: targetUrl,
        source: { name: 'example.referrer', version: '3.0.0' },
        dependency: { name: 'example.dependency', version: '1.0.0' }, cause: 'dependency-fhir-version-incompatible' },
    });
  });

  it('keeps normal global fallback after readable incompatible dependency proves the canonical absent', async () => {
    const { root, writePackage } = await store();
    await writePackage('example.referrer', '3.0.0', [definition(parentUrl, 0, true)], { 'example.dependency': '1.0.0' });
    await writePackage('example.dependency', '1.0.0', [
      { ...definition('https://example.test/StructureDefinition/Unrelated', 1), fhirVersion: '5.0.0' },
    ], {}, ['5.0.0']);
    await writePackage('example.foreign', '4.0.0', [definition(targetUrl, 0)]);
    const validator = await validatorFor(root); const loader = validator.getSdLoader();
    const parent = await loader.loadProfile(`${parentUrl}|7.0.0`, 'R4');
    if (!parent) throw new Error('Referrer fixture was not selected');
    const selected = await loader.loadReferencedProfile(targetUrl, parent, 'R4');
    expect(selected?.snapshot?.element.find(item => item.path === 'Patient.active')?.min).toBe(0);
    expect(selected && lookupProfilePackageProvenance(selected)).toEqual({ name: 'example.foreign', version: '4.0.0' });
  });

  it('preserves an explicit registered basis before a host lookup and reads the host after explicit removal', async () => {
    const { root } = await store(); let min = 0;
    setProfileSource({ findByUrl: async url => url.split('|')[0] === targetUrl ? definition(targetUrl, min) : null });
    const loader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
    await loader.waitForInitialization();
    expect(loader.registerExternalProfile(definition(targetUrl, 1), 'R4')).toBe(true);
    expect((await loader.loadReferencedProfile(targetUrl, definition(parentUrl, 0, true), 'R4'))
      ?.snapshot?.element.find(item => item.path === 'Patient.active')?.min).toBe(1);
    expect(loader.clearExternalProfiles()).toBeGreaterThan(0);
    for (const current of [0, 1, 0]) {
      min = current;
      expect((await loader.loadReferencedProfile(targetUrl, definition(parentUrl, 0, true), 'R4'))
        ?.snapshot?.element.find(item => item.path === 'Patient.active')?.min).toBe(current);
    }
  });
});


describe('Inherited extension targetProfile public authority', () => {
  it.each(['single', 'multi'] as const)('retains inherited and overridden valueReference definer through %s', async api => {
    const baseExtensionUrl = 'https://example.test/StructureDefinition/AbstractReferenceExtension';
    const extensionUrl = 'https://example.test/StructureDefinition/ReferenceExtension';
    for (const mode of ['inherited', 'override'] as const) {
      const { root, writePackage } = await store();
      const target = (fixedBoolean: boolean) => {
        const sd = definition(targetUrl, 1); sd.snapshot!.element[1].fixedBoolean = fixedBoolean; return sd;
      };
      await writePackage('example.target', '1.0.0', [target(true)]);
      await writePackage('example.target', '2.0.0', [target(false)]);
      const baseExtension: StructureDefinition = { ...definition(baseExtensionUrl, 0), kind: 'complex-type',
        type: 'Extension', abstract: true, baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Extension',
        context: [{ type: 'element', expression: 'Patient' }], snapshot: { element: [
          element('Extension', { min: 0, max: '*' }),
          element('Extension.url', { min: 1, max: '1', type: [{ code: 'uri' }] }),
          element('Extension.value[x]', { min: 1, max: '1', type: [{ code: 'Reference', targetProfile: [targetUrl] }] }),
        ] } };
      await writePackage('example.extension-base', '1.0.0', [baseExtension], { 'example.target': '1.0.0' });
      const extension: StructureDefinition = { ...baseExtension, url: extensionUrl, id: 'ReferenceExtension',
        abstract: false, snapshot: undefined, baseDefinition: baseExtensionUrl, differential: { element: [
          element('Extension'), element('Extension.url', { fixedUri: extensionUrl }),
          element('Extension.value[x]', { mustSupport: true,
            ...(mode === 'override' ? { type: [{ code: 'Reference', targetProfile: [targetUrl] }] } : {}),
          }),
        ] } };
      await writePackage('example.extension-child', '1.0.0', [extension], {
        'example.extension-base': '1.0.0', 'example.target': '2.0.0',
      });
      const parent: StructureDefinition = { ...definition(parentUrl, 0), snapshot: { element: [
        element('Patient', { min: 0, max: '*' }),
        element('Patient.extension', { min: 0, max: '*', type: [{ code: 'Extension', profile: [extensionUrl] }] }),
      ] } };
      await writePackage('example.referrer', '3.0.0', [parent], { 'example.extension-child': '1.0.0' });
      const validator = await validatorFor(root); const loader = validator.getSdLoader();
      const original = loader.loadReferencedProfile.bind(loader);
      const receipts: Array<{ source?: ReturnType<typeof lookupProfilePackageProvenance>; selected?: ReturnType<typeof lookupProfilePackageProvenance> }> = [];
      vi.spyOn(loader, 'loadReferencedProfile').mockImplementation(async (...args) => {
        const result = await original(...args);
        if (args[0] === targetUrl) receipts.push({ source: args[1] ? lookupProfilePackageProvenance(args[1]) : undefined,
          selected: result ? lookupProfilePackageProvenance(result) : undefined });
        return result;
      });
      for (const active of [true, false]) for (let repeat = 0; repeat < 2; repeat++) {
        receipts.length = 0;
        const resource = { resourceType: 'Patient', contained: [{ resourceType: 'Patient', id: 'own-target', active }],
          extension: [{ url: extensionUrl, valueReference: { reference: '#own-target' } }] };
        const issues = await validate(validator, api, resource, parentUrl);
        expect(issues.some(issue => issue.code === 'reference-target-profile-noncompliant')).toBe(active !== (mode === 'inherited'));
        expect(incomplete(issues)).toBe(false);
        expect(receipts).toContainEqual(expect.objectContaining({ source: {
          name: mode === 'override' ? 'example.extension-child' : 'example.extension-base', version: '1.0.0',
        }, selected: { name: 'example.target', version: mode === 'override' ? '2.0.0' : '1.0.0' } }));
      }
      vi.restoreAllMocks();
    }
  });
});

describe('Package-authorized exhausted host basis', () => {
  it('reads the actual cold and warm host min1→0→1 after the selected package graph proves the canonical absent', async () => {
    const { root, writePackage } = await store(); let min = 1;
    await writePackage('example.referrer', '3.0.0', [definition(parentUrl, 0, true)]);
    setProfileSource({ findByUrl: async url => url.split('|')[0] === targetUrl ? definition(targetUrl, min) : null });
    const loader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
    await loader.waitForInitialization(); const generator = new SnapshotGenerator(loader);
    const parent = await loader.loadProfile(`${parentUrl}|7.0.0`, 'R4');
    if (!parent) throw new Error('Actual package referrer fixture missing');
    expect(lookupProfilePackageProvenance(parent)).toEqual({ name: 'example.referrer', version: '3.0.0' });
    const bytes = JSON.stringify(parent);
    for (const required of [1, 0, 1]) {
      min = required;
      const coldLoader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
      await coldLoader.waitForInitialization();
      const cold = await new SnapshotGenerator(coldLoader).generateSnapshot(parent, { fhirVersion: 'R4', cacheResults: false });
      expect(cold.find(item => item.path === 'Patient.active')?.min).toBe(required);
      const warm = await generator.generateSnapshot(parent, { fhirVersion: 'R4', cacheResults: true });
      expect(warm).toEqual(cold);
      expect(JSON.stringify(parent)).toBe(bytes);
    }
  });
});
