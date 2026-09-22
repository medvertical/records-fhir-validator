import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProfileSource, type ProfileSourceContext } from '../../persistence';
import { ValueSetPackageResourceAccess } from '../valueset-package-resource-access';
import type { ValueSet } from '../valueset-types';

const VS_URL = 'https://example.test/ValueSet/host-tier';

function valueSet(version: string): ValueSet {
    return { resourceType: 'ValueSet', url: VS_URL, version, status: 'active' };
}

let storeDir: string;

beforeEach(async () => {
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'records-host-tier-'));
});

afterEach(async () => {
    setProfileSource({});
    await fs.rm(storeDir, { recursive: true, force: true });
});

async function writeStoreValueSet(version: string): Promise<void> {
    const packageDir = path.join(storeDir, `example.store#${version}`, 'package');
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(
        path.join(packageDir, 'ValueSet-host-tier.json'),
        JSON.stringify(valueSet(version)),
    );
}

function hostAnswering(byVersion: Record<string, ValueSet | null>) {
    const findCanonicalResource = vi.fn(async (
        _url: string,
        _resourceType: string,
        version: string | undefined,
        _context?: ProfileSourceContext,
    ) => byVersion[version ?? 'any'] ?? null);
    setProfileSource({ findCanonicalResource });
    return findCanonicalResource;
}

function find(access: ValueSetPackageResourceAccess, requestedVersion?: string) {
    return access.findResource<ValueSet>(
        VS_URL, ['ValueSet-host-tier.json'], 'ValueSet', '4', requestedVersion,
    );
}

describe('host package tier of the ValueSet package resource access', () => {
    it('never asks the host without an organization scope', async () => {
        const host = hostAnswering({ any: valueSet('1.0.0') });
        const access = new ValueSetPackageResourceAccess([storeDir]);

        await expect(find(access)).resolves.toBeNull();
        access.setSourceContext({ fhirVersion: 'R4' });
        await expect(find(access)).resolves.toBeNull();
        expect(host).not.toHaveBeenCalled();
    });

    it('answers from the tenant packages before the filesystem stores', async () => {
        const host = hostAnswering({ any: valueSet('2.0.0') });
        await writeStoreValueSet('1.0.0');
        const access = new ValueSetPackageResourceAccess([storeDir]);
        access.setSourceContext({ organizationId: 3, fhirVersion: 'R4' });

        await expect(find(access)).resolves.toMatchObject({ version: '2.0.0' });
        expect(host).toHaveBeenCalledWith(
            VS_URL, 'ValueSet', undefined, { organizationId: 3, fhirVersion: 'R4' },
        );
    });

    it('ignores a host answer that identifies a different definition', async () => {
        hostAnswering({ any: { ...valueSet('2.0.0'), url: 'https://example.test/ValueSet/other' } });
        const access = new ValueSetPackageResourceAccess([storeDir]);
        access.setSourceContext({ organizationId: 3 });

        await expect(find(access)).resolves.toBeNull();
    });

    it('prefers an exact pin from either tier over a same-major fallback', async () => {
        const host = hostAnswering({ '1.2.0': null, any: valueSet('1.0.0') });
        await writeStoreValueSet('1.2.0');
        const access = new ValueSetPackageResourceAccess([storeDir]);
        access.setSourceContext({ organizationId: 3 });

        await expect(find(access, '1.2.0')).resolves.toMatchObject({ version: '1.2.0' });
        expect(host).toHaveBeenCalledTimes(1);
    });

    it('falls back to a same-major host version when no store has the pin', async () => {
        hostAnswering({ '1.2.0': null, any: valueSet('1.0.0') });
        const access = new ValueSetPackageResourceAccess([storeDir]);
        access.setSourceContext({ organizationId: 3 });

        await expect(find(access, '1.2.0')).resolves.toMatchObject({ version: '1.0.0' });
    });

    it('does not accept a cross-major host version as a fallback', async () => {
        hostAnswering({ '1.2.0': null, any: valueSet('2.0.0') });
        const access = new ValueSetPackageResourceAccess([storeDir]);
        access.setSourceContext({ organizationId: 3 });

        await expect(find(access, '1.2.0')).resolves.toBeNull();
    });

    it('treats a host failure as a miss', async () => {
        setProfileSource({ findCanonicalResource: vi.fn().mockRejectedValue(new Error('db down')) });
        const access = new ValueSetPackageResourceAccess([storeDir]);
        access.setSourceContext({ organizationId: 3 });

        await expect(find(access)).resolves.toBeNull();
    });

    it('reports a scope change only when the tenant changes', () => {
        const access = new ValueSetPackageResourceAccess([storeDir]);

        expect(access.setSourceContext({ fhirVersion: 'R4' })).toBe(false);
        expect(access.setSourceContext({ organizationId: 3 })).toBe(true);
        expect(access.setSourceContext({ organizationId: 3, serverId: 9 })).toBe(false);
        expect(access.setSourceContext({ organizationId: 4 })).toBe(true);
        expect(access.setSourceContext(undefined)).toBe(true);
        expect(access.getSourceContext()).toBeUndefined();
    });
});
