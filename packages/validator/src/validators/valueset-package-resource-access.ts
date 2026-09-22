/**
 * Boundary for resolving terminology resources from FHIR package stores: the
 * host's tenant-scoped packages first, then the filesystem stores.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDefaultBundledProfilesPath } from '../core/sd-loader-bundled-path.js';
import { logger } from '../logger.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import {
    getProfileSource,
    getProfileSourcePackageDirectories,
    type ProfileSourceContext,
} from '../persistence/index.js';
import {
    findResourceByCanonicalScan,
    findResourceInPackages,
    isSameMajorFallback,
    packagesDeclaringCanonical,
    ValueSetPackageIndexCache,
} from './valueset-package-search.js';
import {
    rankedDeclarationsForCanonical,
    readDeclaredResource,
} from './valueset-package-declaration-search.js';

interface CanonicalResource {
    url?: string;
    version?: string;
}

export class ValueSetPackageResourceAccess {
    private readonly packageIndexCache = new ValueSetPackageIndexCache();
    private readonly explicitPackageDirectories: string[] | null;
    private sourceContext: ProfileSourceContext | undefined;

    constructor(packageDirectories?: string[]) {
        this.explicitPackageDirectories = packageDirectories ? [...packageDirectories] : null;
    }

    /**
     * Explicit constructor directories are used verbatim (test isolation);
     * otherwise host stores declared via `setProfileSource` are searched
     * before the built-in defaults. Resolved lazily so a profile source
     * installed after loader construction still takes effect.
     */
    getPackageDirectories(): string[] {
        if (this.explicitPackageDirectories) return [...this.explicitPackageDirectories];
        return resolveValueSetPackageDirectories();
    }

    /**
     * Bind lookups to the host's tenant package scope. Without an organization
     * the host tier stays off, so a runtime shared by embedders never answers
     * one tenant's lookup from another tenant's packages. Returns true when
     * the tenant changed, which invalidates misses recorded before.
     */
    setSourceContext(context: ProfileSourceContext | undefined): boolean {
        const next = context?.organizationId === undefined ? undefined : { ...context };
        const changed = next?.organizationId !== this.sourceContext?.organizationId;
        this.sourceContext = next;
        return changed;
    }

    getSourceContext(): ProfileSourceContext | undefined {
        return this.sourceContext ? { ...this.sourceContext } : undefined;
    }

    clear(): void {
        this.packageIndexCache.clear();
    }

    async findInPackages<T extends CanonicalResource>(
        canonical: string,
        candidateFiles: string[],
        preferredFhirMajor?: string,
        requestedVersion?: string,
        candidatePackages?: ReadonlySet<string> | null,
    ): Promise<T | null> {
        return findResourceInPackages(
            this.getPackageDirectories(),
            canonical,
            candidateFiles,
            preferredFhirMajor,
            requestedVersion,
            candidatePackages,
        );
    }

    async findByCanonicalScan<T extends CanonicalResource>(
        canonical: string,
        filePrefix: string,
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<T | null> {
        return findResourceByCanonicalScan(
            this.getPackageDirectories(),
            canonical,
            filePrefix,
            preferredFhirMajor,
            requestedVersion,
            this.packageIndexCache,
        );
    }

    /**
     * Host packages, the ones the tenant installed, outrank the filesystem
     * stores the same way tenant profiles outrank bundled ones. An exact
     * version pin found in either tier outranks a same-major fallback from
     * the other, so a pinned lookup asks both before settling for a fallback.
     * `resourceType` doubles as the well-known filename prefix of the stores.
     */
    async findResource<T extends CanonicalResource>(
        canonical: string,
        candidateFiles: string[],
        resourceType: string,
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<T | null> {
        const hostExact = await this.findInHostPackages<T>(canonical, resourceType, requestedVersion);
        if (hostExact) return hostExact;

        const local = await this.findInLocalStores<T>(
            canonical, candidateFiles, resourceType, preferredFhirMajor, requestedVersion,
        );
        if (local && (!requestedVersion || local.version === requestedVersion)) return local;

        if (requestedVersion) {
            const hostFallback = await this.findInHostPackages<T>(canonical, resourceType, undefined);
            if (hostFallback && isSameMajorFallback(hostFallback.version, requestedVersion)) return hostFallback;
        }
        return local;
    }

    /**
     * Well-known-filename lookup with canonical-scan fallback. The scan also
     * runs when the filename path only produced a same-major fallback for a
     * pinned version: an exact pin present anywhere (e.g. under an
     * unconventional filename) outranks any fallback.
     */
    private async findInLocalStores<T extends CanonicalResource>(
        canonical: string,
        candidateFiles: string[],
        filePrefix: string,
        preferredFhirMajor?: string,
        requestedVersion?: string,
    ): Promise<T | null> {
        // One index lookup decides whether either search can find anything: a
        // canonical no package declares used to cost a pass over every package
        // in both of them, once for the well-known filenames and once for the
        // scan.
        const directories = this.getPackageDirectories();
        const candidatePackages = await packagesDeclaringCanonical(directories, filePrefix, canonical);
        if (candidatePackages && candidatePackages.size === 0) return null;

        // When the index names the files, the best candidate is decided from it
        // and only that file is opened. Guessing well-known names instead read
        // the same 1.45 MB CodeSystem out of eight packages to compare its url.
        const declared = await rankedDeclarationsForCanonical(
            directories, filePrefix, canonical, preferredFhirMajor, requestedVersion,
        );
        if (declared) {
            const fromIndex = await readDeclaredResource<T>(declared, canonical, requestedVersion);
            if (fromIndex) return fromIndex;
        }

        const named = await this.findInPackages<T>(
            canonical, candidateFiles, preferredFhirMajor, requestedVersion, candidatePackages,
        );
        if (named && (!requestedVersion || named.version === requestedVersion)) return named;

        const scanned = await this.findByCanonicalScan<T>(
            canonical, filePrefix, preferredFhirMajor, requestedVersion,
        );
        if (!named) return scanned;
        return scanned?.version === requestedVersion ? scanned : named;
    }

    private async findInHostPackages<T extends CanonicalResource>(
        canonical: string,
        resourceType: string,
        requestedVersion: string | undefined,
    ): Promise<T | null> {
        const context = this.sourceContext;
        const source = getProfileSource();
        if (!context || !source.findCanonicalResource) return null;
        try {
            const resource = await source.findCanonicalResource(
                canonical, resourceType, requestedVersion, context,
            );
            return isHostResource<T>(resource, canonical, resourceType) ? resource : null;
        } catch (error) {
            logger.debug('[ValueSetPackageResourceAccess] Host package lookup failed', {
                resourceType,
                ...validationFailureMetadata(error),
            });
            return null;
        }
    }
}

/**
 * Package stores terminology resources resolve from, in search order. Also
 * the store set dependency pinning consults for ValueSet/CodeSystem
 * canonicals — pins must observe exactly the stores the loader searches.
 */
export function resolveValueSetPackageDirectories(): string[] {
    return Array.from(new Set([
        ...getProfileSourcePackageDirectories(),
        ...defaultPackageDirectories(),
    ]));
}

// A host answer is trusted only when it identifies itself as the requested
// definition; a mismatched canonical would poison the loader caches.
function isHostResource<T extends CanonicalResource>(
    value: unknown,
    canonical: string,
    resourceType: string,
): value is T {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return record.resourceType === resourceType && record.url === canonical;
}

// Repo-relative defaults must not depend on process.cwd() — embedders (CLI,
// MCP, editors) frequently start elsewhere and would silently lose the
// bundled store. This module sits at packages/validator/{src,dist}/validators,
// so the monorepo root is four levels up in both layouts; outside the
// monorepo the resulting paths simply do not exist and are skipped.
const MONOREPO_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', '..',
);

// Bundled/repo stores rank before the user package cache: their content is
// version-controlled and identical across machines, while ~/.fhir/packages
// holds whatever any tool happened to download. The cache stays last as a
// supplemental fallback so resolution never depends on local download history
// when a controlled copy exists.
function defaultPackageDirectories(): string[] {
    const configuredCachePath = process.env.FHIR_PACKAGE_CACHE_PATH;
    const bundledProfilesPath = resolveDefaultBundledProfilesPath();
    const directories = [
        path.join(MONOREPO_ROOT, 'server', 'data', 'fhir-packages'),
        path.join(MONOREPO_ROOT, 'packages', 'bundled-profiles', 'storage', 'profiles', 'bundled'),
        ...(bundledProfilesPath ? [bundledProfilesPath] : []),
        path.join(MONOREPO_ROOT, 'server', 'data', 'bundled-igs'),
        path.join(MONOREPO_ROOT, 'server', 'storage', 'profiles', 'bundled'),
        configuredCachePath
            ? path.resolve(expandHomePath(configuredCachePath))
            : path.join(os.homedir(), '.fhir', 'packages'),
    ];

    return Array.from(new Set(directories));
}

function expandHomePath(pathValue: string): string {
    const homeDirectory = process.env.HOME || os.homedir() || '/tmp';
    if (pathValue.startsWith('$HOME/') || pathValue.startsWith('$HOME\\')) {
        return pathValue.replace('$HOME', homeDirectory);
    }
    if (pathValue.startsWith('${HOME}/') || pathValue.startsWith('${HOME}\\')) {
        return pathValue.replace('${HOME}', homeDirectory);
    }
    if (pathValue.startsWith('~/')) {
        return pathValue.replace('~', homeDirectory);
    }
    return pathValue;
}
