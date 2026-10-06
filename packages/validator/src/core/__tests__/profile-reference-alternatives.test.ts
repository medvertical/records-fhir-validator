import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import { SnapshotGenerator } from '../snapshot-generator';
import { RecordsValidator } from '../validator-engine';
import { SlicingValidator } from '../../validators/slicing-validator';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { setProfileSource } from '../../persistence/profile-source';

const sourceUrl = 'https://example.test/StructureDefinition/AlternativeSource';
const profileUrl = (name: string) => `https://example.test/StructureDefinition/${name}`;
const roots: string[] = [];
afterEach(async () => {
  setProfileSource({}); clearCanonicalPinCaches();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const element = (id: string, extra: Partial<ElementDefinition> = {}): ElementDefinition =>
  ({ id, path: id.replace(/:[^.]+/g, ''), ...extra });
const definition = (url: string, type: string, elements: ElementDefinition[], differential = false): StructureDefinition => ({
  resourceType: 'StructureDefinition', url, id: url.split('/').pop()!, name: 'AuthorityControl', version: '7.0.0',
  fhirVersion: '4.0.1', type, kind: type === 'Patient' ? 'resource' : 'complex-type', abstract: false,
  status: 'active', derivation: 'constraint',
  ...(differential ? { differential: { element: elements } } : { snapshot: { element: elements } }),
});
async function store() {
  const root = await mkdtemp(join(tmpdir(), 'records-alternative-authority-')); roots.push(root);
  const writePackage = async (name: string, version: string, profiles: StructureDefinition[], dependencies = {}) => {
    const folder = join(root, `${name}#${version}`, 'package'); await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), JSON.stringify({ name, version, dependencies }));
    await writeFile(join(folder, '.index.json'), JSON.stringify({ files: profiles.map((profile) => ({
      filename: `StructureDefinition-${profile.id}.json`, resourceType: 'StructureDefinition', url: profile.url, version: profile.version,
    })) }));
    await Promise.all(profiles.map((profile) => writeFile(join(folder, `StructureDefinition-${profile.id}.json`), JSON.stringify(profile))));
  };
  return { root, writePackage };
}
const failureCodes = ['profile-slice-min-cardinality', 'profile-slice-closed-unmatched', 'profile-slice-fixed-value-mismatch', 'profile-slice-pattern-mismatch'];

describe('Actual profile alternatives and inherited definitions', () => {
  it.each(['slicing', 'single', 'multi'] as const)('retains OR P/N/U and local negative evidence through %s', async api => {
    const { root, writePackage } = await store();
    const identifier = (url: string, fixed: string) => definition(url, 'Identifier', [element('Identifier'),
      element('Identifier.system', { min: 1, max: '1', type: [{ code: 'uri' }], fixedUri: fixed })]);
    const selected = (local = false, neighbour = false) => definition(sourceUrl, 'Patient', [element('Patient'),
      element('Patient.identifier', { min: 0, max: '*', type: [{ code: 'Identifier' }],
        slicing: { discriminator: [{ type: 'profile', path: '$this' }], rules: 'closed' } }),
      element('Patient.identifier:owned', { sliceName: 'owned', min: 1, max: '1',
        type: [{ code: 'Identifier', profile: [profileUrl('A'), profileUrl('B')] }] }),
      ...(local ? [element('Patient.identifier:owned.system', { fixedUri: 'https://example.test/local' })] : []),
      ...(neighbour ? [element('Patient.identifier:neighbour', { sliceName: 'neighbour', min: 0, max: '*', type: [{ code: 'Identifier' }] })] : []),
    ]);
    await writePackage('example.source', '3.0.0', [selected(), identifier(profileUrl('A'), 'https://example.test/x')], { 'example.alternative': '1.0.0' });
    await writePackage('example.alternative', '1.0.0', [identifier(profileUrl('B'), 'https://example.test/y')]);
    const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
      prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
    await validator.waitForInitialization();
    const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
    const loader = validator.getSdLoader();
    const slicing = new SlicingValidator();
    slicing.setTypeProfileResolver((url, family, source) => loader.loadReferencedProfile(url, source, family));
    for (const scenario of [
      { release: '9.0.0', system: 'x', unknown: true, negative: false },
      { release: '9.0.0', system: 'x', unknown: true, negative: false, count: 2 },
      { release: '9.0.0', system: 'y', unknown: true, negative: false },
      { release: '1.0.0', system: 'y', unknown: false, negative: false },
      { release: '1.0.0', system: 'z', unknown: false, negative: true },
      { release: '9.0.0', system: 'y', unknown: true, negative: false, neighbour: true },
      { release: '9.0.0', system: 'y', unknown: true, negative: true, local: true },
      { release: '9.0.0', system: 'x', unknown: true, negative: false },
    ]) {
      await writePackage('example.source', '3.0.0', [selected(scenario.local, scenario.neighbour), identifier(profileUrl('A'), 'https://example.test/x')], { 'example.alternative': '1.0.0' });
      loader.clearCache(); clearCanonicalPinCaches();
      settings.packageDownload.pinnedVersions = { 'example.alternative': scenario.release };
      loader.setPackageVersionPins(settings.packageDownload.pinnedVersions);
      const source = await loader.loadProfile(`${sourceUrl}|7.0.0`, 'R4');
      if (!source) throw new Error('Actual alternative source not loaded');
      const instances = Array.from({ length: scenario.count ?? 1 }, () => ({ system: `https://example.test/${scenario.system}`, value: 'fixture' }));
      for (let warm = 0; warm < 2; warm++) {
        const resource = { resourceType: 'Patient', identifier: instances };
        const issues = api === 'slicing' ? await slicing.validateSlicing(instances, 'Patient.identifier', source)
          : api === 'single' ? await validator.validate(resource, `${sourceUrl}|7.0.0`, 'R4', settings)
            : (await validator.validateAspects(resource, { aspects: ['structural', 'profile'], settings,
              fhirVersion: 'R4', profileUrl: `${sourceUrl}|7.0.0` })).aspects.flatMap(aspect => aspect.issues);
        expect(issues.some(issue => issue.code === 'profile-reference-unavailable'), JSON.stringify(scenario)).toBe(scenario.unknown);
        expect(issues.some(issue => failureCodes.includes(issue.code ?? '')), JSON.stringify(scenario)).toBe(scenario.negative);
        expect(issues.some(issue => issue.code === 'profile-slice-max-cardinality'), JSON.stringify(scenario)).toBe(scenario.count === 2);
      }
      if (api === 'slicing') expect((await slicing.validateSlicing([], 'Patient.identifier', source))
        .some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(true);
    }
  });

  it.each([['R4', 'R5'], ['R5', 'R4']] as const)('isolates snapshot cache for requested families %s then %s', async (...order) => {
    const { root, writePackage } = await store();
    for (const family of ['R4', 'R5'] as const) {
      const core = { ...definition('http://hl7.org/fhir/StructureDefinition/Encounter', 'Encounter', [element('Encounter'),
        element('Encounter.class', { min: family === 'R4' ? 1 : 0, max: family === 'R4' ? '1' : '*' })]),
        fhirVersion: family === 'R4' ? '4.0.1' : '5.0.0', version: family === 'R4' ? '4.0.1' : '5.0.0' };
      await writePackage(`hl7.fhir.${family.toLowerCase()}.core`, core.version, [core]);
    }
    const loader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
    await loader.waitForInitialization();
    const generator = new SnapshotGenerator(loader);
    const derived = { ...definition(profileUrl('DerivedEncounter'), 'Encounter', [element('Encounter')], true),
      fhirVersion: undefined, baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Encounter' };
    for (const family of [...order, ...order]) {
      const snapshot = await generator.generateSnapshot(derived, { fhirVersion: family });
      expect(snapshot.find(candidate => candidate.path === 'Encounter.class')?.min).toBe(family === 'R4' ? 1 : 0);
    }
  });

  it.each(['single', 'multi'] as const)('checks inherited required subextensions in warm %s P/N/U controls', async api => {
    const { root, writePackage } = await store();
    const extUrl = profileUrl('NestedExtension');
    const baseUrl = profileUrl('NestedBase');
    const base = (min: number) => definition(baseUrl, 'Extension', [element('Extension'),
      element('Extension.url', { min: 1, max: '1', type: [{ code: 'uri' }] }),
      element('Extension.extension', { min: 0, max: '*', type: [{ code: 'Extension' }],
        slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'closed' } }),
      element('Extension.extension:required', { sliceName: 'required', min, max: '1', type: [{ code: 'Extension' }] }),
      element('Extension.extension:required.url', { fixedUri: 'required', min: 1, max: '1' }),
      element('Extension.extension:required.value[x]', { min: 1, max: '1', type: [{ code: 'boolean' }] }),
    ]);
    const derived = { ...definition(extUrl, 'Extension', [element('Extension'),
      element('Extension.extension:other', { sliceName: 'other', min: 0, max: '1', type: [{ code: 'Extension' }] }),
      element('Extension.extension:other.url', { fixedUri: 'other', min: 1, max: '1' }),
      element('Extension.extension:other.value[x]', { min: 1, max: '1', type: [{ code: 'boolean' }] }),
    ], true), baseDefinition: baseUrl, context: [{ type: 'element' as const, expression: 'Patient' }] };
    const source = definition(sourceUrl, 'Patient', [element('Patient'),
      element('Patient.extension', { min: 0, max: '*', type: [{ code: 'Extension', profile: [extUrl] }] })]);
    await writePackage('example.source', '3.0.0', [source, derived], { 'example.nestedbase': '1.0.0' });
    await writePackage('example.nestedbase', '1.0.0', [base(1)]);
    await writePackage('example.nestedbase', '2.0.0', [base(0)]);
    const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
      prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
    await validator.waitForInitialization();
    const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
    for (const release of ['1.0.0', '2.0.0', '9.0.0', '1.0.0']) {
      settings.packageDownload.pinnedVersions = { 'example.nestedbase': release };
      for (const presence of ['absent-array', 'absent-required', 'required'] as const) for (let warm = 0; warm < 2; warm++) {
        const present = presence === 'required';
        const nested = [{ url: 'other', valueBoolean: false }, ...(present ? [{ url: 'required', valueBoolean: true }] : [])];
        const resource = { resourceType: 'Patient', extension: [{ url: extUrl, ...(presence === 'absent-array' ? {} : { extension: nested }) }] };
        const issues = api === 'single' ? await validator.validate(resource, `${sourceUrl}|7.0.0`, 'R4', settings)
          : (await validator.validateAspects(resource, { aspects: ['structural', 'profile'], settings,
            fhirVersion: 'R4', profileUrl: `${sourceUrl}|7.0.0` })).aspects.flatMap(aspect => aspect.issues);
        expect(issues.some(issue => issue.code === 'profile-extension-min-cardinality')).toBe(release === '1.0.0' && !present);
        expect(issues.some(issue => issue.code === 'profile-reference-unavailable')).toBe(release === '9.0.0');
        if (release === '9.0.0') expect(issues.filter(issue => issue.code === 'profile-reference-unavailable')).toEqual(expect.arrayContaining([
          expect.objectContaining({ details: expect.objectContaining({ validationComplete: false, validationStatus: 'incomplete',
            source: { name: 'example.source', version: '3.0.0' }, dependency: { name: 'example.nestedbase', version: '9.0.0' },
            cause: 'dependency-missing' }) }),
        ]));
        expect(issues.some(issue => issue.code === 'profile-extension-subextension-invalid')).toBe(false);
      }
    }
  });


  it.each(['optional-value-absent', 'optional-slice-absent', 'optional-slice-other'] as const)(
    'retains U instead of a local false N for %s', async scenario => {
      const { root, writePackage } = await store();
      const local = scenario === 'optional-value-absent'
        ? [element('Patient.identifier:owned.system', { min: 0, max: '1', fixedUri: 'https://example.test/local' })]
        : [element('Patient.identifier:owned.extension', { min: 0, max: '*', type: [{ code: 'Extension' }],
          slicing: { discriminator: [{ type: 'value', path: 'url' }], rules: 'open' } }),
        element('Patient.identifier:owned.extension:optional', { sliceName: 'optional', min: 0, max: '1', type: [{ code: 'Extension' }] }),
        element('Patient.identifier:owned.extension:optional.url', { fixedUri: 'optional', min: 1, max: '1' })];
      const source = definition(sourceUrl, 'Patient', [element('Patient'),
        element('Patient.identifier', { min: 0, max: '*', type: [{ code: 'Identifier' }],
          slicing: { discriminator: [{ type: 'profile', path: '$this' }], rules: 'closed' } }),
        element('Patient.identifier:owned', { sliceName: 'owned', min: 1, max: '1',
          type: [{ code: 'Identifier', profile: [profileUrl('A'), profileUrl('B')] }] }), ...local]);
      const known = definition(profileUrl('A'), 'Identifier', [element('Identifier'),
        element('Identifier.system', { min: 1, max: '1', fixedUri: 'https://example.test/x' })]);
      await writePackage('example.source', '3.0.0', [source, known], { 'example.missing': '1.0.0' });
      const loader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
      await loader.waitForInitialization();
      const selected = await loader.loadProfile(`${sourceUrl}|7.0.0`, 'R4');
      if (!selected) throw new Error('Optional constraint source not loaded');
      const slicing = new SlicingValidator();
      slicing.setTypeProfileResolver((url, family, parent) => loader.loadReferencedProfile(url, parent, family));
      const value = { value: 'fixture', ...(scenario === 'optional-slice-other' ? { extension: [{ url: 'other', valueBoolean: true }] } : {}) };
      for (let warm = 0; warm < 2; warm++) {
        const issues = await slicing.validateSlicing([value], 'Patient.identifier', selected);
        expect(issues.some(issue => issue.code === 'profile-reference-unavailable')).toBe(true);
        expect(issues.filter(issue => failureCodes.includes(issue.code ?? ''))).toEqual([]);
      }
    });

});
