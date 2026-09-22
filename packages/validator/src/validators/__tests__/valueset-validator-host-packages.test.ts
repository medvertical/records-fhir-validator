/**
 * Hosted-deployment regression: an installed IG whose value sets no public
 * terminology server knows must still verify its bindings from the tenant's
 * own package definitions, even when no filesystem store carries the package.
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProfileSource, type ProfileSourceContext } from '../../persistence';
import type { CodeSystem, ValueSet } from '../valueset-types';
import { ValueSetValidator } from '../valueset-validator';

const VS_URL = 'https://example.test/ValueSet/person-relationship-type';
const CS_URL = 'https://example.test/CodeSystem/relationship-role';

const relationshipValueSet: ValueSet = {
    resourceType: 'ValueSet',
    url: VS_URL,
    version: '2.1.0',
    status: 'active',
    compose: { include: [{ system: CS_URL }] },
};

const relationshipCodeSystem: CodeSystem = {
    resourceType: 'CodeSystem',
    url: CS_URL,
    version: '1.0.0',
    status: 'active',
    content: 'complete',
    concept: [{ code: 'N', display: 'Next-of-Kin' }, { code: 'C', display: 'Emergency Contact' }],
};

const originalPackageCachePath = process.env.FHIR_PACKAGE_CACHE_PATH;
let emptyCacheDir: string;

beforeEach(async () => {
    emptyCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'records-empty-cache-'));
    process.env.FHIR_PACKAGE_CACHE_PATH = emptyCacheDir;
});

afterEach(async () => {
    setProfileSource({});
    if (originalPackageCachePath === undefined) delete process.env.FHIR_PACKAGE_CACHE_PATH;
    else process.env.FHIR_PACKAGE_CACHE_PATH = originalPackageCachePath;
    await fs.rm(emptyCacheDir, { recursive: true, force: true });
});

function tenantPackages(organizationId: number) {
    const findCanonicalResource = vi.fn(async (
        url: string,
        resourceType: string,
        _version: string | undefined,
        context?: ProfileSourceContext,
    ) => {
        if (context?.organizationId !== organizationId) return null;
        if (resourceType === 'ValueSet' && url === VS_URL) return relationshipValueSet;
        if (resourceType === 'CodeSystem' && url === CS_URL) return relationshipCodeSystem;
        return null;
    });
    setProfileSource({ findCanonicalResource });
    return findCanonicalResource;
}

function localOnlyValidator(): ValueSetValidator {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({ strategy: 'local-only' });
    return validator;
}

describe('bindings against an installed package no terminology server knows', () => {
    it('stays unverified while the runtime is not bound to a tenant', async () => {
        const host = tenantPackages(7);
        const validator = localOnlyValidator();

        await expect(validator.resolveCodeBindingForBinding('N', CS_URL, VS_URL, 'extensible', 'R4'))
            .resolves.toBe('unverified');
        expect(host).not.toHaveBeenCalled();
    });

    it('verifies the code from the tenant packages once the scope is bound, discarding earlier misses', async () => {
        const host = tenantPackages(7);
        const validator = localOnlyValidator();
        await expect(validator.resolveCodeBindingForBinding('N', CS_URL, VS_URL, 'extensible', 'R4'))
            .resolves.toBe('unverified');

        validator.setSourceContext({ organizationId: 7, fhirVersion: 'R4' });

        await expect(validator.resolveCodeBindingForBinding('N', CS_URL, VS_URL, 'extensible', 'R4'))
            .resolves.toBe('valid');
        await expect(validator.resolveCodeBindingForBinding('X', CS_URL, VS_URL, 'extensible', 'R4'))
            .resolves.toBe('invalid');
        expect(host).toHaveBeenCalledWith(
            VS_URL, 'ValueSet', undefined, expect.objectContaining({ organizationId: 7 }),
        );
    });

    it('does not answer one tenant from another tenant\'s packages', async () => {
        tenantPackages(7);
        const validator = localOnlyValidator();
        validator.setSourceContext({ organizationId: 8, fhirVersion: 'R4' });

        await expect(validator.resolveCodeBindingForBinding('N', CS_URL, VS_URL, 'extensible', 'R4'))
            .resolves.toBe('unverified');
    });
});
