import { DEFAULT_VALIDATION_SETTINGS_R4, type ValidationIssue } from '@records-fhir/validation-types';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createValidationDependencySnapshot } from '../../validation-dependency-snapshot';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { lookupProfilePackageProvenance } from '../../package/canonical-pin-provenance';
import { setProfileSource } from '../../persistence';
import { RecordsValidator } from '../validator-engine';

const profileUrl = 'https://example.test/StructureDefinition/CapturedPatient';
const valueSetUrl = 'https://example.test/ValueSet/captured-gender';
const system = 'https://example.test/CodeSystem/captured-gender';
const roots: string[] = [];
afterEach(async () => {
  setProfileSource({}); clearCanonicalPinCaches();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

interface FixtureResource extends Record<string, unknown> { resourceType: string; id: string; url: string; version: string }
async function writePackage(root: string, name: string, version: string, resources: FixtureResource[], dependencies = {}) {
  const folder = join(root, `${name}#${version}`, 'package'); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'package.json'), JSON.stringify({ name, version, fhirVersions: ['4.0.1'], dependencies }));
  await Promise.all(resources.map(resource => writeFile(join(folder, `${resource.resourceType}-${resource.id}.json`), JSON.stringify(resource))));
  await writeFile(join(folder, '.index.json'), JSON.stringify({ 'index-version': 2, files: resources.map(resource => ({
    resourceType: resource.resourceType, url: resource.url, version: resource.version,
    filename: `${resource.resourceType}-${resource.id}.json`,
  })) }));
}
async function fixture(closed = false) {
  const root = await mkdtemp(join(tmpdir(), 'records-captured-origin-')); roots.push(root);
  const elements = [{ id: 'Patient', path: 'Patient', min: 0, max: '*' },
    { id: 'Patient.gender', path: 'Patient.gender', min: 0, max: '1', type: [{ code: 'code' }] }];
  const definition = { resourceType: 'StructureDefinition', id: 'CapturedPatient', url: profileUrl, version: '7.0.0',
    name: 'CapturedPatient', status: 'active', kind: 'resource', abstract: false, type: 'Patient', fhirVersion: '4.0.1',
    derivation: 'constraint', baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
    snapshot: { element: [elements[0], { ...elements[1], binding: { strength: 'required', valueSet: valueSetUrl } }] } };
  await writePackage(root, 'example.source', '3.0.0', [definition], { 'example.tx': '1.0.0' });
  await writePackage(root, 'hl7.fhir.r4.core', '4.0.1', [{ ...definition, id: 'Patient',
    url: 'http://hl7.org/fhir/StructureDefinition/Patient', version: '4.0.1', snapshot: { element: elements } }]);
  for (const [release, businessVersion, code] of [['1.0.0', '5.0.0', 'female'], ['2.0.0', '6.0.0', 'male']]) {
    await writePackage(root, 'example.tx', release, [
      { resourceType: 'ValueSet', id: 'captured-gender', url: valueSetUrl, version: businessVersion, status: 'active',
        compose: { include: [{ system, concept: [{ code }] }] } },
      { resourceType: 'CodeSystem', id: 'captured-gender', url: system, version: '1.0.0', status: 'active',
        content: 'complete', caseSensitive: true, concept: [{ code: 'female' }, { code: 'male' }] },
    ]);
  }
  const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
    prewarmProfileSource: false, terminologyPackageDirectories: closed ? [] : [root], enableCaching: false });
  await validator.waitForInitialization();
  const loaded = await validator.getSdLoader().loadProfile(`${profileUrl}|7.0.0`, 'R4');
  expect(loaded).not.toBeNull();
  expect(lookupProfilePackageProvenance(loaded!)).toEqual({ name: 'example.source', version: '3.0.0' });
  const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  settings.terminologyServers = []; settings.advisorRules = [];
  settings.terminologyResolution = { ...settings.terminologyResolution, strategy: 'local-only',
    serverDelegation: { ...settings.terminologyResolution?.serverDelegation, validateCodes: false, expandValueSets: false } };
  await validator.configureTerminologyResolution(settings.terminologyResolution);
  const validate = async (api: 'single' | 'multi', code: string): Promise<ValidationIssue[]> => {
    const resource = { resourceType: 'Patient', gender: code };
    if (api === 'single') return validator.validate(resource, `${profileUrl}|7.0.0`, 'R4', settings);
    const result = await validator.validateAspects(resource, { aspects: ['structural', 'profile', 'terminology'], settings,
      fhirVersion: 'R4', profileUrl: `${profileUrl}|7.0.0` });
    return result.aspects.flatMap(aspect => aspect.issues);
  };
  return { validate };
}
const bindings = (issues: ValidationIssue[]) => issues.filter(issue => issue.code.startsWith('terminology-binding-'));

describe('captured actual package origin owns public binding decisions', () => {
  for (const api of ['single', 'multi'] as const) {
    it.each([false, true])(`${api} preserves dependency binding in both capture orders (%s)`, async capturedFirst => {
      const { validate } = await fixture();
      const captures = capturedFirst ? [true, false] : [false, true];
      for (let round = 0; round < 2; round++) {
        for (const capture of captures) {
          const snapshot = createValidationDependencySnapshot();
          const run = (code: string) => capture ? snapshot.run(() => validate(api, code)) : validate(api, code);
          const accepted = bindings(await run('female'));
          expect(accepted, JSON.stringify({ capture, accepted })).toEqual([]);
          const rejected = bindings(await run('male'));
          expect(rejected.some(issue => issue.severity === 'error' && issue.message.includes(`${valueSetUrl}|5.0.0`)), JSON.stringify(rejected)).toBe(true);
          expect(rejected.some(issue => issue.details?.validationComplete === false)).toBe(false);
          if (capture) expect(snapshot.evidence()).toMatchObject({ status: 'captured' });
        }
      }
    });
    it(`${api} preserves Unknown for closed terminology stores with and without capture`, async () => {
      const { validate } = await fixture(true);
      for (const capture of [false, true]) {
        const snapshot = createValidationDependencySnapshot();
        const issues = bindings(await (capture ? snapshot.run(() => validate(api, 'female')) : validate(api, 'female')));
        expect(issues.some(issue => issue.code === 'terminology-binding-unverified' && (issue.details?.validationComplete === false || issue.details?.validationStatus === 'incomplete')), JSON.stringify({ capture, issues })).toBe(true);
        expect(issues.some(issue => issue.severity === 'error')).toBe(false);
      }
    });
  }
});
