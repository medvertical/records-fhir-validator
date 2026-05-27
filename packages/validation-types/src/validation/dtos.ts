/**
 * Validation DTOs and Utility Functions
 * 
 * Data Transfer Objects for validation messages, results, and groups.
 * Also contains utility functions for scoring and path normalization.
 *
 * Migrated from shared/validation-types.ts for better organization.
 */

import type { ValidationAspectType, ValidationSeverityType } from './aspect-enums';

// ============================================================================
// Message Signature Types
// ============================================================================

/**
 * Message signature components for grouping identical messages
 */
export interface MessageSignatureComponents {
    aspect: ValidationAspectType;
    severity: ValidationSeverityType;
    code?: string;
    canonicalPath: string; // Normalized path (no array indices)
    ruleId?: string;
    normalizedText: string; // Normalized message text
}

/**
 * Result of signature computation
 */
export interface MessageSignatureResult {
    signature: string; // SHA-256 hash (hex)
    signatureVersion: number;
    components: MessageSignatureComponents;
    pathTruncated: boolean;
    textTruncated: boolean;
}

// ============================================================================
// Validation Message Types
// ============================================================================

/**
 * Raw validation message (before normalization)
 */
export interface RawValidationMessage {
    severity: 'error' | 'warning' | 'information';
    code?: string;
    path: string; // Original FHIR path (may include array indices)
    text: string; // Original message text
    ruleId?: string;
    expression?: string; // FHIRPath expression
}

/**
 * Normalized validation message (ready for storage)
 */
export interface NormalizedValidationMessage extends RawValidationMessage {
    canonicalPath: string; // Normalized path
    normalizedText: string; // Normalized text
    signature: string; // SHA-256 hash
    signatureVersion: number;
    pathTruncated: boolean;
    textTruncated: boolean;
}

// ============================================================================
// Per-Aspect Result DTOs
// ============================================================================

/**
 * Per-aspect validation result DTO
 */
export interface ValidationResultPerAspectDTO {
    serverId: number;
    resourceType: string;
    fhirId: string;
    aspect: ValidationAspectType;
    isValid: boolean;
    errorCount: number;
    warningCount: number;
    informationCount: number;
    score: number;
    settingsSnapshotHash: string;
    validatedAt: Date;
    durationMs?: number;
    messages: NormalizedValidationMessage[];
}

/**
 * Aggregated validation result for a resource across all aspects
 */
export interface AggregatedValidationResult {
    serverId: number;
    resourceType: string;
    fhirId: string;
    settingsSnapshotHash: string;
    validatedAt: Date;

    // Per-aspect results
    aspects: {
        [K in ValidationAspectType]?: {
            enabled: boolean;
            isValid: boolean;
            errorCount: number;
            warningCount: number;
            informationCount: number;
            score: number;
            validatedAt?: Date;
        };
    };

    // Aggregated scores
    overallScore: number; // Average of enabled aspects
    coverage: number; // Percentage of enabled aspects that have been validated

    // Aggregated counts (across enabled aspects)
    totalErrors: number;
    totalWarnings: number;
    totalInformation: number;
}

// ============================================================================
// Group and Message DTOs
// ============================================================================

/**
 * Validation message group DTO (for groups API)
 */
export interface ValidationMessageGroupDTO {
    signature: string;
    aspect: ValidationAspectType;
    severity: ValidationSeverityType;
    code?: string;
    canonicalPath: string;
    sampleMessage: string; // First message text
    totalResources: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    // Smart value display fields
    uniqueValueCount?: number; // Count of distinct detail values (1 = uniform, >1 = varied)
    sampleDetails?: Record<string, unknown>; // Sample details for interpolation when uniform
    // Context fields for resource links
    serverId?: number; // Server ID (for single-server queries, or first seen for multi-server)
    resourceType?: string; // Primary resource type for this issue group
    resourceTypeCounts?: Record<string, number>; // Per-type resource counts (e.g. { Patient: 5, Encounter: 3 })
    validationRulesetVersion?: string; // Ruleset version observed for the affected resource/aspect results
}

/**
 * Group members DTO (for group members API)
 */
export interface ValidationGroupMemberDTO {
    resourceType: string;
    fhirId: string;
    validatedAt: Date;
    perAspect: {
        aspect: ValidationAspectType;
        isValid: boolean;
        errorCount: number;
        warningCount: number;
        informationCount: number;
    }[];
}

/**
 * Resource messages DTO (for resource messages API)
 */
export interface ResourceMessagesDTO {
    serverId: number;
    resourceType: string;
    fhirId: string;
    aspects: {
        aspect: ValidationAspectType;
        messages: {
            id: number;
            severity: ValidationSeverityType;
            code?: string;
            canonicalPath: string;
            path: string; // Original path
            text: string;
            signature: string;
            createdAt: Date;
            validationRulesetVersion?: string;
        }[];
    }[];
}

// ============================================================================
// Settings Snapshot
// ============================================================================

/**
 * Settings snapshot for validation (canonical format)
 */
export interface ValidationSettingsSnapshot {
    [key: string]: any; // Allow additional settings
    aspects: {
        structural: { enabled: boolean; severity: 'inherit' | 'error' | 'warning' | 'information'; timeoutMs: number; engine?: string };
        profile: { enabled: boolean; severity: 'inherit' | 'warning' | 'information'; timeoutMs: number; engine?: string };
        terminology: { enabled: boolean; severity: 'inherit' | 'warning' | 'information'; timeoutMs: number; engine?: string };
        reference: { enabled: boolean; severity: 'inherit' | 'error' | 'warning' | 'information'; timeoutMs: number; engine?: string };
        invariant: { enabled: boolean; severity: 'inherit' | 'error' | 'warning' | 'information'; timeoutMs: number; engine?: string };
        custom_rule: { enabled: boolean; severity: 'inherit' | 'error' | 'warning' | 'information'; timeoutMs: number; engine?: string };
        metadata: { enabled: boolean; severity: 'inherit' | 'error' | 'warning' | 'information'; timeoutMs: number; engine?: string };
        anomaly: { enabled: boolean; severity: 'inherit' | 'error' | 'warning' | 'information'; timeoutMs: number; engine?: string };
    };
    // Additional settings
    validationStrictness?: 'compatibility' | 'standard' | 'strict';
    validateExternalReferences?: boolean;
    hapiConfig?: {
        enabled: boolean;
        timeout?: number;
    };
}

// ============================================================================
// Scoring Utility Functions
// ============================================================================

/**
 * Scoring utility function
 * Shared between list and detail views for parity
 */
export function computeValidationScore(
    isValid: boolean,
    errorCount: number,
    warningCount: number,
    _informationCount: number
): number {
    if (isValid && errorCount === 0 && warningCount === 0) {
        return 100;
    }

    // Errors zero the score
    if (errorCount > 0) {
        return 0;
    }

    // Warnings reduce score (max 50% reduction)
    const warningPenalty = Math.min(50, warningCount * 10);
    return Math.max(0, 100 - warningPenalty);
}

/**
 * Aggregate scores across aspects
 * Used for overall resource score
 */
export function aggregateAspectScores(
    aspectResults: Array<{ enabled: boolean; score: number; validated: boolean }>
): { overallScore: number; coverage: number } {
    const enabledAspects = aspectResults.filter(a => a.enabled);
    const validatedEnabledAspects = enabledAspects.filter(a => a.validated);

    if (enabledAspects.length === 0) {
        return { overallScore: 0, coverage: 0 };
    }

    const coverage = (validatedEnabledAspects.length / enabledAspects.length) * 100;

    if (validatedEnabledAspects.length === 0) {
        return { overallScore: 0, coverage: 0 };
    }

    const totalScore = validatedEnabledAspects.reduce((sum, a) => sum + a.score, 0);
    const overallScore = Math.round(totalScore / validatedEnabledAspects.length);

    return { overallScore, coverage };
}

// ============================================================================
// Path and Text Normalization
// ============================================================================

/**
 * Normalize FHIR path for signature computation
 * Removes array indices: entry[3].item[0].code -> entry.item.code
 */
export function normalizeCanonicalPath(path: string, maxLength: number = 256): { normalized: string; truncated: boolean } {
    let normalized = path
        // Remove array indices
        .replace(/\[\d+\]/g, '')
        // Remove multiple dots
        .replace(/\.{2,}/g, '.')
        // Remove leading/trailing dots
        .replace(/^\.+|\.+$/g, '')
        // Lowercase
        .toLowerCase()
        // Remove whitespace
        .replace(/\s+/g, '');

    const truncated = normalized.length > maxLength;
    if (truncated) {
        normalized = normalized.substring(0, maxLength);
    }

    return { normalized, truncated };
}

/**
 * Normalize message text for signature computation
 * Trim, collapse whitespace, lowercase, remove control chars
 */
export function normalizeMessageText(text: string, maxLength: number = 512): { normalized: string; truncated: boolean } {
    let normalized = text
        // Trim
        .trim()
        // Collapse whitespace
        .replace(/\s+/g, ' ')
        // Lowercase
        .toLowerCase()
        // Remove control characters (excluding common whitespace)
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F]/g, '');

    const truncated = normalized.length > maxLength;
    if (truncated) {
        normalized = normalized.substring(0, maxLength);
    }

    return { normalized, truncated };
}
