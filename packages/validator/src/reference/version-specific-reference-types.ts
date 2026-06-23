/**
 * Version-Specific Reference Types
 *
 * Result and info types for validating references that include version
 * information (e.g., Patient/123/_history/2).
 */

// ============================================================================
// Types
// ============================================================================

export interface VersionedReferenceInfo {
  /** Original reference string */
  reference: string;
  /** Resource type */
  resourceType?: string;
  /** Resource ID */
  resourceId?: string;
  /** Version number */
  versionId?: string;
  /** Whether this is a versioned reference */
  isVersioned: boolean;
  /** Whether version format is valid */
  isValidVersionFormat: boolean;
}

export interface VersionIntegrityCheckResult {
  /** Whether the version reference is valid */
  isValid: boolean;
  /** Validation severity */
  severity: 'error' | 'warning' | 'info';
  /** Validation message */
  message: string;
  /** Version info */
  versionInfo?: VersionedReferenceInfo;
  /** Details */
  details?: any;
}

export interface VersionConsistencyCheckResult {
  /** Whether versions are consistent */
  isConsistent: boolean;
  /** Issues found */
  issues: Array<{
    reference1: string;
    reference2: string;
    issue: string;
    severity: 'error' | 'warning';
  }>;
}

export interface VersionAvailabilityCheckResult {
  /** Whether the versioned resource is available */
  isAvailable: boolean;
  /** HTTP status if checked */
  httpStatus?: number;
  /** Error message if unavailable */
  errorMessage?: string;
  /** Actual version found (if different) */
  actualVersion?: string;
}
