import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createValidatorCoreRuntime } from '../validator-core-components';
import { resolveRecordsValidatorConfig } from '../validator-engine-config';
import { TerminologyExecutor } from '../executors/terminology-executor';
import { getValueAtPath } from '../validation-utils';
import { setProfileSource } from '../../persistence';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { validateExtensionValueElements } from '../../validators/extension-value-profile-validation';
import { validateComplexTypeSubElement } from '../../validators/complex-type-sub-element-validation';

const profileUrl = 'https://example.test/StructureDefinition/BindingScope';
const valueSetUrl = 'https://example.test/ValueSet/binding-scope';
const system = 'https://example.test/CodeSystem/binding-scope';
const extensionUrl = 'https://example.test/StructureDefinition/ScopedExtension';
const datatypeUrl = 'https://example.test/StructureDefinition/ScopedIdentifier';
const roots: string[] = [];

afterEach(async () => {
  setProfileSource({});
  clearCanonicalPinCaches();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(version: string, code: string, terminologyClosed = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'records-binding-scope-'));
  roots.push(root);
  const store = path.join(root, 'packages'); const bundled = path.join(root, 'bundled');
  const folder = path.join(store, 'scope.profile#1.0.0', 'package');
  await mkdir(folder, { recursive: true }); await mkdir(bundled);
  const resources = [
    { resourceType: 'StructureDefinition', id: 'BindingScope', url: profileUrl, version: '1.0.0', name: 'BindingScope',
      status: 'active', kind: 'resource', abstract: false, type: 'Patient', fhirVersion: '4.0.1', derivation: 'constraint',
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient', snapshot: { element: [
        { id: 'Patient', path: 'Patient', min: 0, max: '*' },
        { id: 'Patient.gender', path: 'Patient.gender', min: 0, max: '1', type: [{ code: 'code' }],
          binding: { strength: 'required', valueSet: valueSetUrl } },
      ] } },
    { resourceType: 'StructureDefinition', id: 'ScopedExtension', url: extensionUrl, version: '1.0.0', name: 'ScopedExtension',
      status: 'active', kind: 'complex-type', abstract: false, type: 'Extension', fhirVersion: '4.0.1', derivation: 'constraint',
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Extension', snapshot: { element: [
        { id: 'Extension', path: 'Extension', min: 0, max: '*' },
        { id: 'Extension.value[x]', path: 'Extension.value[x]', min: 1, max: '1', type: [{ code: 'code' }],
          binding: { strength: 'required', valueSet: valueSetUrl } },
      ] } },
    { resourceType: 'StructureDefinition', id: 'ScopedIdentifier', url: datatypeUrl, version: '1.0.0', name: 'ScopedIdentifier',
      status: 'active', kind: 'complex-type', abstract: false, type: 'Identifier', fhirVersion: '4.0.1', derivation: 'constraint',
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Identifier', snapshot: { element: [
        { id: 'Identifier', path: 'Identifier', min: 0, max: '*' },
        { id: 'Identifier.type', path: 'Identifier.type', min: 0, max: '1', type: [{ code: 'CodeableConcept' }],
          binding: { strength: 'required', valueSet: valueSetUrl } },
      ] } },
    { resourceType: 'ValueSet', id: 'binding-scope', url: valueSetUrl, version, status: 'active',
      compose: { include: [{ system, concept: [{ code }] }] } },
    { resourceType: 'CodeSystem', id: 'binding-scope', url: system, version: '1.0.0', status: 'active',
      content: 'complete', caseSensitive: true, concept: [{ code: 'a' }, { code: 'b' }] },
  ];
  await writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: 'scope.profile', version: '1.0.0', fhirVersions: ['4.0.1'] }));
  await Promise.all(resources.map(resource => writeFile(path.join(folder, `${resource.resourceType}-${resource.id}.json`), JSON.stringify(resource))));
  await writeFile(path.join(folder, '.index.json'), JSON.stringify({ 'index-version': 2,
    files: resources.map(({ resourceType, id, url, version: businessVersion }) => ({ filename: `${resourceType}-${id}.json`, resourceType, url, version: businessVersion })) }));
  const runtime = createValidatorCoreRuntime(resolveRecordsValidatorConfig({
    packageCachePath: store, bundledProfilesPath: bundled, autoDownload: false, prewarmProfileSource: false,
    terminologyPackageDirectories: terminologyClosed ? [] : [store],
  }));
  await runtime.components.sdLoader.waitForInitialization();
  const profile = await runtime.components.sdLoader.loadProfile(`${profileUrl}|1.0.0`, 'R4');
  if (!profile) throw new Error('Fixture profile unavailable');
  const executor = new TerminologyExecutor(runtime.components.valuesetValidator, runtime.terminologyCache);
  executor.configureResolution({ strategy: 'local-only', reportUnverifiedBindings: true, strictUnverifiedRequiredBindings: true });
  const validate = (candidate: string) => executor.validate({
    resource: { resourceType: 'Patient', gender: candidate }, structureDef: profile,
    fhirVersion: 'R4', getValueAtPath,
  });
  return { store, validate, runtime };
}

describe('binding versions use the same instance stores as ValueSet membership', () => {
  it.each([['1.0.0', '2.0.0'], ['2.0.0', '1.0.0']])('isolates concurrent stores with ValueSet versions %s and %s', async (firstVersion, secondVersion) => {
    const first = await fixture(firstVersion, 'a'); const second = await fixture(secondVersion, 'b');
    setProfileSource({ packageDirectories: [second.store] });
    for (let round = 0; round < 2; round++) {
      const [validFirst, validSecond, invalidFirst, invalidSecond] = await Promise.all([
        first.validate('a'), second.validate('b'), first.validate('b'), second.validate('a'),
      ]);
      expect(validFirst).toEqual([]); expect(validSecond).toEqual([]);
      for (const issues of [invalidFirst, invalidSecond]) {
        expect(issues.some(issue => issue.code === 'terminology-binding-required-code' && issue.severity === 'error')).toBe(true);
        expect(issues.some(issue => issue.details?.validationComplete === false || issue.code.includes('unverified'))).toBe(false);
      }
    }
  });

  it('keeps unavailable local terminology incomplete when an unrelated global store can answer', async () => {
    const closed = await fixture('1.0.0', 'a', true); const global = await fixture('2.0.0', 'b');
    setProfileSource({ packageDirectories: [global.store] });
    const issues = await closed.validate('a');
    expect(issues.some(issue => issue.code === 'terminology-binding-unverified')).toBe(true);
    expect(issues.some(issue => issue.code === 'terminology-binding-required-code')).toBe(false);
    expect(issues.find(issue => issue.code === 'terminology-binding-unverified')?.message).toContain(valueSetUrl);
    expect(issues.find(issue => issue.code === 'terminology-binding-unverified')?.message).not.toContain(`${valueSetUrl}|2.0.0`);
  });

  it.each(['extension', 'datatype'] as const)('keeps %s value bindings in the same scoped stores', async pathKind => {
    const first = await fixture('1.0.0', 'a'); const second = await fixture('2.0.0', 'b');
    setProfileSource({ packageDirectories: [second.store] });
    const components = first.runtime.components;
    const definition = await components.sdLoader.loadProfile(pathKind === 'extension' ? extensionUrl : datatypeUrl, 'R4');
    if (!definition?.snapshot) throw new Error('Scoped definition unavailable');
    const element = definition.snapshot.element[1];
    const validate = (code: string) => pathKind === 'extension'
      ? validateExtensionValueElements({
        extension: { url: extensionUrl, valueCode: code }, valueElements: [element], path: 'Patient.extension[0]',
        profileUrl, definition, context: { resource: { resourceType: 'Patient' }, fhirVersion: 'R4',
          profileSD: definition, profileUrl, strictMode: false, getValueAtPath },
        typeValidator: components.typeValidator, valueSetValidator: components.valuesetValidator,
        elementRulesValidator: components.elementRulesValidator,
      })
      : validateComplexTypeSubElement({
        value: { type: { coding: [{ system, code }] } }, elementPath: 'Identifier.type', subElementDef: element,
        typeCode: 'Identifier', basePath: 'Patient.identifier[0]', profileUrl, parentStructureDef: definition, fhirVersion: 'R4',
      }, { valueSetValidator: components.valuesetValidator, validateNested: async () => [] });
    expect(await validate('a')).toEqual([]);
    expect(await validate('b')).toEqual(expect.arrayContaining([expect.objectContaining({
      code: pathKind === 'extension' ? 'terminology-binding-required-code' : 'terminology-binding-required', severity: 'error',
      message: expect.stringContaining(`${valueSetUrl}|1.0.0`),
    })]));
  });
});
