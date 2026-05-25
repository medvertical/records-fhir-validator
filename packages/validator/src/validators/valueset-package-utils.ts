export type FhirVersion = 'R4' | 'R5' | 'R6';

export function preferredMajorFor(fhirVersion?: FhirVersion): string | undefined {
    if (!fhirVersion) return undefined;
    return fhirVersion === 'R4' ? '4' : fhirVersion === 'R5' ? '5' : '6';
}

export function versionedCacheKey(canonical: string, requestedVersion?: string, fhirVersion?: FhirVersion): string {
    if (requestedVersion) return `${canonical}|${requestedVersion}`;
    return fhirVersion ? `${canonical}|${fhirVersion}` : canonical;
}

function extractPackageVersion(packageName: string): string | undefined {
    const hashIndex = packageName.lastIndexOf('#');
    return hashIndex >= 0 ? packageName.slice(hashIndex + 1) : undefined;
}

function comparePackageVersions(candidate: string | undefined, current: string | undefined): number {
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

export function isBetterPackageMatch(
    packageName: string,
    isPreferredFhirMajor: boolean,
    currentPackageName: string | null,
    currentIsPreferredFhirMajor: boolean,
): boolean {
    if (!currentPackageName) return true;
    if (isPreferredFhirMajor !== currentIsPreferredFhirMajor) {
        return isPreferredFhirMajor;
    }

    return comparePackageVersions(
        extractPackageVersion(packageName),
        extractPackageVersion(currentPackageName),
    ) > 0;
}
