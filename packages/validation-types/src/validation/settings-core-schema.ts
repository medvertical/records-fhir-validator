import { z } from 'zod';

export const ValidationAspectSchema = z.enum([
    'structural', 'profile', 'terminology', 'reference', 'invariant', 'custom_rule', 'metadata', 'anomaly'
]);

export const ValidationSeveritySchema = z.enum([
    'fatal', 'error', 'warning', 'information', 'info', 'inherit'
]);

export const ValidationStrictnessSchema = z.enum([
    'compatibility', 'standard', 'strict'
]);

export const FHIRVersionSchema = z.enum(['R4', 'R5', 'R6']);

export const StructuralValidationEngineSchema = z.enum(['records', 'schema', 'hapi', 'server']);
export const ProfileValidationEngineSchema = z.enum(['records', 'hapi', 'server', 'auto']);
export const TerminologyValidationEngineSchema = z.enum(['records', 'server', 'terminology-servers', 'cached', 'hapi']);
export const ReferenceValidationEngineSchema = z.enum(['records', 'internal', 'server']);
export const InvariantValidationEngineSchema = z.enum(['fhirpath', 'hapi']);
export const CustomRuleValidationEngineSchema = z.enum(['fhirpath', 'custom']);
export const MetadataValidationEngineSchema = z.enum(['records', 'schema', 'hapi']);

export const ValidationAspectConfigSchema = z.object({
    enabled: z.boolean(),
    severity: ValidationSeveritySchema,
    engine: z.string().optional(),
});

export const ProfileSourcesConfigSchema = z.object({
    simplifier: z.boolean(),
    packageRegistry: z.boolean(),
});

export const DEFAULT_PROFILE_SOURCES_CONFIG = {
    simplifier: true,
    packageRegistry: true,
} satisfies z.infer<typeof ProfileSourcesConfigSchema>;

export function normalizeProfileSourcesConfig(value: unknown): z.infer<typeof ProfileSourcesConfigSchema> {
    const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
    return {
        simplifier: typeof source.simplifier === 'boolean'
            ? source.simplifier
            : DEFAULT_PROFILE_SOURCES_CONFIG.simplifier,
        packageRegistry: typeof source.packageRegistry === 'boolean'
            ? source.packageRegistry
            : DEFAULT_PROFILE_SOURCES_CONFIG.packageRegistry,
    };
}

export const PackageDownloadConfigSchema = z.object({
    versionPolicy: z.enum(['prefer-stable', 'prefer-latest']),
    pinnedVersions: z.record(z.string(), z.string()),
    approvedPackages: z.array(z.string()),
    // Legacy evidence field; automatic downloads are governed by the allowlist and network policy.
    requireApproval: z.boolean(),
    autoDownload: z.boolean(),
    workspaceTemplates: z.array(z.object({
        id: z.string().min(1).max(80),
        revision: z.string().min(1).max(80),
        modules: z.array(z.string().max(80)).max(32),
        packages: z.record(z.string(), z.string()),
    })).max(32).optional(),
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
    validateTargetProfiles: z.boolean().optional(),
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
    priority: z.number().int().min(0).max(100).optional(),
});

export const ImposedProfilePolicySchema = z.object({
    id: z.string().optional(),
    enabled: z.boolean().optional(),
    resourceType: z.string().min(1),
    profileUrl: z.string().min(1),
    label: z.string().optional(),
    packageId: z.string().optional(),
    packageVersion: z.string().optional(),
    reason: z.string().optional(),
});

export const ImposedProfilesConfigSchema = z.object({
    enabled: z.boolean(),
    policies: z.array(ImposedProfilePolicySchema),
});

export const AdvisorRuleSchema = z.object({
    id: z.string(),
    action: z.enum(['suppress', 'override-severity', 'override-message']),
    match: z.object({
        code: z.union([z.string(), z.array(z.string())]).optional(),
        path: z.union([z.string(), z.array(z.string())]).optional(),
        message: z.string().optional(),
        messageRegex: z.union([z.string(), z.array(z.string())]).optional(),
        aspect: z.union([z.string(), z.array(z.string())]).optional(),
        severity: z.union([z.string(), z.array(z.string())]).optional(),
        profile: z.union([z.string(), z.array(z.string())]).optional(),
        ruleId: z.union([z.string(), z.array(z.string())]).optional(),
        resourceType: z.union([z.string(), z.array(z.string())]).optional(),
    }),
    transform: z.object({
        severity: z.enum(['error', 'warning', 'information', 'info']).optional(),
        message: z.string().optional(),
    }).optional(),
    reason: z.string().optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(-10000).max(10000).optional(),
    expiresAt: z.string().datetime().optional(),
    origin: z.enum(['builtin', 'local', 'pack']).optional(),
    sourcePackRef: z.string().max(193).optional(),
});
