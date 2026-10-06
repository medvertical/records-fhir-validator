import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { FhirVersion } from './valueset-package-utils.js';

export type PackageResourceReadObserver = (resource: object, sourcePath: string, bytes: string) => Promise<void>;

export interface PackageResourcePublication {
    sourcePath: string;
    definitionSha256: string;
    packageManifestPath: string;
    packageManifestSha256?: string;
    packageName?: string;
    packageVersion?: string;
    declaredFhirVersions: string[];
    fhirVersion?: FhirVersion;
}

/** Publication evidence follows the actual parsed object, never its business version. */
export class ValueSetPackagePublicationContexts {
    private readonly origins = new WeakMap<object, PackageResourcePublication>();

    readonly observe: PackageResourceReadObserver = async (resource, sourcePath, bytes) => {
        if (!resource || typeof resource !== 'object' || !('resourceType' in resource) || resource.resourceType !== 'ValueSet') return;
        const publication: PackageResourcePublication = {
            sourcePath, definitionSha256: sha256(bytes),
            packageManifestPath: path.join(path.dirname(sourcePath), 'package.json'), declaredFhirVersions: [],
        };
        try {
            const manifestBytes = await fs.readFile(publication.packageManifestPath, 'utf8');
            publication.packageManifestSha256 = sha256(manifestBytes);
            const manifest: unknown = JSON.parse(manifestBytes);
            if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
                const fields = manifest as Record<string, unknown>;
                publication.packageName = typeof fields.name === 'string' ? fields.name : undefined;
                publication.packageVersion = typeof fields.version === 'string' ? fields.version : undefined;
                const declarations = [fields.fhirVersions, fields['fhir-version-list']].filter(value => value !== undefined);
                if (!declarations.some(value => !Array.isArray(value) || value.some(entry => typeof entry !== 'string'))) {
                    publication.declaredFhirVersions = declarations.flat() as string[];
                    const versions = new Set(publication.declaredFhirVersions.map(publicationVersion));
                    if (!versions.has(undefined) && versions.size === 1) publication.fhirVersion = [...versions][0];
                }
            }
        } catch { /* Absent or malformed source metadata cannot attest a publication. */ }
        this.origins.set(resource, publication);
    };

    async get(resource: object): Promise<PackageResourcePublication | undefined> {
        const origin = this.origins.get(resource);
        if (!origin) return undefined;
        const publication = { ...origin, declaredFhirVersions: [...origin.declaredFhirVersions] };
        try {
            // Both source files belong to the read epoch of this cached object.
            const definitionCurrent = sha256(await fs.readFile(origin.sourcePath, 'utf8')) === origin.definitionSha256;
            const manifestCurrent = sha256(await fs.readFile(origin.packageManifestPath, 'utf8')) === origin.packageManifestSha256;
            if (!definitionCurrent || !manifestCurrent) publication.fhirVersion = undefined;
        } catch { publication.fhirVersion = undefined; }
        return publication;
    }
}

function sha256(bytes: string): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function publicationVersion(version: string): FhirVersion | undefined {
    if (/^4\.(?:0|3)\.\d+(?:[-+].+)?$/.test(version)) return 'R4';
    if (/^5\.0\.\d+(?:[-+].+)?$/.test(version)) return 'R5';
    if (/^6\.0\.\d+(?:[-+].+)?$/.test(version)) return 'R6';
    return undefined;
}
