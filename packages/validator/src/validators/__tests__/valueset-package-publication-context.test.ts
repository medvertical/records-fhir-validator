import { createHash } from 'node:crypto';
import { readFileSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setProfileSource } from '../../persistence';
import { ValueSetCache } from '../valueset-cache';
import { ValueSetPackageLoader } from '../valueset-package-loader';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access';
import { ValueSetValidator } from '../valueset-validator';
import { clearPackageCanonicalIndex } from '../valueset-package-search';
import type { ValueSet } from '../valueset-types';

const fixture = new URL('./fixtures/fhir-publication-context/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('device-source-manifest.json', fixture), 'utf8')) as {
  files: Array<{ id: string; file: string; originalPath: string; sha256: string; packageDirectory: string }>;
};
const roots: string[] = [];
const canonical = 'http://hl7.org/fhir/ValueSet/device-nametype';
const system = 'http://hl7.org/fhir/device-nametype';
const read = (id: string) => readFileSync(new URL(manifest.files.find(row => row.id === id)!.file, fixture), 'utf8');
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

async function harness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'records-publication-context-'));
  roots.push(root);
  for (const row of manifest.files.filter(row => row.id !== 'r4-bundled-manifest')) {
    const directory = path.join(root, row.packageDirectory, 'package');
    await fs.mkdir(directory, { recursive: true });
    const filename = row.id.endsWith('manifest') ? 'package.json'
      : row.id.endsWith('valueset') ? 'ValueSet-device-nametype.json' : 'CodeSystem-device-nametype.json';
    await fs.writeFile(path.join(directory, filename), read(row.id));
  }
  const access = new ValueSetPackageResourceAccess([root]);
  const loader = new ValueSetPackageLoader(new ValueSetCache(), access);
  return { root, access, loader };
}

const qualified = (codes: string[] | null) => (codes ?? []).filter(code => code.includes('|'));

afterEach(async () => {
  setProfileSource({});
  clearPackageCanonicalIndex();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('selected package publication metadata', () => {
  it.each(manifest.files)('pins original $id definition or package manifest bytes', row => {
    expect(digest(read(row.id))).toBe(row.sha256);
  });

  it.each(['r4', 'r5'])('attests actual %s definition and package bytes on cold and warm paths', async release => {
    const { loader, access } = await harness();
    const version = release === 'r4' ? '4.0.1' : '5.0.0';
    const expected = release === 'r4' ? 'model-name' : 'registered-name';
    const opposite = release === 'r4' ? 'registered-name' : 'model-name';
    for (let warm = 0; warm < 2; warm++) {
      const valueSet = await loader.loadValueSetResource(`${canonical}|${version}`);
      expect(qualified(await loader.loadValueSet(`${canonical}|${version}`))).toContain(`${system}|${expected}`);
      expect(qualified(await loader.loadValueSet(`${canonical}|${version}`))).not.toContain(`${system}|${opposite}`);
      expect(await access.getPublicationContext(valueSet!)).toMatchObject({
        fhirVersion: release === 'r4' ? 'R4' : 'R5',
        definitionSha256: manifest.files.find(row => row.id === `${release}-valueset`)!.sha256,
        packageManifestSha256: manifest.files.find(row => row.id === `${release}-manifest`)!.sha256,
        packageVersion: version,
      });
    }
  });

  it.each([{ code: 'model-name', valid: true }, { code: 'registered-name', valid: false }])(
    'keeps the established no-context R4 primitive binding $code valid $valid', async ({ code, valid }) => {
      const { root } = await harness();
      const validator = new ValueSetValidator(undefined, undefined, [root]);
      validator.setResolutionConfig({ strategy: 'local-only', serverDelegation: {
        expandValueSets: false, validateCodes: false, cacheResults: false, cacheTTLSeconds: 0,
      } });
      for (let warm = 0; warm < 2; warm++) {
        const issues = await validator.validateBinding(code,
          { strength: 'required', valueSet: `${canonical}|4.0.1` }, 'Device.deviceName.type');
        if (valid) expect(issues).toEqual([]);
        else expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-binding-required-code' }));
      }
    },
  );

  it.each(['R4', 'R5'] as const)('prefers explicit %s context over a pinned R4 source publication', async fhirVersion => {
    const { loader } = await harness();
    const expected = fhirVersion === 'R4' ? 'model-name' : 'registered-name';
    expect(qualified(await loader.loadValueSet(`${canonical}|4.0.1`, fhirVersion))).toContain(`${system}|${expected}`);
  });

  it('does not share source evidence between resource-access instances', async () => {
    const { loader, access, root } = await harness();
    const valueSet = (await loader.loadValueSetResource(`${canonical}|4.0.1`))!;
    expect((await access.getPublicationContext(valueSet))?.fhirVersion).toBe('R4');
    expect(await new ValueSetPackageResourceAccess([root]).getPublicationContext(valueSet)).toBeUndefined();
    access.clear();
    expect((await access.getPublicationContext(valueSet))?.fhirVersion).toBe('R4');
  });

  it('does not attest a cached object after its selected definition file changes', async () => {
    const { loader, access } = await harness();
    const valueSet = (await loader.loadValueSetResource(`${canonical}|4.0.1`))!;
    const source = (await access.getPublicationContext(valueSet))!;
    await fs.writeFile(source.sourcePath, JSON.stringify({ ...valueSet, version: '2026.1.0' }));
    expect((await access.getPublicationContext(valueSet))?.fhirVersion).toBeUndefined();
    expect((await access.getPublicationContext(valueSet))?.definitionSha256).toBe(source.definitionSha256);
  });

  it.each([{}, { fhirVersions: ['2026.1.0'] }, { fhirVersions: ['4.0.1', '5.0.0'] }, { fhirVersions: ['4.0.1', null] },
    { fhirVersions: ['4.0.1'], 'fhir-version-list': ['5.0.0'] }])(
    'leaves absent, non-FHIR or mixed-publication source metadata unverified: %j', async fields => {
      const { loader, access, root } = await harness();
      await fs.writeFile(path.join(root, 'hl7.fhir.r4.core#4.0.1', 'package/package.json'), JSON.stringify(fields));
      const valueSet = (await loader.loadValueSetResource(`${canonical}|4.0.1`))!;
      expect((await access.getPublicationContext(valueSet))?.fhirVersion).toBeUndefined();
      expect(valueSet.version).toBe('4.0.1');
    },
  );

  it('keeps a direct unattested inline definition separate from a file-backed resource', async () => {
    const { access } = await harness();
    const inline: ValueSet = JSON.parse(read('r4-valueset')) as ValueSet;
    expect(await access.getPublicationContext(inline)).toBeUndefined();
  });
});


describe('publication origin readers and host neighbors', () => {
  it('accepts the genuine bundled manifest fhir-version-list metadata', async () => {
    const { loader, access, root } = await harness();
    await fs.writeFile(path.join(root, 'hl7.fhir.r4.core#4.0.1/package/package.json'), read('r4-bundled-manifest'));
    const valueSet = (await loader.loadValueSetResource(`${canonical}|4.0.1`))!;
    expect(await access.getPublicationContext(valueSet)).toMatchObject({
      fhirVersion: 'R4',
      packageManifestSha256: manifest.files.find(row => row.id === 'r4-bundled-manifest')!.sha256,
    });
    expect(qualified(await loader.loadValueSet(`${canonical}|4.0.1`))).toContain(`${system}|model-name`);
  });

  it.each(['named', 'declared', 'scan'] as const)('attests the actual source through the %s reader', async route => {
    const { root, access } = await harness();
    const directory = path.join(root, 'hl7.fhir.r4.core#4.0.1/package');
    let filename = 'ValueSet-device-nametype.json';
    if (route === 'scan') {
      filename = 'ValueSet-unconventional-device.json';
      await fs.rename(path.join(directory, 'ValueSet-device-nametype.json'), path.join(directory, filename));
    }
    if (route === 'declared') {
      await fs.writeFile(path.join(directory, '.index.json'), JSON.stringify({ files: [
        { filename, resourceType: 'ValueSet', url: canonical, version: '4.0.1' },
      ] }));
    }
    const valueSet = route === 'scan'
      ? await access.findByCanonicalScan<ValueSet>(canonical, 'ValueSet', undefined, '4.0.1')
      : route === 'named'
        ? await access.findInPackages<ValueSet>(canonical, [filename], undefined, '4.0.1')
        : await access.findResource<ValueSet>(canonical, [filename], 'ValueSet', undefined, '4.0.1');
    expect(await access.getPublicationContext(valueSet!)).toMatchObject({
      fhirVersion: 'R4', sourcePath: path.join(directory, filename),
      definitionSha256: manifest.files.find(row => row.id === 'r4-valueset')!.sha256,
    });
  });

  it.each(['R4', 'R5'] as const)('uses host context but keeps its unavailable file origin separate under explicit %s override', async fhirVersion => {
    const { loader, access } = await harness();
    const resource = JSON.parse(read('r4-valueset')) as Record<string, unknown>;
    setProfileSource({ findCanonicalResource: async (_url, resourceType) => resourceType === 'ValueSet' ? resource : null });
    loader.setSourceContext({ organizationId: 73, fhirVersion: 'R4' });
    const valueSet = (await loader.loadValueSetResource(`${canonical}|4.0.1`, fhirVersion))!;
    expect(await access.getPublicationContext(valueSet)).toBeUndefined();
    const expected = fhirVersion === 'R4' ? 'model-name' : 'registered-name';
    expect(qualified(await loader.loadValueSet(`${canonical}|4.0.1`, fhirVersion))).toContain(`${system}|${expected}`);
  });
});


describe('positive cached source publication survives unrelated lookup invalidation', () => {
  it('retains R4 Device membership when only package lookup indexes are invalidated', async () => {
    const { loader } = await harness();
    expect(qualified(await loader.loadValueSet(`${canonical}|4.0.1`))).toContain(`${system}|model-name`);
    expect(qualified(await loader.loadValueSet(`${canonical}|5.0.0`))).toContain(`${system}|registered-name`);
    loader.clearLookupState();
    expect(qualified(await loader.loadValueSet(`${canonical}|4.0.1`))).toContain(`${system}|model-name`);
  });

  it('retains R4 Device binding when an unrelated external CodeSystem is registered', async () => {
    const { root } = await harness();
    const validator = new ValueSetValidator(undefined, undefined, [root]);
    validator.setResolutionConfig({ strategy: 'local-only', serverDelegation: {
      expandValueSets: false, validateCodes: false, cacheResults: false, cacheTTLSeconds: 0,
    } });
    const binding = { strength: 'required' as const, valueSet: `${canonical}|4.0.1` };
    expect(await validator.validateBinding('model-name', binding, 'Device.deviceName.type')).toEqual([]);
    expect(validator.registerExternalTerminologyResource({ resourceType: 'CodeSystem',
      url: 'https://example.test/CodeSystem/unrelated', version: '2026.1.0', content: 'complete',
      concept: [{ code: 'unrelated' }] }, 'R4')).toBe(true);
    expect(await validator.validateBinding('model-name', binding, 'Device.deviceName.type')).toEqual([]);
  });
});
