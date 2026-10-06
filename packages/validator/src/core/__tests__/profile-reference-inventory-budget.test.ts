import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { RecordsValidator } from '../validator-engine';
import type { StructureDefinition } from '../structure-definition-types';
import { setProfileSource } from '../../persistence/profile-source';
import { clearCanonicalPinCaches } from '../../package/canonical-pin-context';
import { createValidationDependencySnapshot } from '../../validation-dependency-snapshot';

const roots: string[] = [];
const sourceUrl = 'https://budget.test/StructureDefinition/Source';
const url = (name: string) => `https://budget.test/StructureDefinition/${name}`;
afterEach(async () => {
  setProfileSource({}); clearCanonicalPinCaches();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
function definition(canonical: string, type: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: canonical, version: '7.0.0', fhirVersion: '4.0.1',
    name: 'BudgetFixture', kind: type === 'Patient' ? 'resource' : 'complex-type', abstract: false, status: 'active', type };
}

it.each(['single', 'multi'] as const)('keeps genuine membership and exposes the unchanged profile capture byte limit through %s', async api => {
  const root = await mkdtemp(join(tmpdir(), 'records-inventory-budget-')); roots.push(root);
  const folder = join(root, 'example.budget#1.0.0', 'package'); await mkdir(folder, { recursive: true });
  const source = { ...definition(sourceUrl, 'Patient'), snapshot: { element: [
    { id: 'Patient', path: 'Patient' },
    { id: 'Patient.active', path: 'Patient.active', min: 1, max: '1', type: [{ code: 'boolean' }] },
    { id: 'Patient.identifier', path: 'Patient.identifier', min: 0, max: '*', type: [{ code: 'Identifier' }],
      slicing: { discriminator: [{ type: 'profile' as const, path: '$this' }], rules: 'closed' as const } },
    { id: 'Patient.identifier:owned', path: 'Patient.identifier', sliceName: 'owned', min: 1, max: '1',
      type: [{ code: 'Identifier', profile: ['A', 'B', 'C'].map(url) }] },
  ] } };
  const targets = ['A', 'B', 'C'].map(name => ({ ...definition(url(name), 'Identifier'), snapshot: { element: [
    { id: 'Identifier', path: 'Identifier' },
    { id: 'Identifier.system', path: 'Identifier.system', min: 1, max: '1', fixedUri: `https://budget.test/${name}`, type: [{ code: 'uri' }] },
  ] } }));
  const profiles = [source, ...targets];
  await writeFile(join(folder, 'package.json'), JSON.stringify({ name: 'example.budget', version: '1.0.0', fhirVersions: ['4.0.1'] }));
  await writeFile(join(folder, '.index.json'), JSON.stringify({ files: profiles.map((profile, position) => ({
    resourceType: 'StructureDefinition', url: profile.url, version: profile.version, filename: `StructureDefinition-${position}.json`,
  })) }));
  const writeTargets = async (large: boolean) => {
    for (const [position, profile] of targets.entries()) await writeFile(join(folder, `StructureDefinition-${position + 1}.json`),
      JSON.stringify({ ...profile, ...(large ? { description: 'synthetic'.padEnd(23 * 1024 * 1024, 'x') } : {}) }));
  };
  await writeFile(join(folder, 'StructureDefinition-0.json'), JSON.stringify(source)); await writeTargets(false);
  const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
    prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
  await validator.waitForInitialization();
  const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
  const run = async (system: string, active = true) => {
    const resource = { resourceType: 'Patient', ...(active ? { active: false } : {}), identifier: [{ system: `https://budget.test/${system}`, value: 'synthetic' }] };
    return api === 'single' ? validator.validate(resource, `${sourceUrl}|7.0.0`, 'R4', settings)
      : (await validator.validateAspects(resource, { profileUrl: `${sourceUrl}|7.0.0`, fhirVersion: 'R4',
        aspects: ['structural', 'profile'], settings })).aspects.flatMap(aspect => aspect.issues);
  };
  const failures = ['profile-slice-min-cardinality', 'profile-slice-closed-unmatched'];
  expect((await run('C')).some(issue => failures.includes(issue.code ?? ''))).toBe(false);
  expect((await run('none')).some(issue => failures.includes(issue.code ?? ''))).toBe(true);
  await writeTargets(true); validator.getSdLoader().clearCache();
  const unknown = await run('C', false);
  expect(unknown).toContainEqual(expect.objectContaining({ code: 'profile-reference-unavailable',
    details: expect.objectContaining({ validationComplete: false, validationStatus: 'incomplete',
      source: { name: 'example.budget', version: '1.0.0' }, cause: 'dependency-snapshot-limit' }) }));
  expect(unknown).toContainEqual(expect.objectContaining({ code: 'structural-cardinality-min', path: 'Patient.active' }));
  expect(unknown.some(issue => failures.includes(issue.code ?? ''))).toBe(false);
}, 60_000);

it.each(['single', 'multi'] as const)('keeps unscoped host profiles outside implicit budgets and exposes explicit limits through %s', async api => {
  const root = await mkdtemp(join(tmpdir(), 'records-host-budget-')); roots.push(root);
  const source = { ...definition(sourceUrl, 'Patient'), snapshot: { element: [
    { id: 'Patient', path: 'Patient' },
    { id: 'Patient.active', path: 'Patient.active', min: 1, max: '1', type: [{ code: 'boolean' }] },
    { id: 'Patient.identifier', path: 'Patient.identifier', min: 0, max: '*', type: [{ code: 'Identifier' }],
      slicing: { discriminator: [{ type: 'profile' as const, path: '$this' }], rules: 'closed' as const } },
    { id: 'Patient.identifier:owned', path: 'Patient.identifier', sliceName: 'owned', min: 1, max: '1',
      type: [{ code: 'Identifier', profile: ['A', 'B', 'C'].map(url) }] },
  ] } };
  const targets = ['A', 'B', 'C'].map(name => ({ ...definition(url(name), 'Identifier'),
    description: 'synthetic'.padEnd(23 * 1024 * 1024, 'x'), snapshot: { element: [
      { id: 'Identifier', path: 'Identifier' },
      { id: 'Identifier.system', path: 'Identifier.system', min: 1, max: '1', fixedUri: `https://budget.test/${name}`, type: [{ code: 'uri' }] },
    ] } }));
  const profiles = new Map([source, ...targets].map(profile => [profile.url, profile]));
  setProfileSource({ findByUrl: async canonical => profiles.get(canonical.split('|')[0]) ?? null });
  const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: root, autoDownload: false,
    prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
  await validator.waitForInitialization();
  const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4); settings.terminologyServers = []; settings.advisorRules = [];
  const run = async (system: string, active = true) => {
    const resource = { resourceType: 'Patient', ...(active ? { active: false } : {}), identifier: [{ system: `https://budget.test/${system}`, value: 'synthetic' }] };
    return api === 'single' ? validator.validate(resource, `${sourceUrl}|7.0.0`, 'R4', settings)
      : (await validator.validateAspects(resource, { profileUrl: `${sourceUrl}|7.0.0`, fhirVersion: 'R4',
        aspects: ['structural', 'profile'], settings })).aspects.flatMap(aspect => aspect.issues);
  };
  const failures = ['profile-slice-min-cardinality', 'profile-slice-closed-unmatched'];
  const positive = await run('C');
  expect(positive.some(issue => failures.includes(issue.code ?? ''))).toBe(false);
  expect(positive.some(issue => issue.details?.validationComplete === false)).toBe(false);
  const negative = await run('none');
  expect(negative.some(issue => failures.includes(issue.code ?? ''))).toBe(true);
  expect(negative.some(issue => issue.details?.validationComplete === false)).toBe(false);
  validator.getSdLoader().clearCache();
  const outer = createValidationDependencySnapshot();
  const unknown = await outer.run(() => run('C', false));
  const limit = unknown.find(issue => issue.code === 'profile-reference-unavailable' && issue.details?.cause === 'dependency-snapshot-limit');
  expect(limit).toMatchObject({ details: { validationComplete: false, validationStatus: 'incomplete' } });
  expect(limit?.details).not.toHaveProperty('source'); expect(limit?.details).not.toHaveProperty('dependency');
  expect(unknown).toContainEqual(expect.objectContaining({ code: 'structural-cardinality-min', path: 'Patient.active' }));
  expect(unknown.some(issue => failures.includes(issue.code ?? ''))).toBe(false);
  expect(outer.evidence().status).toBe('unattested');
}, 60_000);
