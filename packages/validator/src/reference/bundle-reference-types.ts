/**
 * Bundle Reference Resolver Types
 * 
 * Extracted from bundle-reference-resolver.ts for maintainability.
 */

// ============================================================================
// Bundle Entry Types
// ============================================================================

export interface BundleEntry {
    fullUrl?: string;
    resource?: any;
    request?: {
        method: string;
        url: string;
    };
    response?: {
        status: string;
        location?: string;
    };
}

// ============================================================================
// Resolution Types
// ============================================================================

export type ResolutionMethod = 'fullUrl' | 'uuid' | 'relative' | 'contained' | 'external';

export interface BundleReferenceResolutionResult {
    resolved: boolean;
    resource?: any;
    entry?: BundleEntry;
    errorMessage?: string;
    originalReference: string;
    resolutionMethod?: ResolutionMethod;
}

// ============================================================================
// Validation Types
// ============================================================================

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface BundleIssue {
    severity: IssueSeverity;
    code: string;
    message: string;
    entryIndex?: number;
    reference?: string;
}

export interface BundleValidationResult {
    isValid: boolean;
    issues: BundleIssue[];
    totalEntries: number;
    entriesWithIssues: number;
}

// ============================================================================
// Reference Types
// ============================================================================

export interface BundleReference {
    reference: string;
    entryIndex: number;
    fieldPath: string;
    sourceResourceType?: string;
}

export interface ResourceReference {
    reference: string;
    fieldPath: string;
}

// ============================================================================
// Statistics Types
// ============================================================================

export interface BundleStatistics {
    totalEntries: number;
    resourceTypes: Record<string, number>;
    hasFullUrls: number;
    hasUuidReferences: number;
    hasRelativeReferences: number;
    hasExternalReferences: number;
}
