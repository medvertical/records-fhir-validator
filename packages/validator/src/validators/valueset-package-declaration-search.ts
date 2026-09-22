import { promises as fs } from 'fs';
import * as path from 'path';
import {
    isBetterPackageCandidate,
    isCanonicalAuthorityPackage,
    type PackageMatchCandidate,
} from './valueset-package-utils.js';
import type { CanonicalDeclaration } from './valueset-package-canonical-index.js';
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
    return ranked.sort((left, right) =>
        compareDeclarations(left, right, canonical, preferredFhirMajor, requestedVersion));
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
): number {
    const exact = Number(right.declaration.version === requestedVersion)
        - Number(left.declaration.version === requestedVersion);
    if (requestedVersion && exact !== 0) return exact;
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
export async function readDeclaredResource<T extends { url?: string; version?: string }>(
    ranked: readonly RankedDeclaration[],
    canonical: string,
    requestedVersion?: string,
): Promise<T | null> {
    let fallback: T | null = null;
    for (const entry of ranked) {
        const filePath = path.join(entry.packagePath, entry.declaration.filename);
        let parsed: T;
        try {
            parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
        } catch {
            continue;
        }
        if (!isCanonicalMatch(parsed, canonical)) continue;
        if (requestedVersion && parsed.version === requestedVersion) return parsed;
        if (!isSameMajorFallback(parsed.version, requestedVersion)) continue;
        if (!requestedVersion) return parsed;
        fallback ??= parsed;
    }
    return fallback;
}
