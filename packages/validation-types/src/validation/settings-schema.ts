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
import { normalizeValidationSettings } from './aspect-aliases.js';
import {
    AdvisorRuleSchema,
    CacheConfigSchema,
    FHIRVersionSchema,
    HapiConfigSchema,
    ImposedProfilesConfigSchema,
    PackageDownloadConfigSchema,
    ProfileSourcesConfigSchema,
    RecursiveReferenceValidationSchema,
    ValidationAspectConfigSchema,
    ValidationStrictnessSchema,
} from './settings-core-schema.js';
export * from './settings-core-schema.js';
import {
    AdvancedTerminologyConfigSchema,
    CircuitBreakerConfigSchema,
    MiiValidationSettingsSchema,
    TerminologyResolutionSchema,
    TerminologyServerSchema,
} from './settings-terminology-schema.js';
export {
    AdvancedTerminologyConfigSchema,
    CircuitBreakerConfigSchema,
    MiiTerminologyModeSchema,
    MiiValidationSettingsSchema,
    ServerStatusSchema,
    TerminologyAuthConfigSchema,
    TerminologyResolutionSchema,
    TerminologyServerSchema,
} from './settings-terminology-schema.js';

// ============================================================================
// Main ValidationSettings Schema
// ============================================================================

const ValidationSettingsObjectSchema = z.object({
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
    }).strict(),

    // Resource type filtering
    resourceTypes: z.object({
        enabled: z.boolean(),
        includedTypes: z.array(z.string()),
        excludedTypes: z.array(z.string()),
        fhirVersion: FHIRVersionSchema.optional(),
    }).strict(),
    fhirVersion: FHIRVersionSchema.optional(),

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
    imposedProfiles: ImposedProfilesConfigSchema.optional(),
    advancedTerminology: AdvancedTerminologyConfigSchema.optional(),
    packageDownload: PackageDownloadConfigSchema.optional(),
    autoRevalidateAfterEdit: z.boolean().optional(),
    autoRevalidateOnVersionChange: z.boolean().optional(),
    listViewPollingInterval: z.number().optional(),
    enableBestPracticeChecks: z.boolean().optional(),
    bestPracticeSeverity: z.enum(['warning', 'info']).optional(),
    // FHIR IG-Publisher "for-publication" mode: escalate surviving warnings to
    // errors (and best-practice hints to warnings) so a published IG is clean.
    // Applied after strictness + advisor rules — see publication-escalation.ts.
    forPublication: z.boolean().optional(),
    validationStrictness: ValidationStrictnessSchema.optional(),
    recursiveReferenceValidation: RecursiveReferenceValidationSchema.optional(),
    cacheConfig: CacheConfigSchema.optional(),
    caching: z.object({
        enableFilesystemCache: z.boolean().optional(),
        filesystemCacheDirectory: z.string().min(1).optional(),
    }).strict().optional(),
    hapiConfig: HapiConfigSchema.optional(),
    autoApplyCustomRules: z.boolean().optional(),
    engine: z.string().optional(),
    excludedPaths: z.array(z.string()).optional(),
    advisorRules: z.array(AdvisorRuleSchema).optional(),
}).strict();

export const ValidationSettingsSchema = ValidationSettingsObjectSchema.superRefine((settings, context) => {
    const includedTypes = settings.resourceTypes.includedTypes;
    const excludedTypes = new Set(settings.resourceTypes.excludedTypes);
    const conflicts = includedTypes.filter(resourceType => excludedTypes.has(resourceType));
    if (conflicts.length > 0) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['resourceTypes'],
            message: `Resource types cannot be both included and excluded: ${conflicts.join(', ')}`,
        });
    }

    if (new Set(includedTypes).size !== includedTypes.length) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['resourceTypes', 'includedTypes'],
            message: 'Included resource types must not contain duplicates',
        });
    }
    if (excludedTypes.size !== settings.resourceTypes.excludedTypes.length) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['resourceTypes', 'excludedTypes'],
            message: 'Excluded resource types must not contain duplicates',
        });
    }

    if (!Object.values(settings.aspects).some(aspect => aspect.enabled)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['aspects'],
            message: 'At least one validation aspect must be enabled',
        });
    }
});

// ============================================================================
// Update Schema (Deep Partial)
// ============================================================================

/**
 * Deep partial of ValidationSettings for partial updates.
 * All fields are optional at every level.
 */
export const ValidationSettingsUpdateSchema = ValidationSettingsObjectSchema.deepPartial().extend({
    terminologyServers: z.array(TerminologyServerSchema).optional(),
    circuitBreaker: CircuitBreakerConfigSchema.optional(),
    profileSources: ProfileSourcesConfigSchema.optional(),
    imposedProfiles: ImposedProfilesConfigSchema.partial().optional(),
    advisorRules: z.array(AdvisorRuleSchema).optional(),
}).strict();

// ============================================================================
// Type Exports (derived from schemas)
// ============================================================================

export type ValidationSettingsZod = z.infer<typeof ValidationSettingsSchema>;
export type ValidationSettingsUpdateZod = z.infer<typeof ValidationSettingsUpdateSchema>;
export type ValidationAspectConfigZod = z.infer<typeof ValidationAspectConfigSchema>;
export type ProfileSourcesConfigZod = z.infer<typeof ProfileSourcesConfigSchema>;
export type AdvancedTerminologyConfigZod = z.infer<typeof AdvancedTerminologyConfigSchema>;
export type TerminologyServerZod = z.infer<typeof TerminologyServerSchema>;

// ============================================================================
// Validation Utilities
// ============================================================================

export function parseSettings(data: unknown): ValidationSettingsZod {
    return ValidationSettingsSchema.parse(normalizeValidationSettings(data as Record<string, unknown>));
}

export function safeParseSettings(data: unknown) {
    return ValidationSettingsSchema.safeParse(normalizeValidationSettings(data as Record<string, unknown>));
}

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
