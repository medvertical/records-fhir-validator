export type FhirVersion = 'R4' | 'R5' | 'R6';

export function preferredMajorFor(fhirVersion?: FhirVersion): string | undefined {
    if (!fhirVersion) return undefined;
    return fhirVersion === 'R4' ? '4' : fhirVersion === 'R5' ? '5' : '6';
}

export function versionedCacheKey(canonical: string, requestedVersion?: string, fhirVersion?: FhirVersion): string {
    return JSON.stringify(['definition', canonical, requestedVersion ?? null, fhirVersion ?? null]);
}

export function parseDefinitionCacheKey(key: string): { canonical: string; requestedVersion?: string; fhirVersion?: FhirVersion } | undefined {
    if (!key.startsWith('["definition",')) return undefined;
    try {
        const value: unknown = JSON.parse(key);
        if (!Array.isArray(value) || value.length !== 4 || value[0] !== 'definition' || typeof value[1] !== 'string'
            || (value[2] !== null && typeof value[2] !== 'string')
            || (value[3] !== null && value[3] !== 'R4' && value[3] !== 'R5' && value[3] !== 'R6')) return undefined;
        return { canonical: value[1], requestedVersion: value[2] ?? undefined, fhirVersion: value[3] ?? undefined };
    } catch { return undefined; }
}

function extractPackageVersion(packageName: string): string | undefined {
    const hashIndex = packageName.lastIndexOf('#');
    return hashIndex >= 0 ? packageName.slice(hashIndex + 1) : undefined;
}

export function comparePackageVersions(candidate: string | undefined, current: string | undefined): number {
    if (!candidate && !current) return 0;
    if (candidate && !current) return 1;
    if (!candidate && current) return -1;

    const parse = (version: string): { parts: number[]; prerelease: boolean } => {
        const [core, prerelease] = version.split('-', 2);
        return {
            parts: core.split('.').map(part => {
                const numeric = part.match(/^\d+/)?.[0];
                return numeric ? Number(numeric) : 0;
            }),
            prerelease: Boolean(prerelease),
        };
    };

    const left = parse(candidate!);
    const right = parse(current!);
    const length = Math.max(left.parts.length, right.parts.length);
    for (let i = 0; i < length; i++) {
        const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
        if (diff !== 0) return diff;
    }

    if (left.prerelease !== right.prerelease) {
        return left.prerelease ? -1 : 1;
    }
    return 0;
}

export interface PackageMatchCandidate {
    packageName: string;
    isPreferredFhirMajor: boolean;
    /**
     * The package is the maintained home of the canonical (e.g. a
     * hl7.terminology package for a terminology.hl7.org canonical). Core
     * packages ship frozen snapshots of those resources that go stale — R4
     * core's adverse-event-seriousness still has pre-THO capitalised codes —
     * and the Java validator resolves against THO, so authority outranks
     * every other criterion.
     */
    isCanonicalAuthority: boolean;
    /** Index of the package store the match came from; lower = higher priority. */
    storeRank: number;
    resourceVersion?: string;
}

export function isCanonicalAuthorityPackage(packageName: string, canonical: string): boolean {
    if (canonical.startsWith('http://terminology.hl7.org/')) {
        return packageName.startsWith('hl7.terminology');
    }
    // Mirror rule: core-space canonicals belong to the FHIR core packages.
    // hl7.terminology ships snapshots of some of them (task-status), which
    // must not outrank core merely by having a newer package version.
    if (canonical.startsWith('http://hl7.org/fhir/')) {
        return /^hl7\.fhir\.r\d+[ab]?\.core(#|$)/.test(packageName);
    }
    return false;
}

export function isBetterPackageCandidate(
    candidate: PackageMatchCandidate,
    current: PackageMatchCandidate | null,
): boolean {
    if (!current) return true;
    if (candidate.isCanonicalAuthority !== current.isCanonicalAuthority) {
        return candidate.isCanonicalAuthority;
    }
    if (candidate.isPreferredFhirMajor !== current.isPreferredFhirMajor) {
        return candidate.isPreferredFhirMajor;
    }
    // Identical resource versions must resolve to the earlier store: a copy in
    // the user's package cache may not shadow the configured/bundled copy of
    // the same content, or resolution becomes machine-dependent.
    if (candidate.resourceVersion && candidate.resourceVersion === current.resourceVersion) {
        return candidate.storeRank < current.storeRank;
    }

    return comparePackageVersions(
        extractPackageVersion(candidate.packageName),
        extractPackageVersion(current.packageName),
    ) > 0;
}

/**
 * The first copy of a requested `url|version`, unless a dependency pin chose
 * the package it comes from: then that package's copy, found wherever it sits.
 */
export class ExactVersionMatch<T> {
    private first: T | null = null;

    constructor(private readonly pinnedPackage: string | null) {}

    /** Whether the search can stop at this copy. */
    settles(parsed: T, packageName: string): boolean {
        this.first ??= parsed;
        return !this.pinnedPackage || packageName === this.pinnedPackage;
    }

    get value(): T | null {
        return this.first;
    }
}
