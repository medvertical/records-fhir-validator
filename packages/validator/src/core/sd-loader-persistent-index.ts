/**
 * SDLoader Persistent Index
 * 
 * Caches the results of package scanning to disk so that subsequent
 * startups don't need to rescan all packages (saves 2-4 seconds).
 * 
 * The index is invalidated when:
 * - Any package directory timestamp changes
 * - The index file is missing
 * - The index file version doesn't match
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../logger';

const INDEX_VERSION = 2; // Bumped: v1 index may have cached empty-package dedup results
const INDEX_FILENAME = 'sdloader-profile-index.json';

interface PackageIndexEntry {
    name: string;
    profileCount: number;
    /** Modification time of the package directory */
    mtime: number;
}

interface ProfileIndex {
    version: number;
    generatedAt: number;
    packages: PackageIndexEntry[];
    profileUrls: string[];
}

/**
 * Get the path to the index file for a given source directory
 */
function getIndexPath(sourcePath: string): string {
    // Store index in the source directory itself
    return path.join(sourcePath, INDEX_FILENAME);
}

/**
 * Get modification times for all package directories
 */
async function getPackageModTimes(sourcePath: string): Promise<Map<string, number>> {
    const modTimes = new Map<string, number>();

    try {
        const entries = await fs.readdir(sourcePath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== 'node_modules') {
                const packagePath = path.join(sourcePath, entry.name);
                try {
                    const stat = await fs.stat(packagePath);
                    modTimes.set(entry.name, Math.floor(stat.mtimeMs));
                } catch {
                    // Skip if we can't stat the directory
                }
            }
        }
    } catch (_error) {
        logger.debug(`[SDLoaderIndex] Could not read source path: ${sourcePath}`);
    }

    return modTimes;
}

/**
 * Check if the index is still valid (no package changes)
 */
async function isIndexValid(index: ProfileIndex, sourcePath: string): Promise<boolean> {
    // Check version
    if (index.version !== INDEX_VERSION) {
        logger.debug('[SDLoaderIndex] Index version mismatch, will rescan');
        return false;
    }

    // Get current package modification times
    const currentModTimes = await getPackageModTimes(sourcePath);

    // Build a map of indexed package names -> mtime
    const indexedModTimes = new Map(
        index.packages.map(p => [p.name, p.mtime])
    );

    // Check if any packages were added
    for (const [name] of currentModTimes) {
        if (!indexedModTimes.has(name)) {
            logger.debug(`[SDLoaderIndex] New package detected: ${name}, will rescan`);
            return false;
        }
    }

    // Check if any packages were removed or modified
    for (const [name, indexedMtime] of indexedModTimes) {
        const currentMtime = currentModTimes.get(name);
        if (currentMtime === undefined) {
            logger.debug(`[SDLoaderIndex] Package removed: ${name}, will rescan`);
            return false;
        }
        // Allow 1 second tolerance for mtime comparison
        if (Math.abs(currentMtime - indexedMtime) > 1000) {
            logger.debug(`[SDLoaderIndex] Package modified: ${name} (${indexedMtime} -> ${currentMtime}), will rescan`);
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
    sourcePath: string
): Promise<Set<string> | null> {
    const indexPath = getIndexPath(sourcePath);

    try {
        const content = await fs.readFile(indexPath, 'utf-8');
        const index: ProfileIndex = JSON.parse(content);

        // Validate index
        if (!await isIndexValid(index, sourcePath)) {
            return null;
        }

        const age = Date.now() - index.generatedAt;
        const ageHours = Math.round(age / 3600000);
        logger.info(`[SDLoaderIndex] ✅ Loaded ${index.profileUrls.length} profiles from index (age: ${ageHours}h)`);

        return new Set(index.profileUrls);

    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.debug(`[SDLoaderIndex] Could not load index: ${err.message}`);
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
    packageDetails: Array<{ name: string; profileCount: number }>
): Promise<void> {
    const indexPath = getIndexPath(sourcePath);

    try {
        // Get modification times for all packages
        const modTimes = await getPackageModTimes(sourcePath);

        // Build package entries
        const packages: PackageIndexEntry[] = packageDetails.map(p => ({
            name: p.name,
            profileCount: p.profileCount,
            mtime: modTimes.get(p.name) || 0
        }));

        const index: ProfileIndex = {
            version: INDEX_VERSION,
            generatedAt: Date.now(),
            packages,
            profileUrls: Array.from(profileUrls)
        };

        await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
        logger.info(`[SDLoaderIndex] ✅ Saved index with ${profileUrls.size} profiles from ${packages.length} packages`);

    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`[SDLoaderIndex] Could not save index: ${err.message}`);
    }
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
        const err = error instanceof Error ? error : new Error(String(error));
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.warn(`[SDLoaderIndex] Could not clear index: ${err.message}`);
        }
    }
}
