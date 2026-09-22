/**
 * SDLoader Persistent Index
 * 
 * Caches the results of package scanning to disk so that subsequent
 * startups don't need to rescan all packages (saves 2-4 seconds).
 * 
 * The index is invalidated when:
 * - Any package manifest changes
 * - The index file is missing
 * - The index file version doesn't match
 *
 * Package directory mtimes are deliberately not used here. Container image
 * COPY operations may rewrite them even though the immutable package content
 * is unchanged, which would make a build-time index unusable at runtime.
 */

import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';
import { SD_LOADER_INDEX_FILENAME } from '../package/package-profile-index-metadata.js';
import {
    packageErrorMetadata,
    packageTargetMetadata,
} from '../package/package-artifact-policy.js';

const INDEX_VERSION = 5; // Bumped: v5 uses stable package-manifest fingerprints
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_INDEX_PROFILES = 1_000_000;

interface PackageIndexEntry {
    name: string;
    profileCount: number;
    /** SHA-256 of package/package.json. */
    manifestHash: string | null;
}

interface SourcePackageIndexEntry {
    name: string;
    /** SHA-256 of package/package.json. */
    manifestHash: string | null;
}

interface ProfileIndex {
    version: number;
    generatedAt: number;
    options?: {
        deduplicatePackages?: boolean;
    };
    /** Packages whose StructureDefinitions were included in profileUrls. */
    packages: PackageIndexEntry[];
    /** All package directories observed under the source path, including deduped/skipped versions. */
    sourcePackages: SourcePackageIndexEntry[];
    profileUrls: string[];
}

export interface PersistentIndexOptions {
    deduplicatePackages?: boolean;
}

/**
 * Get the path to the index file for a given source directory
 */
function getIndexPath(sourcePath: string): string {
    // Store index in the source directory itself
    return path.join(sourcePath, SD_LOADER_INDEX_FILENAME);
}

/**
 * Get stable identities for all package directories.
 *
 * FHIR packages are immutable and versioned by their package manifest. A
 * missing manifest is retained as a null identity so that the index is never
 * trusted for malformed or incomplete package directories.
 */
async function getPackageManifestHashes(sourcePath: string): Promise<Map<string, string | null>> {
    const manifestHashes = new Map<string, string | null>();

    try {
        const entries = await fs.readdir(sourcePath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== 'node_modules') {
                const manifestPath = path.join(sourcePath, entry.name, 'package', 'package.json');
                try {
                    const manifest = await fs.readFile(manifestPath);
                    const manifestHash = createHash('sha256').update(manifest).digest('hex');
                    manifestHashes.set(entry.name, manifestHash);
                } catch {
                    manifestHashes.set(entry.name, null);
                }
            }
        }
    } catch (error: unknown) {
        logger.debug('[SDLoaderIndex] Could not read package source', packageErrorMetadata(error));
    }

    return manifestHashes;
}

/**
 * Check if the index is still valid (no package changes)
 */
async function isIndexValid(index: ProfileIndex, sourcePath: string, options: PersistentIndexOptions): Promise<boolean> {
    // Check version
    if (index.version !== INDEX_VERSION) {
        logger.debug('[SDLoaderIndex] Index version mismatch, will rescan');
        return false;
    }

    if ((index.options?.deduplicatePackages ?? true) !== (options.deduplicatePackages ?? true)) {
        logger.debug('[SDLoaderIndex] Package deduplication mode changed, will rescan');
        return false;
    }

    const currentManifestHashes = await getPackageManifestHashes(sourcePath);

    const indexedSourcePackages = index.sourcePackages ?? index.packages;
    const indexedManifestHashes = new Map(
        indexedSourcePackages.map(p => [p.name, p.manifestHash])
    );

    // Check if any packages were added
    for (const [name] of currentManifestHashes) {
        if (!indexedManifestHashes.has(name)) {
            logger.debug('[SDLoaderIndex] New package detected; will rescan', packageTargetMetadata(name));
            return false;
        }
    }

    // Check if any packages were removed or modified
    for (const [name, indexedManifestHash] of indexedManifestHashes) {
        const currentManifestHash = currentManifestHashes.get(name);
        if (currentManifestHash === undefined) {
            logger.debug('[SDLoaderIndex] Package removed; will rescan', packageTargetMetadata(name));
            return false;
        }
        if (currentManifestHash === null || indexedManifestHash === null) {
            logger.debug('[SDLoaderIndex] Package manifest missing; will rescan', packageTargetMetadata(name));
            return false;
        }
        if (currentManifestHash !== indexedManifestHash) {
            logger.debug('[SDLoaderIndex] Package manifest changed; will rescan', packageTargetMetadata(name));
            return false;
        }
    }

    return true;
}

/**
 * Load profile URLs from persistent index if valid
 * Returns null if index is missing, invalid, or outdated
 */
export async function loadFromPersistentIndex(
    sourcePath: string,
    options: PersistentIndexOptions = {}
): Promise<Set<string> | null> {
    const indexPath = getIndexPath(sourcePath);

    try {
        const stats = await fs.stat(indexPath);
        if (stats.size > MAX_INDEX_BYTES) {
            logger.warn('[SDLoaderIndex] Refusing oversized persistent index');
            return null;
        }
        const content = await fs.readFile(indexPath, 'utf-8');
        const index = parseProfileIndex(JSON.parse(content));
        if (!index) {
            logger.debug('[SDLoaderIndex] Persistent index schema is invalid');
            return null;
        }

        // Validate index
        if (!await isIndexValid(index, sourcePath, options)) {
            return null;
        }

        const age = Date.now() - index.generatedAt;
        const ageHours = Math.round(age / 3600000);
        logger.info(`[SDLoaderIndex] ✅ Loaded ${index.profileUrls.length} profiles from index (age: ${ageHours}h)`);

        return new Set(index.profileUrls);

    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            logger.debug('[SDLoaderIndex] Could not load index', packageErrorMetadata(error));
        }
        return null;
    }
}

/**
 * Save profile URLs to persistent index
 */
export async function saveToPersistentIndex(
    sourcePath: string,
    profileUrls: Set<string>,
    packageDetails: Array<{ name: string; profileCount: number }>,
    options: PersistentIndexOptions = {}
): Promise<void> {
    const indexPath = getIndexPath(sourcePath);
    const temporaryPath = path.join(
        sourcePath,
        `.${SD_LOADER_INDEX_FILENAME}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
        const manifestHashes = await getPackageManifestHashes(sourcePath);

        // Build package entries
        const packages: PackageIndexEntry[] = packageDetails
            .map(p => ({
                name: p.name,
                profileCount: p.profileCount,
                manifestHash: manifestHashes.get(p.name) ?? null
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const sourcePackages: SourcePackageIndexEntry[] = Array.from(manifestHashes.entries())
            .map(([name, manifestHash]) => ({ name, manifestHash }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const index: ProfileIndex = {
            version: INDEX_VERSION,
            generatedAt: Date.now(),
            options,
            packages,
            sourcePackages,
            profileUrls: Array.from(profileUrls).sort()
        };

        await fs.writeFile(temporaryPath, JSON.stringify(index, null, 2), {
            encoding: 'utf-8',
            flag: 'wx',
            mode: 0o600,
        });
        await fs.rename(temporaryPath, indexPath);
        logger.info(`[SDLoaderIndex] ✅ Saved index with ${profileUrls.size} profiles from ${packages.length} packages`);

    } catch (error: unknown) {
        await fs.unlink(temporaryPath).catch(() => undefined);
        logger.warn('[SDLoaderIndex] Could not save index', packageErrorMetadata(error));
    }
}

function parseProfileIndex(value: unknown): ProfileIndex | null {
    if (!isRecord(value)) return null;
    const { version, generatedAt, options, packages, sourcePackages, profileUrls } = value;
    if (!Number.isSafeInteger(version) || typeof version !== 'number') return null;
    if (!Number.isSafeInteger(generatedAt) || typeof generatedAt !== 'number' || generatedAt <= 0) return null;
    if (!validOptions(options)) return null;
    if (!Array.isArray(packages) || !packages.every(validPackageEntry)) return null;
    if (!Array.isArray(sourcePackages) || !sourcePackages.every(validSourcePackageEntry)) return null;
    if (
        !Array.isArray(profileUrls)
        || profileUrls.length > MAX_INDEX_PROFILES
        || !profileUrls.every(validProfileCanonical)
    ) {
        return null;
    }
    return {
        version,
        generatedAt,
        ...(options ? { options } : {}),
        packages,
        sourcePackages,
        profileUrls,
    };
}

function validOptions(value: unknown): value is ProfileIndex['options'] {
    return value === undefined
        || (isRecord(value)
            && (value.deduplicatePackages === undefined
                || typeof value.deduplicatePackages === 'boolean'));
}

function validPackageEntry(value: unknown): value is PackageIndexEntry {
    return validSourcePackageEntry(value)
        && isRecord(value)
        && Number.isSafeInteger(value.profileCount)
        && Number(value.profileCount) >= 0;
}

function validSourcePackageEntry(value: unknown): value is SourcePackageIndexEntry {
    return isRecord(value)
        && typeof value.name === 'string'
        && value.name.length > 0
        && validManifestHash(value.manifestHash);
}

function validManifestHash(value: unknown): boolean {
    return value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}

function validProfileCanonical(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= 8192
        && !value.includes('\0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Clear the persistent index (force rescan on next startup)
 */
export async function clearPersistentIndex(sourcePath: string): Promise<void> {
    const indexPath = getIndexPath(sourcePath);

    try {
        await fs.unlink(indexPath);
        logger.info('[SDLoaderIndex] Index cleared');
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            logger.warn('[SDLoaderIndex] Could not clear index', packageErrorMetadata(error));
        }
    }
}
