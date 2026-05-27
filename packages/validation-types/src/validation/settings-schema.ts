/**
 * Validation Settings Zod Schemas
 * 
 * Single source of truth for validation settings structure.
 * TypeScript types are derived from these schemas via z.infer<>.
 * 
 * Benefits:
 * - Runtime validation with detailed error messages
 * - Auto-generated TypeScript types
 * - deepPartial() for update schemas (no manual field lists)
 * - Consistent validation across client and server
 */

import { z } from 'zod';
import { normalizeValidationSettings } from './aspect-aliases';

// ============================================================================
// Enum Schemas
// ============================================================================

export const ValidationAspectSchema = z.enum([
    'structural', 'profile', 'terminology', 'reference', 'invariant', 'custom_rule', 'metadata', 'anomaly'
]);

export const ValidationSeveritySchema = z.enum([
    'fatal', 'error', 'warning', 'information', 'info', 'inherit'
]);

export const ValidationStrictnessSchema = z.enum([
    'compatibility', 'standard', 'strict'
]);

export const ServerStatusSchema = z.enum([
    'healthy', 'degraded', 'unhealthy', 'circuit-open', 'unknown'
]);

export const FHIRVersionSchema = z.enum(['R4', 'R5', 'R6']);

// Engine types
export const StructuralValidationEngineSchema = z.enum(['records', 'schema', 'hapi', 'server']);
export const ProfileValidationEngineSchema = z.enum(['records', 'hapi', 'server', 'auto']);
export const TerminologyValidationEngineSchema = z.enum(['records', 'server', 'terminology-servers', 'cached', 'hapi']);
export const ReferenceValidationEngineSchema = z.enum(['records', 'internal', 'server']);
export const InvariantValidationEngineSchema = z.enum(['fhirpath', 'hapi']);
export const CustomRuleValidationEngineSchema = z.enum(['fhirpath', 'custom']);
export const MetadataValidationEngineSchema = z.enum(['records', 'schema', 'hapi']);

// ============================================================================
// Component Schemas
// ============================================================================

export const ValidationAspectConfigSchema = z.object({
    enabled: z.boolean(),
    severity: ValidationSeveritySchema,
    engine: z.string().optional(),
});

export const ProfileSourcesConfigSchema = z.object({
    simplifier: z.boolean(),
    packageRegistry: z.boolean(),
});

export const TerminologyAuthConfigSchema = z.object({
    type: z.enum(['none', 'basic', 'bearer', 'oauth2', 'mtls']),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    scope: z.string().optional(),
    tokenUrl: z.string().optional(),
    clientCert: z.string().optional(),
    clientCertPath: z.string().optional(),
    clientKey: z.string().optional(),
    clientKeyPath: z.string().optional(),
    caCert: z.string().optional(),
    caCertPath: z.string().optional(),
    passphrase: z.string().optional(),
    rejectUnauthorized: z.boolean().optional(),
});

export const MiiTerminologyModeSchema = z.enum(['mii-local-blaze', 'mii-ontoserver', 'mii-hybrid']);

export const MiiValidationSettingsSchema = z.object({
    preset: z.enum(['mii-2026', 'ehds-2026']),
    terminologyMode: MiiTerminologyModeSchema,
    packageLockHash: z.string().optional(),
    maxOntoserverRequestsPerRun: z.number().int().positive().optional(),
    allowHighVolumeOntoserver: z.boolean().optional(),
});

export const TerminologyServerSchema = z.object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    enabled: z.boolean(),
    fhirVersions: z.array(z.enum(['R4', 'R5', 'R6'])),
    status: ServerStatusSchema,
    failureCount: z.number(),
    lastFailureTime: z.number().nullable(),
    circuitOpen: z.boolean(),
    responseTimeAvg: z.number(),
    lastTested: z.number().nullable().optional(),
    testScore: z.number().optional(),
    authConfig: TerminologyAuthConfigSchema.optional(),
    preferredSystems: z.array(z.string()).optional(),
});

export const CircuitBreakerConfigSchema = z.object({
    failureThreshold: z.number(),
    resetTimeout: z.number(),
    halfOpenTimeout: z.number(),
});

export const AdvancedTerminologyConfigSchema = z.object({
    hierarchyValidation: z.object({
        enabled: z.boolean(),
        contextMappings: z.record(z.string(), z.string()).optional(),
    }),
    eclValidation: z.object({
        enabled: z.boolean(),
        customExpressions: z.record(z.string(), z.string()).optional(),
    }),
    crossMappingValidation: z.object({
        enabled: z.boolean(),
        strictness: z.enum(['warn', 'error']),
        checkPairs: z.array(z.object({
            sourceSystem: z.string(),
            targetSystem: z.string(),
        })).optional(),
    }),
});

export const TerminologyResolutionSchema = z.object({
    strategy: z.enum(['local-first', 'server-first', 'local-only']),
    serverDelegation: z.object({
        expandValueSets: z.boolean(),
        validateCodes: z.boolean(),
        cacheResults: z.boolean(),
        cacheTTLSeconds: z.number(),
    }).optional(),
    twoPhaseExpansion: z.object({
        enabled: z.boolean(),
        mode: z.enum(['shadow', 'enforce']),
        logMismatches: z.boolean().optional(),
    }).optional(),
    unknownCodeBehavior: z.enum(['required-closed', 'all-open', 'all-closed']).optional(),
});

export const PackageDownloadConfigSchema = z.object({
    versionPolicy: z.enum(['prefer-stable', 'prefer-latest']),
    pinnedVersions: z.record(z.string(), z.string()),
    approvedPackages: z.array(z.string()),
    requireApproval: z.boolean(),
    autoDownload: z.boolean(),
});

export const RecursiveReferenceValidationSchema = z.object({
    enabled: z.boolean(),
    maxDepth: z.number(),
    validateExternal: z.boolean(),
    validateContained: z.boolean(),
    validateBundleEntries: z.boolean(),
    excludeResourceTypes: z.array(z.string()).optional(),
    maxReferencesPerResource: z.number().optional(),
    timeoutMs: z.number().optional(),
});

export const CacheConfigSchema = z.object({
    layers: z.object({
        L1: z.enum(['enabled', 'disabled']).optional(),
        L2: z.enum(['enabled', 'disabled']).optional(),
        L3: z.enum(['enabled', 'disabled']).optional(),
    }).optional(),
    l1MaxSizeMb: z.number().optional(),
    l2MaxSizeGb: z.number().optional(),
    l3MaxSizeGb: z.number().optional(),
    ttl: z.object({
        validation: z.number().optional(),
        profile: z.number().optional(),
        terminology: z.number().optional(),
        igPackage: z.number().optional(),
        default: z.number().optional(),
    }).optional(),
    enableWarmup: z.boolean().optional(),
    warmupProfiles: z.array(z.string()).optional(),
    warmupTerminologySystems: z.array(z.string()).optional(),
});

export const HapiConfigSchema = z.object({
    enabled: z.boolean(),
    available: z.boolean().optional(),
    timeout: z.number().optional(),
    igPackages: z.array(z.string()).optional(),
    useProcessPool: z.boolean().optional(),
    poolSize: z.number().optional(),
    cachePath: z.string().optional(),
    enableBestPractice: z.boolean().optional(),
});

// ============================================================================
// Main ValidationSettings Schema
// ============================================================================

export const ValidationSettingsSchema = z.object({
    // Core aspects
    aspects: z.object({
        structural: ValidationAspectConfigSchema,
        profile: ValidationAspectConfigSchema,
        terminology: ValidationAspectConfigSchema,
        reference: ValidationAspectConfigSchema,
        invariant: ValidationAspectConfigSchema,
        custom_rule: ValidationAspectConfigSchema,
        metadata: ValidationAspectConfigSchema,
        anomaly: ValidationAspectConfigSchema,
    }).strict(),

    // Performance
    performance: z.object({
        maxConcurrent: z.number().min(1).max(20),
        batchSize: z.number().min(10).max(100),
        enableDeltaSearch: z.boolean().optional(),
    }),

    // Resource type filtering
    resourceTypes: z.object({
        enabled: z.boolean(),
        includedTypes: z.array(z.string()),
        excludedTypes: z.array(z.string()),
    }),

    // Optional settings
    terminologyServers: z.array(TerminologyServerSchema).optional(),
    mii: MiiValidationSettingsSchema.optional(),
    terminologyResolution: TerminologyResolutionSchema.optional(),
    circuitBreaker: CircuitBreakerConfigSchema.optional(),
    mode: z.enum(['online', 'offline']).optional(),
    terminologyFallback: z.object({
        local: z.string().optional(),
        remote: z.string().optional(),
    }).optional(),
    offlineConfig: z.object({
        ontoserverUrl: z.string().optional(),
        profileCachePath: z.string().optional(),
    }).optional(),
    profileSources: ProfileSourcesConfigSchema.optional(),
    advancedTerminology: AdvancedTerminologyConfigSchema.optional(),
    packageDownload: PackageDownloadConfigSchema.optional(),
    autoRevalidateAfterEdit: z.boolean().optional(),
    autoRevalidateOnVersionChange: z.boolean().optional(),
    listViewPollingInterval: z.number().optional(),
    enableBestPracticeChecks: z.boolean().optional(),
    bestPracticeSeverity: z.enum(['warning', 'info']).optional(),
    validationStrictness: ValidationStrictnessSchema.optional(),
    recursiveReferenceValidation: RecursiveReferenceValidationSchema.optional(),
    cacheConfig: CacheConfigSchema.optional(),
    hapiConfig: HapiConfigSchema.optional(),
    autoApplyCustomRules: z.boolean().optional(),
    engine: z.string().optional(),
    advisorRules: z.array(z.object({
        id: z.string(),
        action: z.enum(['suppress', 'override-severity', 'override-message']),
        match: z.object({
            code: z.union([z.string(), z.array(z.string())]).optional(),
            path: z.union([z.string(), z.array(z.string())]).optional(),
            message: z.string().optional(),
            aspect: z.union([z.string(), z.array(z.string())]).optional(),
            severity: z.string().optional(),
            profile: z.string().optional(),
            resourceType: z.union([z.string(), z.array(z.string())]).optional(),
        }),
        transform: z.object({
            severity: z.enum(['error', 'warning', 'information', 'info']).optional(),
            message: z.string().optional(),
        }).optional(),
        reason: z.string().optional(),
        enabled: z.boolean().optional(),
    })).optional(),
});

// ============================================================================
// Update Schema (Deep Partial)
// ============================================================================

/**
 * Deep partial of ValidationSettings for partial updates.
 * All fields are optional at every level.
 */
export const ValidationSettingsUpdateSchema = ValidationSettingsSchema.deepPartial();

// ============================================================================
// Type Exports (derived from schemas)
// ============================================================================

export type ValidationSettingsZod = z.infer<typeof ValidationSettingsSchema>;
export type ValidationSettingsUpdateZod = z.infer<typeof ValidationSettingsUpdateSchema>;
export type AdvancedTerminologyConfigZod = z.infer<typeof AdvancedTerminologyConfigSchema>;
export type TerminologyServerZod = z.infer<typeof TerminologyServerSchema>;

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Parse and validate a settings update payload.
 * Throws ZodError if validation fails.
 */
export function parseSettingsUpdate(data: unknown): ValidationSettingsUpdateZod {
    return ValidationSettingsUpdateSchema.parse(normalizeValidationSettings(data as Record<string, unknown>));
}

/**
 * Safe parse that returns success/error instead of throwing.
 */
export function safeParseSettingsUpdate(data: unknown) {
    return ValidationSettingsUpdateSchema.safeParse(normalizeValidationSettings(data as Record<string, unknown>));
}

/**
 * Check if an object has any valid settings fields.
 * Used to reject empty updates.
 */
export function hasValidSettingsFields(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    const result = ValidationSettingsUpdateSchema.safeParse(normalizeValidationSettings(data as Record<string, unknown>));
    if (!result.success) return false;
    // Check if at least one field was provided
    return Object.keys(result.data).length > 0;
}
