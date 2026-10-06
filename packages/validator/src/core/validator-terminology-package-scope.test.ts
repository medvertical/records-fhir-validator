import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createValidatorCoreRuntime } from './validator-core-components';
import { resolveRecordsValidatorConfig } from './validator-engine-config';
import { setProfileSource } from '../persistence';

let directory: string;
const system = 'https://example.test/CodeSystem/isolated';
const valueSet = 'https://example.test/ValueSet/isolated';
async function store(name: string, code: string): Promise<string> {
  const root = path.join(directory, name); const folder = path.join(root, `scope.${name}#1.0.0`, 'package');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: `scope.${name}`, version: '1.0.0', fhirVersions: ['4.0.1'] }));
  await fs.writeFile(path.join(folder, 'CodeSystem-isolated.json'), JSON.stringify({
    resourceType: 'CodeSystem', url: system, version: '1.0.0', status: 'active', content: 'complete',
    caseSensitive: true, concept: [{ code, display: code }],
  }));
  await fs.writeFile(path.join(folder, 'ValueSet-isolated.json'), JSON.stringify({
    resourceType: 'ValueSet', url: valueSet, version: '1.0.0', status: 'active',
    compose: { include: [{ system, concept: [{ code }] }] },
  }));
  return root;
}
async function runtime(packageDirectories?: string[]) {
  const config = resolveRecordsValidatorConfig(Object.assign({
    packageCachePath: directory, bundledProfilesPath: directory, autoDownload: false, prewarmProfileSource: false,
  }, { terminologyPackageDirectories: packageDirectories }));
  const result = createValidatorCoreRuntime(config);
  await result.components.sdLoader.waitForInitialization();
  result.components.valuesetValidator.setResolutionConfig({ strategy: 'local-only' });
  return result;
}

describe('instance-local terminology package stores', () => {
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'records-terminology-stores-')); });
  afterEach(async () => { setProfileSource({}); await fs.rm(directory, { recursive: true, force: true }); });

  it('retains an explicit empty store list and snapshots caller configuration', () => {
    const packageDirectories: string[] = [];
    const configuration = Object.assign({}, { terminologyPackageDirectories: packageDirectories });
    const resolved = resolveRecordsValidatorConfig(configuration);
    packageDirectories.push('/later-added');
    expect(resolved).toMatchObject({ terminologyPackageDirectories: [] });
  });

  it('uses each runtime\'s CodeSystem store for equal canonical/version identities', async () => {
    const a = await store('first', 'a'); const b = await store('second', 'b');
    const first = (await runtime([a])).components.valuesetValidator;
    const second = (await runtime([b])).components.valuesetValidator;
    const results = await Promise.all([
      first.validateCodeInLocalCodeSystemOnly('a', system, undefined, 'R4', '1.0.0'),
      second.validateCodeInLocalCodeSystemOnly('b', system, undefined, 'R4', '1.0.0'),
      first.validateCodeInLocalCodeSystemOnly('b', system, undefined, 'R4', '1.0.0'),
      second.validateCodeInLocalCodeSystemOnly('a', system, undefined, 'R4', '1.0.0'),
    ]);
    expect(results.map(result => result?.valid)).toEqual([true, true, false, false]);
  });

  it('uses each runtime\'s ValueSet store without cross-instance membership', async () => {
    const a = await store('first', 'a'); const b = await store('second', 'b');
    const first = (await runtime([a])).components.valuesetValidator;
    const second = (await runtime([b])).components.valuesetValidator;
    expect(await Promise.all([
      first.isCodeValidForBinding('a', system, valueSet, 'required', 'R4'),
      second.isCodeValidForBinding('b', system, valueSet, 'required', 'R4'),
      first.isCodeValidForBinding('b', system, valueSet, 'required', 'R4'),
      second.isCodeValidForBinding('a', system, valueSet, 'required', 'R4'),
    ])).toEqual([true, true, false, false]);
  });

  it('does not adopt a later mutation of the caller\'s store list', async () => {
    const a = await store('first', 'a'); const b = await store('second', 'b'); const directories = [a];
    const validator = (await runtime(directories)).components.valuesetValidator;
    directories.splice(0, 1, b);
    expect(await validator.validateCodeInLocalCodeSystemOnly('a', system, undefined, 'R4', '1.0.0')).toMatchObject({ valid: true });
    expect(await validator.validateCodeInLocalCodeSystemOnly('b', system, undefined, 'R4', '1.0.0')).toMatchObject({ valid: false });
  });

  it('closes implicit filesystem stores with [] while preserving default behavior when omitted', async () => {
    const a = await store('first', 'a'); setProfileSource({ packageDirectories: [a] });
    const closed = (await runtime([])).components.valuesetValidator;
    const defaults = (await runtime()).components.valuesetValidator;
    expect(await closed.validateCodeInLocalCodeSystemOnly('a', system, undefined, 'R4', '1.0.0')).toBeNull();
    expect(await defaults.validateCodeInLocalCodeSystemOnly('a', system, undefined, 'R4', '1.0.0')).toMatchObject({ valid: true });
  });

  it('preserves the scoped tenant host tier ahead of explicit filesystem stores', async () => {
    const b = await store('second', 'b');
    setProfileSource({ findCanonicalResource: async (_url, resourceType, _version, context) =>
      context?.organizationId === 42 && resourceType === 'CodeSystem'
        ? { resourceType: 'CodeSystem', url: system, version: '1.0.0', status: 'active', content: 'complete', concept: [{ code: 'a' }] }
        : null });
    const validator = (await runtime([b])).components.valuesetValidator;
    validator.setSourceContext({ organizationId: 42, fhirVersion: 'R4' });
    expect(await validator.validateCodeInLocalCodeSystemOnly('a', system, undefined, 'R4', '1.0.0')).toMatchObject({ valid: true });
    expect(await validator.validateCodeInLocalCodeSystemOnly('b', system, undefined, 'R4', '1.0.0')).toMatchObject({ valid: false });
  });

  it('retains explicitly registered terminology when default filesystem stores are closed', async () => {
    const validator = (await runtime([])).components.valuesetValidator;
    expect(validator.registerExternalTerminologyResource({
      resourceType: 'CodeSystem', url: system, version: '1.0.0', status: 'active', content: 'complete', concept: [{ code: 'registered' }],
    }, 'R4')).toBe(true);
    expect(await validator.validateCodeInLocalCodeSystemOnly('registered', system, undefined, 'R4', '1.0.0')).toMatchObject({ valid: true });
  });
});
