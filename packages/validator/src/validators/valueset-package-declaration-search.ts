import type { PackageResourceReadObserver } from './valueset-package-publication-context.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
    comparePackageVersions,
    isBetterPackageCandidate,
    isCanonicalAuthorityPackage,
    type PackageMatchCandidate,
} from './valueset-package-utils.js';
import type { CanonicalDeclaration } from './valueset-package-canonical-index.js';
import { pinnedCanonicalSourceDir } from '../package/canonical-pin-scope.js';
import {
    declarationsDeclaringCanonical,
    isCanonicalMatch,
    isSameMajorFallback,
    packageMatchesMajor,
} from './valueset-package-search.js';

/**
 * Resolving a canonical from what the package indexes declare, rather than by
 * opening files to see what they hold.
 */

/**
 * Where the stores say this canonical lives, best candidate first, or null when
 * no index covers them. Ranking on the index rather than on parsed files is what
 * lets the caller open one file: `CodeSystem-v3-ActCode.json` was read eight
 * times, 1.45 MB each, only to compare its `url` and `version`.
 */
export async function rankedDeclarationsForCanonical(
    packageDirectories: string[],
    resourceType: string,
    canonical: string,
    preferredFhirMajor: string | undefined,
    requestedVersion: string | undefined,
): Promise<readonly RankedDeclaration[] | null> {
    const declarations = await declarationsDeclaringCanonical(
        packageDirectories, resourceType, canonical,
    );
    if (!declarations) return null;

    const ranked: RankedDeclaration[] = [];
    for (const [storeRank, rootDir] of packageDirectories.entries()) {
        for (const declaration of declarations) {
            // A version the index records but the request rules out cannot win,
            // and reading it would only confirm that.
            if (requestedVersion
                && declaration.version
                && declaration.version !== requestedVersion
                && !isSameMajorFallback(declaration.version, requestedVersion)) continue;
            const packagePath = await packageRoot(rootDir, declaration.packageName);
            if (packagePath) ranked.push({ declaration, storeRank, packagePath });
        }
    }
    const pinnedPackage = pinnedCanonicalSourceDir(canonical, requestedVersion);
    return ranked.sort((left, right) =>
        compareDeclarations(left, right, canonical, preferredFhirMajor, requestedVersion, pinnedPackage));
}

export type RankedDeclaration = {
    declaration: CanonicalDeclaration;
    storeRank: number;
    packagePath: string;
};

function compareDeclarations(
    left: RankedDeclaration,
    right: RankedDeclaration,
    canonical: string,
    preferredFhirMajor: string | undefined,
    requestedVersion: string | undefined,
    pinnedPackage: string | null,
): number {
    const exact = Number(right.declaration.version === requestedVersion)
        - Number(left.declaration.version === requestedVersion);
    if (requestedVersion && exact !== 0) return exact;
    // The package a dependency pin took the version from holds the copy the
    // IG was published against; others may ship stale content under it.
    const pinned = Number(right.declaration.packageName === pinnedPackage)
        - Number(left.declaration.packageName === pinnedPackage);
    if (pinned !== 0) return pinned;
    return isBetterPackageCandidate(
        candidateOf(left, canonical, preferredFhirMajor),
        candidateOf(right, canonical, preferredFhirMajor),
    ) ? -1 : 1;
}

function candidateOf(
    entry: RankedDeclaration,
    canonical: string,
    preferredFhirMajor: string | undefined,
): PackageMatchCandidate {
    return {
        packageName: entry.declaration.packageName,
        isPreferredFhirMajor: packageMatchesMajor(entry.declaration.packageName, preferredFhirMajor),
        isCanonicalAuthority: isCanonicalAuthorityPackage(entry.declaration.packageName, canonical),
        storeRank: entry.storeRank,
        resourceVersion: entry.declaration.version,
    };
}

// Both package layouts the index accepts: `<name>/package` and a bare `<name>`.
async function packageRoot(rootDir: string, packageName: string): Promise<string | null> {
    const base = path.join(rootDir, packageName);
    for (const candidate of [path.join(base, 'package'), base]) {
        try {
            if ((await fs.stat(candidate)).isDirectory()) return candidate;
        } catch { /* try the other layout */ }
    }
    return null;
}

/**
 * Reads the ranked candidates in order and returns the first that proves out.
 * Normally that is one file: the ranking already used the url and version the
 * index recorded, and the parse only confirms them.
 */
export async function readDeclaredResource<T extends DeclaredResource>(
    ranked: readonly RankedDeclaration[],
    canonical: string,
    requestedVersion?: string,
    onRead?: PackageResourceReadObserver,
): Promise<T | null> {
    let fallback: T | null = null;
    for (const entry of ranked) {
        const parsed = await readDeclaration<T>(entry, onRead);
        if (!parsed || !isCanonicalMatch(parsed, canonical)) continue;
        if (requestedVersion && parsed.version === requestedVersion) return parsed;
        if (!isSameMajorFallback(parsed.version, requestedVersion)) continue;
        if (!requestedVersion) return await newerContentCopy<T>(ranked, entry, parsed, canonical, onRead) ?? parsed;
        fallback ??= parsed;
    }
    return fallback;
}

type DeclaredResource = { url?: string; version?: string; content?: unknown };

async function readDeclaration<T>(entry: RankedDeclaration, onRead?: PackageResourceReadObserver): Promise<T | null> {
    try {
        const sourcePath = path.join(entry.packagePath, entry.declaration.filename);
        const content = await fs.readFile(sourcePath, 'utf8');
        const parsed = JSON.parse(content) as T;
        if (parsed && typeof parsed === 'object') await onRead?.(parsed, sourcePath, content);
        return parsed;
    } catch {
        return null;
    }
}

/**
 * A CodeSystem that leaves its content out defers to a newer copy that carries
 * it, as in the reference validator, which resolves the newest version it has:
 * THO only names CDC Race & Ethnicity, US Core 3.1.1 ships it complete. The
 * canonical's own authority keeps the last word — THO withholds licensed v2
 * tables on purpose, and core's older complete copies must not undo that.
 */
async function newerContentCopy<T extends DeclaredResource>(
    ranked: readonly RankedDeclaration[],
    chosen: RankedDeclaration,
    stub: T,
    canonical: string,
    onRead?: PackageResourceReadObserver,
): Promise<T | null> {
    if (stub.content !== 'not-present') return null;
    if (isCanonicalAuthorityPackage(chosen.declaration.packageName, canonical)) return null;
    for (const entry of ranked) {
        if (entry === chosen || comparePackageVersions(entry.declaration.version, stub.version) <= 0) continue;
        const copy = await readDeclaration<T>(entry, onRead);
        if (copy && isCanonicalMatch(copy, canonical) && copy.content === 'complete') return copy;
    }
    return null;
}
