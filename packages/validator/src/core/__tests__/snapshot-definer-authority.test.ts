import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { RecordsValidator } from '../validator-engine';
import { createValidationDependencySnapshot, captureValidationDependency } from '../../validation-dependency-snapshot';
import { withSelectedProfileDefinition } from '../profile-reference-authority';
import { snapshotTypeSource } from '../snapshot-type-profile-authority';
import { SnapshotGenerator } from '../snapshot-generator';
import { StructureDefinitionLoader } from '../structure-definition-loader';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { copyProfilePackageProvenance, lookupProfilePackageProvenance } from '../../package/canonical-pin-provenance';

const canonical = 'https://example.test/StructureDefinition/OwnedIdentifier';
const baseUrl = 'https://example.test/StructureDefinition/BasePatient';
const childUrl = 'https://example.test/StructureDefinition/ChildPatient';
const roots: string[] = [];
afterEach(async () => {
  clearCanonicalPinCaches();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const element = (id: string, extra: Partial<ElementDefinition> = {}): ElementDefinition =>
  ({ id, path: id.replace(/:[^.]+/g, ''), ...extra });
function profile(url: string, type: string, elements: ElementDefinition[], baseDefinition?: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url, version: '7.0.0', fhirVersion: '4.0.1', name: 'OwnedProfile',
    status: 'active', kind: type === 'Patient' ? 'resource' : 'complex-type', abstract: false, type,
    ...(baseDefinition ? { baseDefinition, differential: { element: elements } } : { snapshot: { element: elements } }) };
}
async function fixture(mode: 'inherited' | 'override' | 'both' | 'grandchild' | 'public' = 'inherited', baseDependency = '1.0.0') {
  const root = await mkdtemp(join(tmpdir(), 'records-snapshot-definer-')); roots.push(root);
  const writePackage = async (name: string, release: string, definitions: StructureDefinition[], dependencies = {}) => {
    const directory = join(root, `${name}#${release}`, 'package'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: release, fhirVersions: ['4.0.1'], dependencies }));
    await writeFile(join(directory, '.index.json'), JSON.stringify({ 'index-version': 2, files: definitions.map((sd, index) =>
      ({ filename: `StructureDefinition-${index}.json`, resourceType: sd.resourceType, url: sd.url, version: sd.version })) }));
    await Promise.all(definitions.map((sd, index) => writeFile(join(directory, `StructureDefinition-${index}.json`), JSON.stringify(sd))));
  };
  for (const [release, fixedString] of [['1.0.0', 'BASE'], ['2.0.0', 'CHILD'], ['9.0.0', 'FOREIGN']])
    await writePackage('example.identifier', release, [profile(canonical, 'Identifier', [
      element('Identifier'), element('Identifier.value', { min: 1, max: '1', fixedString, type: [{ code: 'string' }] }),
    ])]);
  await writePackage('hl7.fhir.r4.core', '4.0.1', [{ ...profile('http://hl7.org/fhir/StructureDefinition/Patient', 'Patient', [
    element('Patient'), element('Patient.identifier', { type: [{ code: 'Identifier' }] }),
  ]), version: '4.0.1' }]);
  const inheritedId = mode === 'public' ? 'Patient.identifier' : 'Patient.identifier:inherited';
  const slice = mode === 'public' ? {} : { sliceName: 'inherited' };
  await writePackage('example.base', '1.0.0', [profile(baseUrl, 'Patient', [element('Patient'),
    element(inheritedId, { ...slice, type: [{ code: 'Identifier', profile: [canonical] }] }),
  ])], { 'example.identifier': baseDependency });
  const explicit = mode === 'override' ? { type: [{ code: 'Identifier', profile: [canonical] }] } : {};
  const children = [element(inheritedId, { ...slice, mustSupport: true, ...explicit })];
  if (mode !== 'grandchild') children.push(element(`${inheritedId}.value`, { mustSupport: true }));
  if (mode === 'both') children.push(
    element('Patient.identifier:explicit', { sliceName: 'explicit', type: [{ code: 'Identifier', profile: [canonical] }] }),
    element('Patient.identifier:explicit.value', { mustSupport: true }));
  const child = profile(childUrl, 'Patient', children, baseUrl);
  await writePackage('example.child', '1.0.0', [child], { 'example.base': '1.0.0', 'example.identifier': '2.0.0' });
  let selectedUrl = childUrl;
  if (mode === 'grandchild') {
    selectedUrl = `${childUrl}Grandchild`;
    await writePackage('example.grandchild', '1.0.0', [profile(selectedUrl, 'Patient', [
      element('Patient.identifier:inherited', { sliceName: 'inherited', short: 'Grandchild constraint' }),
      element('Patient.identifier:inherited.value', { min: 1 }),
    ], childUrl)], { 'example.child': '1.0.0', 'example.identifier': '9.0.0' });
  }
  const loader = new StructureDefinitionLoader(root, root, { autoDownload: false, prewarmProfileSource: false });
  await loader.waitForInitialization();
  const selected = await loader.loadProfile(`${selectedUrl}|7.0.0`, 'R4');
  if (!selected) throw new Error('Actual installed fixture unavailable');
  return { root, writePackage, loader, selected, generator: new SnapshotGenerator(loader) };
}
const value = (snapshot: ElementDefinition[], slice = 'inherited') =>
  snapshot.find(item => item.id === `Patient.identifier:${slice}.value`);

describe('actual defining package of inherited type profile expansion', () => {
  it.each([{ label: 'null entry', types: [null] }, { label: 'object container', types: {} },
    { label: 'scalar entry', types: [42] }, { label: 'scalar profile', types: [{ code: 'Identifier', profile: 42 }] }])('preserves a supplied snapshot with an unrelated malformed $label during metadata stamping', async ({ types }) => {
    const elements = [element('Patient'), element('Patient.identifier'), element('Patient.active', { min: 1 })];
    Reflect.set(elements[1], 'type', types);
    const supplied = profile('https://example.test/StructureDefinition/RawSnapshot', 'Patient', elements);
    const bytes = JSON.stringify(supplied);
    const generator = new SnapshotGenerator(new StructureDefinitionLoader(undefined, null, { autoDownload: false, prewarmProfileSource: false }));
    expect(await generator.generateSnapshot(supplied)).toBe(supplied.snapshot!.element);
    expect(JSON.stringify(supplied)).toBe(bytes);
  });
  it('loads an inherited type through its base package rather than the derived dependency', async () => {
    const { loader, selected, generator } = await fixture();
    const reads = vi.spyOn(loader, 'loadReferencedProfile');
    const bytes = JSON.stringify(selected);
    const snapshot = await generator.generateSnapshot(selected, { fhirVersion: 'R4' });
    expect(value(snapshot)).toMatchObject({ fixedString: 'BASE', min: 1, mustSupport: true });
    const typeRead = reads.mock.calls.find(([url]) => url === canonical);
    expect(lookupProfilePackageProvenance(typeRead?.[1] ?? {})).toEqual({ name: 'example.base', version: '1.0.0' });
    expect(JSON.stringify(selected)).toBe(bytes);
  });
  it('uses the derived package for an explicit type profile override with the same canonical', async () => {
    const { selected, generator } = await fixture('override');
    expect(value(await generator.generateSnapshot(selected))).toMatchObject({ fixedString: 'CHILD', min: 1 });
  });
  it('uses the same inferred legacy slice scope for selection and expansion', async () => {
    const { selected, generator } = await fixture('override');
    for (const child of selected.differential!.element) delete child.id;
    expect(value(await generator.generateSnapshot(selected))).toMatchObject({ fixedString: 'CHILD', mustSupport: true });
  });
  it('does not resolve an unused unavailable base reference after an explicit override', async () => {
    const { selected, generator } = await fixture('override', '1.0.4');
    expect(value(await generator.generateSnapshot(selected))).toMatchObject({ fixedString: 'CHILD' });
  });
  it('inherits the base definer when a differential repeats only the type code', async () => {
    const { selected, generator } = await fixture();
    selected.differential!.element[0].type = [{ code: 'Identifier' }];
    expect(value(await generator.generateSnapshot(selected))).toMatchObject({ fixedString: 'BASE' });
  });
  it('expands an inherited profiled type when only its child is in the differential', async () => {
    const { selected, generator } = await fixture();
    selected.differential!.element.shift();
    expect(value(await generator.generateSnapshot(selected))).toMatchObject({ fixedString: 'BASE', mustSupport: true });
  });
  it('keeps two equal canonicals from distinct defining packages separate in one snapshot', async () => {
    const { selected, generator } = await fixture('both');
    const snapshot = await generator.generateSnapshot(selected);
    expect(value(snapshot)).toMatchObject({ fixedString: 'BASE' });
    expect(value(snapshot, 'explicit')).toMatchObject({ fixedString: 'CHILD' });
  });
  it('retains the actual definer through an intermediate generated snapshot', async () => {
    const { selected, generator } = await fixture('grandchild');
    expect(value(await generator.generateSnapshot(selected))).toMatchObject({ fixedString: 'BASE', min: 1 });
  });
  it('retains unavailable defining dependency evidence instead of borrowing a derived hit', async () => {
    const { selected, generator } = await fixture('inherited', '1.0.4');
    await expect(generator.generateSnapshot(selected)).rejects.toMatchObject({ name: 'ProfileReferenceUnavailableError',
      receipt: { source: { name: 'example.base', version: '1.0.0' }, dependency: { name: 'example.identifier', version: '1.0.4' } } });
  });
  it('loads an explicit different edition of the defining Extension canonical', async () => {
    const { loader, generator, writePackage } = await fixture();
    const extensionUrl = 'https://example.test/StructureDefinition/EditionExtension';
    const derivedUrl = `${extensionUrl}Child`;
    await writePackage('example.extension-base', '1.0.0', [profile(extensionUrl, 'Extension', [
      element('Extension'), element('Extension.extension', { type: [{ code: 'Extension', profile: [`${extensionUrl}|8.0.0`] }] }),
    ])], { 'example.extension-next': '1.0.0' });
    await writePackage('example.extension-next', '1.0.0', [{ ...profile(extensionUrl, 'Extension', [
      element('Extension'), element('Extension.value[x]', { min: 1, fixedString: 'EDITION8', type: [{ code: 'string' }] }),
    ]), version: '8.0.0' }]);
    await writePackage('example.extension-child', '1.0.0', [profile(derivedUrl, 'Extension', [
      element('Extension.extension'), element('Extension.extension.value[x]', { mustSupport: true }),
    ], `${extensionUrl}|7.0.0`)], { 'example.extension-base': '1.0.0' });
    clearCanonicalPinCaches();
    const selected = await loader.loadProfile(`${derivedUrl}|7.0.0`, 'R4');
    if (!selected) throw new Error('Actual edition fixture unavailable');
    const snapshot = await generator.generateSnapshot(selected);
    expect(snapshot.find(item => item.id === 'Extension.extension.value[x]')).toMatchObject({ fixedString: 'EDITION8', min: 1 });
  });
  it('preserves the definer through selected and captured copies of a generated intermediate snapshot', async () => {
    const { loader, selected, generator } = await fixture('grandchild');
    const child = await loader.loadReferencedProfile(childUrl, selected, 'R4');
    if (!child) throw new Error('Actual intermediate unavailable');
    const materialized = { ...child, snapshot: { element: await generator.generateSnapshot(child) } };
    const bytes = JSON.stringify(materialized);
    const capture = createValidationDependencySnapshot();
    await capture.run(async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const copied = await captureValidationDependency('profile', 'generated-intermediate', [childUrl], () =>
          withSelectedProfileDefinition(materialized, 'R4', () => loader.loadProfile(`${childUrl}|7.0.0`, 'R4')));
        if (!copied?.snapshot) throw new Error('Detached intermediate unavailable');
        const type = copied.snapshot.element[1].type![0];
        const source = snapshotTypeSource(type, copied);
        expect(lookupProfilePackageProvenance(source)).toEqual({ name: 'example.base', version: '1.0.0' });
        expect((await loader.loadReferencedProfile(canonical, source, 'R4'))?.snapshot?.element[1].fixedString).toBe('BASE');
        expect(JSON.stringify(copied)).toBe(bytes);
        const changed = structuredClone(copied);
        changed.snapshot!.element[1].id = 'Patient.identifier:different';
        copyProfilePackageProvenance(copied, changed);
        expect(lookupProfilePackageProvenance(snapshotTypeSource(changed.snapshot!.element[1].type![0], changed)))
          .toEqual({ name: 'example.child', version: '1.0.0' });
      }
    });
  });
  it.each(['single', 'multi'] as const)('keeps public %s P/N/U tied to the inherited package in warm and captured calls', async api => {
    for (const dependency of ['1.0.0', '1.0.4']) {
      const { root } = await fixture('public', dependency);
      const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
        prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
      await validator.waitForInitialization();
      const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
      for (const captured of [false, true]) {
        const run = async () => {
          for (const order of [['BASE', 'CHILD'], ['CHILD', 'BASE']]) for (const fixedString of order) {
            const resource = { resourceType: 'Patient', identifier: [{ value: fixedString }] };
            const input = JSON.stringify([resource, settings]);
            const issues = api === 'single' ? await validator.validate(resource, `${childUrl}|7.0.0`, 'R4', settings)
              : (await validator.validateAspects(resource, { aspects: ['structural', 'profile'], settings,
                fhirVersion: 'R4', profileUrl: `${childUrl}|7.0.0` })).aspects.flatMap(aspect => aspect.issues);
            const fixed = issues.filter(issue => issue.code === 'profile-fixed-value-mismatch');
            expect(fixed.length > 0).toBe(dependency === '1.0.0' && fixedString === 'CHILD');
            const unavailable = issues.filter(issue => issue.code === 'profile-reference-unavailable');
            expect(unavailable.length > 0).toBe(dependency === '1.0.4');
            if (dependency === '1.0.4') expect(unavailable.every(issue => issue.details?.validationComplete === false)).toBe(true);
            expect(JSON.stringify([resource, settings])).toBe(input);
          }
        };
        await (captured ? createValidationDependencySnapshot().run(run) : run());
      }
    }
  });
  it('keeps the defining dependency on repeated generation after warming a foreign canonical', async () => {
    const { loader, selected, generator } = await fixture();
    expect((await loader.loadReferencedProfile(canonical, selected, 'R4'))?.snapshot?.element[1].fixedString).toBe('CHILD');
    for (let repeat = 0; repeat < 2; repeat++) expect(value(await generator.generateSnapshot(selected))).toMatchObject({ fixedString: 'BASE' });
  });
});
