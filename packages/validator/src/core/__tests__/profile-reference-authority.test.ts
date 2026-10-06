import { cp, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { resolveProfileReferenceAuthority, withSelectedProfileDefinition } from '../profile-reference-authority';
import type { StructureDefinition } from '../structure-definition-types';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import { SlicingValidator } from '../../validators/slicing-validator';
import { RecordsValidator } from '../validator-engine';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { setProfileSource } from '../../persistence/profile-source';
import { createValidationDependencySnapshot } from '../../validation-dependency-snapshot';

const parentUrl = 'https://example.test/StructureDefinition/Referrer';
const targetUrl = 'https://example.test/StructureDefinition/DependentPatient';
const roots: string[] = [];
afterEach(async () => {
  setProfileSource({}); clearCanonicalPinCaches();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));

});
function definition(url: string, min: number, differential = false) {
  const element = [{ id: 'Patient', path: 'Patient', min: 0, max: '*' },
    { id: 'Patient.active', path: 'Patient.active', min, max: '1', type: [{ code: 'boolean' }] }];
  return { resourceType: 'StructureDefinition' as const, id: url.split('/').pop()!, url,
    version: '7.0.0', fhirVersion: '4.0.1', name: 'PatientProfile', status: 'active', abstract: false,
    kind: 'resource', type: 'Patient', derivation: 'constraint',
    baseDefinition: differential ? targetUrl : 'http://hl7.org/fhir/StructureDefinition/Patient',
    ...(differential ? { differential: { element: [element[0]] } } : { snapshot: { element } }) };
}
async function fixture(dependency = '1.0.0', missingFile = false, min = 1) {
  const root = await mkdtemp(join(tmpdir(), 'records-reference-authority-')); roots.push(root);
  const writePackage = async (name: string, release: string, sd: StructureDefinition, dependencies = {}, absent = false) => {
    const folder = join(root, `${name}#${release}`, 'package'); await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), JSON.stringify({ name, version: release, fhirVersions: ['4.0.1'], dependencies }));
    await writeFile(join(folder, '.index.json'), JSON.stringify({ 'index-version': 2,
      files: [{ filename: 'StructureDefinition-Patient.json', resourceType: 'StructureDefinition', url: sd.url, version: sd.version }] }));
    if (!absent) await writeFile(join(folder, 'StructureDefinition-Patient.json'), JSON.stringify(sd));
  };
  await writePackage('example.referrer', '3.0.0', definition(parentUrl, 0, true), { 'example.dependency': dependency });
  await writePackage('example.dependency', '1.0.0', definition(targetUrl, min), {}, missingFile);
  await writePackage('example.foreign', '9.0.0', definition(targetUrl, min === 1 ? 0 : 1));
  const core = { ...definition('http://hl7.org/fhir/StructureDefinition/Patient', 0), version: '4.0.1' };
  await writePackage('hl7.fhir.r4.core', '4.0.1', core);
  const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
    prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
  await validator.waitForInitialization();
  const parent = await validator.getSdLoader().loadProfile(`${parentUrl}|7.0.0`, 'R4');
  if (!parent) throw new Error('Original package referrer not loaded');
  return { validator, parent, root, writePackage };
}
const incomplete = (issues: Array<{ details?: Record<string, unknown> }>) => issues.some(issue =>
  issue.details?.validationComplete === false || issue.details?.validationStatus === 'incomplete');

describe('Actual package authority of profile references', () => {
  it('keeps a selected actual definition despite a host definition with equal canonical and business version', async () => {
    const { validator, parent } = await fixture('1.0.0', false, 0);
    setProfileSource({ getStructureDefinition: async url => url.split('|')[0] === targetUrl ? definition(targetUrl, 1) : null });
    expect(validator.getSdLoader().registerExternalProfile(definition(targetUrl, 1), 'R4')).toBe(true);
    const selected = await validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4');
    expect(selected?.snapshot?.element.find(element => element.path === 'Patient.active')?.min).toBe(0);
  });
  it.each(['1.0.4', '1.0.0-ballot', 'current'])('does not replace unavailable literal dependency %s', async release => {
    const { validator, parent } = await fixture(release);
    await expect(validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError' });
  });
  it('does not use a foreign same-version definition when the selected index file is missing', async () => {
    const { validator, parent } = await fixture('1.0.0', true);
    await expect(validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError' });
  });
  it.each(['single', 'multi'] as const)('retains unavailable dependency evidence in %s captured warm validation', async api => {
    const { validator } = await fixture('1.0.4');
    const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
    const snapshot = createValidationDependencySnapshot();
    await snapshot.run(async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const resource = { resourceType: 'Patient' };
        const result = api === 'single' ? await validator.validate(resource, `${parentUrl}|7.0.0`, 'R4', settings)
          : (await validator.validateAspects(resource, { aspects: ['structural', 'profile'], settings,
            fhirVersion: 'R4', profileUrl: `${parentUrl}|7.0.0` })).aspects.flatMap(aspect => aspect.issues);
        expect(incomplete(result)).toBe(true);
        expect(result.filter(issue => issue.code === 'profile-reference-unavailable')).toEqual([
          expect.objectContaining({ details: expect.objectContaining({ validationComplete: false,
            validationStatus: 'incomplete', source: { name: 'example.referrer', version: '3.0.0' },
            dependency: { name: 'example.dependency', version: '1.0.4' }, cause: 'dependency-missing' }) }),
        ]);
        expect(result.some(issue => issue.code === 'structural-cardinality-min' && issue.path === 'Patient.active')).toBe(false);
      }
    });
  });
  it.each(['single', 'multi'] as const)('checks genuine selected P/N for exact, short and wildcard dependency in %s', async api => {
    for (const release of ['1.0.0', '1.0', '1.0.x']) {
      const { validator } = await fixture(release);
      const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
      for (const captured of [false, true]) {
        const snapshot = createValidationDependencySnapshot();
        const run = async () => {
          for (let repeat = 0; repeat < 2; repeat++) for (const order of [[false, true], [true, false]]) for (const present of order) {
            const resource = { resourceType: 'Patient', ...(present ? { active: false } : {}) };
            const issues = api === 'single' ? await validator.validate(resource, `${parentUrl}|7.0.0`, 'R4', settings)
              : (await validator.validateAspects(resource, { aspects: ['structural', 'profile'], settings,
                fhirVersion: 'R4', profileUrl: `${parentUrl}|7.0.0` })).aspects.flatMap(aspect => aspect.issues);
            const cardinality = issues.filter(issue => issue.code === 'structural-cardinality-min' && issue.path === 'Patient.active');
            expect(cardinality.length > 0).toBe(!present);
            expect(incomplete(issues)).toBe(false);
          }
        };
        await (captured ? snapshot.run(run) : run());
      }
    }
  });
  it('retains selected authority for an explicitly versioned reference despite a foreign warm cache', async () => {
    const { validator, parent } = await fixture('1.0.0', false, 0);
    validator.getSdLoader().registerExternalProfile(definition(targetUrl, 1), 'R4');
    const selected = await validator.getSdLoader().loadReferencedProfile(`${targetUrl}|7.0.0`, parent, 'R4');
    expect(selected?.snapshot?.element.find(element => element.path === 'Patient.active')?.min).toBe(0);
  });
  it('keeps unscoped host and serialized referrers on the existing global resolution path', async () => {
    const { validator, parent } = await fixture('1.0.4', false, 0);
    validator.getSdLoader().registerExternalProfile(definition(targetUrl, 1), 'R4');
    const unscoped = JSON.parse(JSON.stringify(parent)) as typeof parent;
    for (const source of [unscoped, { url: parentUrl, version: '7.0.0' }, undefined]) {
      const selected = await validator.getSdLoader().loadReferencedProfile(targetUrl, source, 'R4');
      expect(selected?.snapshot?.element.find(element => element.path === 'Patient.active')?.min).toBe(1);
    }
  });
  it('retains a source-package hit even when its later dependency is unavailable', async () => {
    const { validator, parent } = await fixture('1.0.4');
    expect((await validator.getSdLoader().loadReferencedProfile(parentUrl, parent, 'R4'))?.url).toBe(parentUrl);
  });
  it('does not use later direct content when an earlier dependency is unavailable', async () => {
    const { validator, parent, writePackage } = await fixture('1.0.4');
    await writePackage('example.referrer', '3.0.0', definition(parentUrl, 0, true),
      { 'example.missing': '1.0.0', 'example.dependency': '1.0.0' });
    clearCanonicalPinCaches();
    await expect(validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError', receipt: { cause: 'dependency-missing' } });
  });
  it('uses a later direct hit before an earlier direct dependency missing transitive branch', async () => {
    const { validator, parent, writePackage } = await fixture();
    await writePackage('example.first', '1.0.0', definition('https://example.test/StructureDefinition/First', 0),
      { 'example.missing': '1.0.0' });
    await writePackage('example.referrer', '3.0.0', definition(parentUrl, 0, true),
      { 'example.first': '1.0.0', 'example.dependency': '1.0.0' });
    clearCanonicalPinCaches();
    expect((await validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))?.snapshot?.element
      .find(element => element.path === 'Patient.active')?.min).toBe(1);
  });

  it('replays the already-read dependency in a capture and reads fresh content outside it', async () => {
    const { validator, parent, root } = await fixture();
    const snapshot = createValidationDependencySnapshot();
    await snapshot.run(async () => {
      expect((await validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))?.snapshot?.element[1].min).toBe(1);
      await writeFile(join(root, 'example.dependency#1.0.0', 'package', 'StructureDefinition-Patient.json'),
        JSON.stringify(definition(targetUrl, 0)));
      expect((await validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))?.snapshot?.element[1].min).toBe(1);
    });
    expect((await validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))?.snapshot?.element[1].min).toBe(0);
  });
  it.each(['invalid-json', 'invalid-dependency', 'wrong-identity'] as const)('retains %s manifest opacity', async variant => {
    const { validator, parent, root } = await fixture();
    const parsed = { name: 'example.dependency', version: '1.0.0', fhirVersions: ['4.0.1'],
      dependencies: variant === 'invalid-dependency' ? { 'example.opaque': 42 } : {} };
    if (variant === 'wrong-identity') parsed.name = 'example.other';
    await writeFile(join(root, 'example.dependency#1.0.0', 'package', 'package.json'),
      variant === 'invalid-json' ? '{' : JSON.stringify(parsed));
    await expect(validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError' });
  });
  it('retains an opaque earlier store copy instead of selecting a later readable equal release', async () => {
    const { parent, root } = await fixture();
    const later = await mkdtemp(join(tmpdir(), 'records-reference-later-')); roots.push(later);
    await cp(join(root, 'example.dependency#1.0.0'), join(later, 'example.dependency#1.0.0'), { recursive: true });
    await writeFile(join(root, 'example.dependency#1.0.0', 'package', 'package.json'), '{');
    expect(await resolveProfileReferenceAuthority(targetUrl, parent, { storeDirs: [root, later], packageVersionPins: {} }, 'R4'))
      .toMatchObject({ status: 'unavailable', receipt: { cause: 'manifest-unreadable' } });
  });
  it('keeps the actual source copy even when an earlier equal source release exists', async () => {
    const { parent, root } = await fixture();
    const earlier = await mkdtemp(join(tmpdir(), 'records-reference-earlier-')); roots.push(earlier);
    await cp(join(root, 'example.referrer#3.0.0'), join(earlier, 'example.referrer#3.0.0'), { recursive: true });
    await writeFile(join(earlier, 'example.referrer#3.0.0', 'package', 'package.json'), JSON.stringify({
      name: 'example.referrer', version: '3.0.0', dependencies: { 'example.missing': '1.0.0' } }));
    expect(await resolveProfileReferenceAuthority(targetUrl, parent, { storeDirs: [earlier, root], packageVersionPins: {} }, 'R4'))
      .toMatchObject({ status: 'selected', profile: { snapshot: { element: [expect.anything(), expect.objectContaining({ min: 1 })] } } });
  });
  it('reads a selected dependency in the supported flat package layout', async () => {
    const { validator, parent, root } = await fixture();
    const folder = join(root, 'example.dependency#1.0.0');
    for (const file of ['package.json', '.index.json', 'StructureDefinition-Patient.json']) {
      await rename(join(folder, 'package', file), join(folder, file));
    }
    await rm(join(folder, 'package'), { recursive: true });
    expect((await validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))?.snapshot?.element[1].min).toBe(1);
  });
  it('reads the supported example definition only after proving the selected root absent', async () => {
    const { validator, parent, root } = await fixture();
    const folder = join(root, 'example.dependency#1.0.0', 'package');
    await mkdir(join(folder, 'example'));
    await cp(join(folder, '.index.json'), join(folder, 'example', '.index.json'));
    await cp(join(folder, 'StructureDefinition-Patient.json'), join(folder, 'example', 'StructureDefinition-Patient.json'));
    await writeFile(join(folder, '.index.json'), JSON.stringify({ files: [] }));
    await rm(join(folder, 'StructureDefinition-Patient.json'));
    expect((await validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))?.snapshot?.element[1].min).toBe(1);
    await writeFile(join(folder, 'StructureDefinition-Root.json'), JSON.stringify(definition(targetUrl, 0)));
    expect((await validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))?.snapshot?.element[1].min).toBe(0);
  });
  it.each(['missing-example-file', 'escaping-symlink', 'false-index-version'] as const)('does not conceal %s', async variant => {
    const { validator, parent, root } = await fixture();
    const folder = join(root, 'example.dependency#1.0.0', 'package');
    if (variant === 'missing-example-file') {
      await mkdir(join(folder, 'example')); await cp(join(folder, '.index.json'), join(folder, 'example', '.index.json'));
      await writeFile(join(folder, '.index.json'), JSON.stringify({ files: [] }));
      await rm(join(folder, 'StructureDefinition-Patient.json'));
    } else if (variant === 'escaping-symlink') {
      await rm(join(folder, 'StructureDefinition-Patient.json'));
      await symlink(join(root, 'example.foreign#9.0.0', 'package', 'StructureDefinition-Patient.json'), join(folder, 'StructureDefinition-Patient.json'));
    } else await writeFile(join(folder, '.index.json'), JSON.stringify({ files: [{ filename: 'StructureDefinition-Patient.json',
      resourceType: 'StructureDefinition', url: targetUrl, version: '9.9.9' }] }));
    await expect(validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError' });
  });

  it('masks an outer package selection inside an unscoped inner definition', async () => {
    const { validator, parent } = await fixture('1.0.0', false, 0);
    const owned = await validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4');
    if (!owned) throw new Error('Selected fixture unavailable');
    const host = definition(targetUrl, 1);
    validator.getSdLoader().registerExternalProfile(host, 'R4');
    const nested = await withSelectedProfileDefinition(owned, 'R4', () =>
      withSelectedProfileDefinition(host, 'R4', () => validator.getSdLoader().loadProfile(targetUrl, 'R4')));
    expect(nested?.snapshot?.element[1].min).toBe(1);
    expect((await withSelectedProfileDefinition(owned, 'R4', () => validator.getSdLoader().loadProfile(targetUrl, 'R4')))
      ?.snapshot?.element[1].min).toBe(0);
  });

  it.each(['single', 'multi'] as const)('keeps actual extension P/N/U on repeated %s public validation', async api => {
    const extUrl = 'https://example.test/StructureDefinition/OwnedBoolean';
    for (const dependency of ['1.0.0', '1.0.4']) {
      const { root, writePackage } = await fixture(dependency);
      const parent = { ...definition(parentUrl, 0), snapshot: { element: [
        { id: 'Patient', path: 'Patient', min: 0, max: '*' },
        { id: 'Patient.extension', path: 'Patient.extension', min: 0, max: '*', type: [{ code: 'Extension', profile: [extUrl] }] },
      ] } };
      const extension: StructureDefinition = { ...definition(extUrl, 0), kind: 'complex-type', type: 'Extension',
        context: [{ type: 'element', expression: 'Patient' }], snapshot: { element: [
          { id: 'Extension', path: 'Extension', min: 0, max: '*' },
          { id: 'Extension.url', path: 'Extension.url', min: 1, max: '1', fixedUri: extUrl, type: [{ code: 'uri' }] },
          { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 1, max: '1', type: [{ code: 'boolean' }] },
        ] } };
      await writePackage('example.referrer', '3.0.0', parent, { 'example.dependency': dependency });
      await writePackage('example.dependency', '1.0.0', extension);
      await writePackage('example.foreign', '9.0.0', { ...extension, snapshot: { element: [
        extension.snapshot!.element[0], extension.snapshot!.element[1],
        { ...extension.snapshot!.element[2], type: [{ code: 'string' }] },
      ] } });
      clearCanonicalPinCaches();
      const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
        prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
      await validator.waitForInitialization();
      const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
      await createValidationDependencySnapshot().run(async () => {
        for (let repeat = 0; repeat < 2; repeat++) for (const valid of [true, false, true]) {
          const resource = { resourceType: 'Patient', extension: [{ url: extUrl, ...(valid ? { valueBoolean: false } : { valueString: 'invalid' }) }] };
          const issues = api === 'single' ? await validator.validate(resource, `${parentUrl}|7.0.0`, 'R4', settings)
            : (await validator.validateAspects(resource, { aspects: ['structural', 'profile'], settings,
              fhirVersion: 'R4', profileUrl: `${parentUrl}|7.0.0` })).aspects.flatMap(aspect => aspect.issues);
          if (dependency === '1.0.4') {
            expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'profile-reference-unavailable',
              details: expect.objectContaining({ validationComplete: false, cause: 'dependency-missing',
                source: { name: 'example.referrer', version: '3.0.0' }, dependency: { name: 'example.dependency', version: '1.0.4' } }) })]));
            expect(issues.filter(issue => issue.code === 'profile-extension-wrong-value-type')).toEqual([]);
          } else {
            expect(issues.some(issue => issue.code === 'profile-extension-wrong-value-type')).toBe(!valid);
            expect(incomplete(issues)).toBe(false);
          }
        }
      });
    }
  });

  it('does not issue own provenance to a foreign symlinked example directory', async () => {
    const { validator, parent, root } = await fixture();
    const folder = join(root, 'example.dependency#1.0.0', 'package');
    await writeFile(join(folder, '.index.json'), JSON.stringify({ files: [] }));
    await rm(join(folder, 'StructureDefinition-Patient.json'));
    await symlink(join(root, 'example.foreign#9.0.0', 'package'), join(folder, 'example'));
    await expect(validator.getSdLoader().loadReferencedProfile(targetUrl, parent, 'R4'))
      .rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError', receipt: { cause: 'unsafe-file' } });
  });
  it.each(['single', 'multi'] as const)('separates differential snapshots across warm dependency pin P/N/U in %s', async api => {
    const { validator, writePackage } = await fixture();
    await writePackage('example.dependency', '2.0.0', definition(targetUrl, 0));
    const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
    for (const order of [['1.0.0', '2.0.0', '9.0.0', '1.0.0'], ['2.0.0', '1.0.0', '9.0.0', '2.0.0']]) {
      for (const release of order) {
        settings.packageDownload.pinnedVersions = { 'example.dependency': release };
        for (let repeat = 0; repeat < 2; repeat++) {
          const issues = api === 'single' ? await validator.validate({ resourceType: 'Patient' }, `${parentUrl}|7.0.0`, 'R4', settings)
            : (await validator.validateAspects({ resourceType: 'Patient' }, { aspects: ['structural', 'profile'], settings,
              fhirVersion: 'R4', profileUrl: `${parentUrl}|7.0.0` })).aspects.flatMap(aspect => aspect.issues);
          expect(issues.some(issue => issue.code === 'structural-cardinality-min' && issue.path === 'Patient.active')).toBe(release === '1.0.0');
          expect(issues.some(issue => issue.code === 'profile-reference-unavailable')).toBe(release === '9.0.0');
          expect(incomplete(issues)).toBe(release === '9.0.0');
        }
      }
    }
  });
  it('retains possible datatype slice membership for U and an independently missing finite minimum', async () => {
    const { root, writePackage } = await fixture('1.0.4');
    const selected = { ...definition(parentUrl, 0), baseDefinition: undefined, differential: undefined, snapshot: { element: [
      { id: 'Patient', path: 'Patient', min: 0, max: '*' },
      { id: 'Patient.identifier', path: 'Patient.identifier', min: 0, max: '*',
        slicing: { discriminator: [{ type: 'profile', path: '$this' }], rules: 'closed' } },
      { id: 'Patient.identifier:owned', path: 'Patient.identifier', sliceName: 'owned', min: 1, max: '1',
        type: [{ code: 'Identifier', profile: [targetUrl] }] },
    ] } } as StructureDefinition;
    await writePackage('example.referrer', '3.0.0', selected, { 'example.dependency': '1.0.4' });
    const loader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
    const profile = await loader.loadProfile(`${parentUrl}|7.0.0`, 'R4');
    if (!profile) throw new Error('Actual slicing fixture not loaded');
    const slicing = new SlicingValidator();
    slicing.setTypeProfileResolver((url, family, source) => loader.loadReferencedProfile(url, source, family));
    const identifier = { system: 'https://example.test/id', value: 'fixture' };
    for (let repeat = 0; repeat < 2; repeat++) {
      const issues = await slicing.validateSlicing([identifier], 'Patient.identifier', profile);
      expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'profile-reference-unavailable',
        details: expect.objectContaining({ validationComplete: false, cause: 'dependency-missing' }) })]));
      expect(issues.filter(issue => ['profile-slice-min-cardinality', 'profile-slice-closed-unmatched'].includes(issue.code ?? ''))).toEqual([]);
      const empty = await slicing.validateSlicing([], 'Patient.identifier', profile);
      expect(empty.some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(true);
    }
  });

  it.each(['single', 'multi'] as const)('retains differential extension authority across warm P/N/U pins in %s', async api => {
    const { root, writePackage } = await fixture();
    const extUrl = 'https://example.test/StructureDefinition/DifferentialExtension';
    const baseUrl = 'https://example.test/StructureDefinition/BaseExtension';
    const parent: StructureDefinition = { ...definition(parentUrl, 0), snapshot: undefined,
      differential: { element: [{ id: 'Patient', path: 'Patient' },
        { id: 'Patient.extension', path: 'Patient.extension', min: 0, max: '*', type: [{ code: 'Extension', profile: [extUrl] }] }] } };
    const base: StructureDefinition = { ...definition(baseUrl, 0), type: 'Extension', kind: 'complex-type',
      snapshot: { element: [{ id: 'Extension', path: 'Extension' },
        { id: 'Extension.url', path: 'Extension.url', min: 1, max: '1', type: [{ code: 'uri' }] },
        { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 1, max: '1', type: [{ code: 'boolean' }] }] } };
    const ext: StructureDefinition = { ...base, url: extUrl, snapshot: undefined, baseDefinition: baseUrl,
      context: [{ type: 'element', expression: 'Patient' }], differential: { element: [{ id: 'Extension', path: 'Extension' }] } };
    await writePackage('example.referrer', '3.0.0', parent, { 'example.dependency': '1.0.0' });
    await writeFile(join(root, 'example.referrer#3.0.0', 'package', 'StructureDefinition-Extension.json'), JSON.stringify(ext));
    await writePackage('example.dependency', '1.0.0', base);
    await writePackage('example.dependency', '2.0.0', { ...base, snapshot: { element: [
      base.snapshot!.element[0], base.snapshot!.element[1], { ...base.snapshot!.element[2], type: [{ code: 'string' }] },
    ] } });
    const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
      prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
    await validator.waitForInitialization();
    const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
    const resource = { resourceType: 'Patient', extension: [{ url: extUrl, valueBoolean: false }] };
    for (const release of ['1.0.0', '2.0.0', '9.0.0', '1.0.0', '9.0.0', '2.0.0']) {
      settings.packageDownload.pinnedVersions = { 'example.dependency': release };
      for (let repeat = 0; repeat < 2; repeat++) {
        const issues = api === 'single' ? await validator.validate(resource, `${parentUrl}|7.0.0`, 'R4', settings)
          : (await validator.validateAspects(resource, { aspects: ['structural', 'profile'], settings,
            fhirVersion: 'R4', profileUrl: `${parentUrl}|7.0.0` })).aspects.flatMap(aspect => aspect.issues);
        expect(issues.some(issue => issue.code === 'profile-extension-wrong-value-type')).toBe(release === '2.0.0');
        expect(issues.some(issue => issue.code === 'profile-reference-unavailable')).toBe(release === '9.0.0');
        expect(incomplete(issues)).toBe(release === '9.0.0');
      }
    }
  });

  it('keeps same-object datatype P/U/N membership separate across warm selected pins', async () => {
    const { root, writePackage } = await fixture();
    const source: StructureDefinition = { ...definition(parentUrl, 0), snapshot: { element: [
      { id: 'Patient', path: 'Patient', min: 0, max: '*' },
      { id: 'Patient.identifier', path: 'Patient.identifier', min: 0, max: '*',
        slicing: { discriminator: [{ type: 'profile', path: '$this' }], rules: 'closed' } },
      { id: 'Patient.identifier:owned', path: 'Patient.identifier', sliceName: 'owned', min: 1, max: '1',
        type: [{ code: 'Identifier', profile: [targetUrl] }] },
    ] } };
    const identifierProfile = (system: string): StructureDefinition => ({ ...definition(targetUrl, 0), type: 'Identifier', kind: 'complex-type',
      snapshot: { element: [{ id: 'Identifier', path: 'Identifier' },
        { id: 'Identifier.system', path: 'Identifier.system', min: 1, max: '1', type: [{ code: 'uri' }], fixedUri: system }] } });
    await writePackage('example.referrer', '3.0.0', source, { 'example.dependency': '1.0.0' });
    await writePackage('example.dependency', '1.0.0', identifierProfile('https://example.test/valid'));
    await writePackage('example.dependency', '2.0.0', identifierProfile('https://example.test/other'));
    const loader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
    const profile = await loader.loadProfile(`${parentUrl}|7.0.0`, 'R4');
    if (!profile) throw new Error('Actual slicing source not loaded');
    const slicing = new SlicingValidator();
    slicing.setTypeProfileResolver((url, family, parent) => loader.loadReferencedProfile(url, parent, family));
    const instance = { system: 'https://example.test/valid', value: 'fixture' };
    for (const release of ['1.0.0', '9.0.0', '2.0.0', '1.0.0']) {
      loader.setPackageVersionPins({ 'example.dependency': release });
      for (let repeat = 0; repeat < 2; repeat++) {
        const issues = await slicing.validateSlicing([instance], 'Patient.identifier', profile);
        expect(issues.some(issue => issue.code === 'profile-reference-unavailable')).toBe(release === '9.0.0');
        expect(issues.some(issue => ['profile-slice-pattern-mismatch', 'profile-slice-min-cardinality', 'profile-slice-closed-unmatched']
          .includes(issue.code ?? ''))).toBe(release === '2.0.0');
      }
    }
  });

});
