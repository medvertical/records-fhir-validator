import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4, type ValidationIssue, type ValidationSettings } from '@records-fhir/validation-types';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { RecordsValidator } from '../validator-engine.js';
import type { StructureDefinition } from '../structure-definition-types.js';

const profileUrl = 'https://records.test/StructureDefinition/configured-memberof';
const valueSetUrl = 'https://records.test/ValueSet/configured-memberof';
const system = 'https://records.test/CodeSystem/configured-memberof';
const expression = `where(category.memberOf('${valueSetUrl}')).exists()`;
const originalSource = getProfileSource();
const roots: string[] = [];

afterEach(async () => {
  setProfileSource(originalSource);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function definition(): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: profileUrl, name: 'ConfiguredMemberOf',
    status: 'active', kind: 'resource', abstract: false, type: 'Condition', fhirVersion: '4.0.1',
    snapshot: { element: [
      { id: 'Condition', path: 'Condition', min: 0, max: '*', constraint: [{ key: 'scope-1', severity: 'warning',
        human: 'Category must use the configured terminology store', expression, source: profileUrl }] },
      { id: 'Condition.category', path: 'Condition.category', min: 0, max: '*', type: [{ code: 'CodeableConcept' }] },
    ] },
  };
}

function settings(): ValidationSettings {
  const defaults = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  if (!defaults.packageDownload) throw new Error('Maintained package download defaults required');
  return {
    ...defaults, terminologyServers: [], advisorRules: [], validationStrictness: 'standard',
    profileSources: { simplifier: false, packageRegistry: false },
    packageDownload: { ...defaults.packageDownload, autoDownload: false },
    terminologyResolution: { ...defaults.terminologyResolution, strategy: 'local-only',
      serverDelegation: { ...defaults.terminologyResolution?.serverDelegation, expandValueSets: false, validateCodes: false },
      twoPhaseExpansion: { ...defaults.terminologyResolution?.twoPhaseExpansion, enabled: false, mode: 'shadow' } },
    aspects: { ...defaults.aspects, profile: { enabled: true, engine: 'records', severity: 'inherit' } },
  };
}

async function store(root: string, name: string, code: string): Promise<string> {
  const directory = join(root, name);
  const folder = join(directory, 'records.memberof-test#1.0.0', 'package');
  await mkdir(folder, { recursive: true });
  const valueSet = { resourceType: 'ValueSet', id: 'configured-memberof', url: valueSetUrl,
    version: '1.0.0', status: 'active', compose: { include: [{ system, concept: [{ code }] }] } };
  await writeFile(join(folder, 'package.json'), JSON.stringify({ name: 'records.memberof-test', version: '1.0.0', fhirVersions: ['4.0.1'] }));
  await writeFile(join(folder, 'ValueSet-configured-memberof.json'), JSON.stringify(valueSet));
  await writeFile(join(folder, '.index.json'), JSON.stringify({ 'index-version': 2, files: [{
    filename: 'ValueSet-configured-memberof.json', resourceType: 'ValueSet', id: valueSet.id,
    url: valueSetUrl, version: valueSet.version,
  }] }));
  return directory;
}

async function fixture(localCode: string | null, globalCode: string | null) {
  const root = await mkdtemp(join(tmpdir(), 'records-memberof-public-')); roots.push(root);
  const local = localCode === null ? [] : [await store(root, 'local', localCode)];
  const global = globalCode === null ? [] : [await store(root, 'global', globalCode)];
  setProfileSource({ packageDirectories: global });
  const validator = new RecordsValidator({ packageCachePath: join(root, 'sd-cache'), bundledProfilesPath: null,
    terminologyPackageDirectories: local, autoDownload: false, prewarmProfileSource: false,
    enableCaching: false, timeout: 30_000 });
  await validator.waitForInitialization();
  const selected = definition();
  expect(validator.getSdLoader().registerExternalProfile(selected, 'R4')).toBe(true);
  const validate = async (api: 'single' | 'multi', code: string): Promise<ValidationIssue[]> => {
    const resource = { resourceType: 'Condition', category: [{ coding: [{ system, code }] }] };
    if (api === 'single') return validator.validate(resource, profileUrl, 'R4', settings());
    const result = await validator.validateAspects(resource, { aspects: ['profile'], settings: settings(),
      fhirVersion: 'R4', profileUrl, profileSources: ['explicit-run'] });
    expect(result.structureDef).toEqual(selected);
    return result.aspects.flatMap(aspect => aspect.issues);
  };
  return { validate };
}

function selected(issues: ValidationIssue[]) {
  return issues.filter(issue => issue.ruleId === 'scope-1' || issue.details?.constraintKey === 'scope-1');
}

describe('configured memberOf resolver owns public constraint verdicts', () => {
  for (const api of ['single', 'multi'] as const) {
    it.each([['a', 'b'], ['b', 'a']])(`${api} uses configured codes %s despite global codes %s`, async (local, global) => {
      const { validate } = await fixture(local, global);
      for (let round = 0; round < 2; round++) {
        expect(selected(await validate(api, local))).toEqual([]);
        const rejected = selected(await validate(api, global));
        expect(rejected.length).toBeGreaterThan(0);
        expect(rejected.every(issue => issue.severity === 'warning' && issue.details?.validationComplete !== false)).toBe(true);
      }
    });

    it(`${api} resolves positive and negative controls despite absent global terminology`, async () => {
      const { validate } = await fixture('a', null);
      expect(selected(await validate(api, 'a'))).toEqual([]);
      const rejected = selected(await validate(api, 'b'));
      expect(rejected.length).toBeGreaterThan(0);
      expect(rejected.every(issue => issue.severity === 'warning' && issue.details?.validationComplete !== false)).toBe(true);
    });

    it(`${api} keeps an explicitly closed store incomplete despite a global positive answer`, async () => {
      const { validate } = await fixture(null, 'a');
      const unchecked = selected(await validate(api, 'a'));
      expect(unchecked.length).toBeGreaterThan(0);
      expect(unchecked.every(issue => issue.details?.validationComplete === false && issue.details?.validationStatus === 'incomplete')).toBe(true);
    });
  }
});
