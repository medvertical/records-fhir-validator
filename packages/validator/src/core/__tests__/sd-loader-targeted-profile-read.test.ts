import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFromLocalCache } from '../sd-loader-filesystem';
import { PackageProfileIndexCache } from '../sd-loader-package-profile-index';

const PROFILE_URL = 'http://example.test/StructureDefinition/Target';

function structureDefinition(url: string, version: string, type = 'Patient') {
    return JSON.stringify({
        resourceType: 'StructureDefinition', id: 'x', url, version, type,
        kind: 'resource', fhirVersion: '4.0.1',
        snapshot: { element: [{ path: type }] },
    });
}

describe('profile lookup reads the files the package index names', () => {
    const roots: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    async function packageWith(files: Record<string, string>, index?: unknown): Promise<string> {
        const root = await mkdtemp(path.join(tmpdir(), 'sd-targeted-'));
        roots.push(root);
        const packageDir = path.join(root, 'example#1.0.0', 'package');
        await mkdir(packageDir, { recursive: true });
        for (const [name, body] of Object.entries(files)) {
            await writeFile(path.join(packageDir, name), body);
        }
        if (index !== undefined) await writeFile(path.join(packageDir, '.index.json'), JSON.stringify(index));
        return root;
    }

    // The point of the change: one profile out of a package used to cost a read
    // of every JSON file in it.
    it('opens only the named profile, not the whole package', async () => {
        const noise = Object.fromEntries(Array.from({ length: 20 }, (_, i) =>
            [`StructureDefinition-noise${i}.json`, structureDefinition(`http://example.test/StructureDefinition/N${i}`, '1.0.0')]));
        const root = await packageWith(
            { ...noise, 'StructureDefinition-Target.json': structureDefinition(PROFILE_URL, '2.0.0') },
            {
                files: [
                    { filename: 'StructureDefinition-Target.json', resourceType: 'StructureDefinition', url: PROFILE_URL, version: '2.0.0' },
                    ...Array.from({ length: 20 }, (_, i) => ({
                        filename: `StructureDefinition-noise${i}.json`, resourceType: 'StructureDefinition',
                        url: `http://example.test/StructureDefinition/N${i}`, version: '1.0.0',
                    })),
                ],
            },
        );
        const reads: string[] = [];
        const readFile = fsPromises.readFile.bind(fsPromises);
        vi.spyOn(fsPromises, 'readFile').mockImplementation(async (file: never, ...rest: never[]) => {
            reads.push(path.basename(String(file)));
            return readFile(file, ...rest);
        });

        await expect(loadFromLocalCache(PROFILE_URL, [root], 'R4', {}, new PackageProfileIndexCache()))
            .resolves.toMatchObject({ url: PROFILE_URL, version: '2.0.0' });

        expect(reads).toContain('StructureDefinition-Target.json');
        expect(reads.filter(name => name.startsWith('StructureDefinition-noise'))).toEqual([]);
    });

    // An index that omits a profile must not make it unreachable.
    it('falls back to the full read when the index names no file for it', async () => {
        const root = await packageWith(
            { 'oddly-named.json': structureDefinition(PROFILE_URL, '3.0.0') },
            { files: [{ filename: 'other.json', resourceType: 'StructureDefinition', url: 'http://example.test/StructureDefinition/Other' }] },
        );

        await expect(loadFromLocalCache(PROFILE_URL, [root], 'R4', {}, new PackageProfileIndexCache()))
            .resolves.toBeNull();
    });

    it('still finds a profile in a package that ships no index', async () => {
        const root = await packageWith({ 'oddly-named.json': structureDefinition(PROFILE_URL, '3.0.0') });

        await expect(loadFromLocalCache(PROFILE_URL, [root], 'R4', {}, new PackageProfileIndexCache()))
            .resolves.toMatchObject({ url: PROFILE_URL, version: '3.0.0' });
    });

    it('picks the requested version from the files the index names', async () => {
        const root = await packageWith(
            {
                'StructureDefinition-Target-1.json': structureDefinition(PROFILE_URL, '1.0.0'),
                'StructureDefinition-Target-2.json': structureDefinition(PROFILE_URL, '2.0.0'),
            },
            {
                files: [
                    { filename: 'StructureDefinition-Target-1.json', resourceType: 'StructureDefinition', url: PROFILE_URL, version: '1.0.0' },
                    { filename: 'StructureDefinition-Target-2.json', resourceType: 'StructureDefinition', url: PROFILE_URL, version: '2.0.0' },
                ],
            },
        );

        await expect(loadFromLocalCache(`${PROFILE_URL}|1.0.0`, [root], 'R4', {}, new PackageProfileIndexCache()))
            .resolves.toMatchObject({ version: '1.0.0' });
    });
});
