import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { ValidationSettings } from '@records-fhir/validation-types';
import { captureValidationDependency, isValidationDependencySnapshotActive } from '../validation-dependency-snapshot.js';

/** A transferable result for warming the validator's in-memory profile cache. */
export interface ProfileResolutionEntry {
    canonicalUrl: string;
    profile: StructureDefinition;
    version?: string;
    source?: string;
}

/** Request-local package scope supplied by the embedding application. */
export interface ProfileSourceContext {
    organizationId?: number;
    serverId?: number;
    fhirVersion?: 'R4' | 'R5' | 'R6';
}

/**
 * Optional profile capabilities supplied by a host application.
 *
 * Methods remain optional so standalone and filesystem-only embedders can
 * install only the capabilities they own. Engine callers treat an absent
 * method as unavailable, never as evidence that a tenant-scoped lookup may
 * fall through to a shared source.
 */
export interface ProfileLookupSource {
    /**
     * Directories containing IG-package subdirectories (`<name>#<version>/`).
     * Declaring them lets terminology resolution search the same host-owned
     * package stores as profile resolution, without a separate config path.
     */
    packageDirectories?: string[];

    findByUrl?(
        url: string,
        fhirVersion?: 'R4' | 'R5' | 'R6',
        context?: ProfileSourceContext,
    ): Promise<StructureDefinition | null>;

    resolveProfile?(
        url: string,
        version: string | undefined,
        settings: ValidationSettings | undefined,
        context?: ProfileSourceContext,
    ): Promise<StructureDefinition | null>;

}

export interface ProfileWarmupSource {
    loadAllForWarmup?(): Promise<Map<string, ProfileResolutionEntry>>;

    warmupRecent?(
        setProfile: (cacheKey: string, sd: StructureDefinition) => void,
        getProfile: (cacheKey: string) => StructureDefinition | null | undefined,
        limit?: number,
        context?: ProfileSourceContext,
    ): Promise<{ warmedUp: number; timeMs: number }>;

}

export interface ExternalProfileSource {
    fetchExternalProfile?(url: string): Promise<StructureDefinition | null>;

    findPackageForProfile?(
        url: string,
    ): Promise<{ packageId: string; confidenceScore?: number } | null>;

}

export interface CanonicalResourceSource {
    findCanonicalResource?(
        url: string,
        resourceType: string,
        version: string | undefined,
        context?: ProfileSourceContext,
    ): Promise<Record<string, unknown> | null>;

}

export interface CodeSystemAvailabilitySource {
    /** True only when the resolved CodeSystem contains assertable code membership. */
    hasCodeSystem?(
        url: string,
        version: string | undefined,
        context?: ProfileSourceContext,
    ): Promise<boolean>;
}

/** Host capabilities available to the standalone validator package. */
export interface ProfileSource extends
    ProfileLookupSource,
    ProfileWarmupSource,
    ExternalProfileSource,
    CanonicalResourceSource,
    CodeSystemAvailabilitySource {}

const NOOP_PROFILE_SOURCE: ProfileSource = {};

let activeProfileSource: ProfileSource = NOOP_PROFILE_SOURCE;
let activeProfileSourceRevision = 0;

/** Replace the host profile capabilities for subsequently created work. */
export function setProfileSource(source: ProfileSource): void {
    activeProfileSource = source;
    activeProfileSourceRevision++;
}

export function getProfileSource(): ProfileSource {
    if (isValidationDependencySnapshotActive()) return new Proxy(activeProfileSource, {
        get(target, property) {
            const method: unknown = Reflect.get(target, property);
            if (typeof method !== 'function' || typeof property !== 'string'
                || !['findByUrl', 'resolveProfile', 'fetchExternalProfile', 'findCanonicalResource', 'hasCodeSystem'].includes(property)) {
                return typeof method === 'function' ? method.bind(target) : method;
            }
            const kind = property === 'hasCodeSystem' ? 'terminology' : 'profile';
            return (...args: unknown[]) => captureValidationDependency(kind, `host-${property}`, args,
                () => Reflect.apply(method, target, args) as Promise<unknown>);
        },
    });
    return activeProfileSource;
}

/** Host package stores declared on the active source; empty when none. */
export function getProfileSourcePackageDirectories(): string[] {
    const directories = activeProfileSource.packageDirectories;
    return directories ? [...directories] : [];
}

/** Cache discriminator that changes whenever the host replaces its source. */
export function getProfileSourceRevision(): number {
    return activeProfileSourceRevision;
}
