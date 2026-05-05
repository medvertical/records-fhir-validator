/**
 * R6 Limited Support Warnings
 * Task 2.10: Centralized warning generation for R6 limited support
 * 
 * R6 (FHIR 6.0.x-ballot) has partial support:
 * - ✅ Structure validation (JSON schema)
 * - ✅ Profile validation (limited, may have missing packages)
 * - ⚠️ Terminology validation (limited, ballot status)
 * - ⚠️ Reference validation (may have issues with new features)
 * 
 * This module provides consistent warning messages across all validators.
 */

import type { ValidationIssue } from '../types';

// Inlined from server/config/fhir-package-versions.ts during S-3
// engine-extraction. The engine only needs the support-status +
// limitations of each version family; the full server-side config
// (auto-download lists, terminology defaults, …) stays in the host.
interface VersionConfig {
    fhirVersion: 'R4' | 'R5' | 'R6';
    supportStatus: 'full' | 'partial' | 'experimental';
    limitations?: string[];
}

const VERSION_CONFIGURATIONS: Record<'R4' | 'R5' | 'R6', VersionConfig> = {
    R4: { fhirVersion: 'R4', supportStatus: 'full' },
    R5: { fhirVersion: 'R5', supportStatus: 'full' },
    R6: {
        fhirVersion: 'R6',
        supportStatus: 'partial',
        limitations: [
            'Terminology validation limited (ballot status)',
            'Some profile packages may not be available',
            'Reference validation may have issues with new features',
        ],
    },
};

function getVersionConfig(version: 'R4' | 'R5' | 'R6'): VersionConfig {
    return VERSION_CONFIGURATIONS[version];
}

/**
 * R6 warning types
 */
export type R6WarningType = 
  | 'general'           // General R6 limitation warning
  | 'terminology'       // Terminology validation limited
  | 'profile'           // Profile packages may be missing
  | 'reference';        // Reference validation may have issues

/**
 * Check if FHIR version is R6
 */
export function isR6(fhirVersion: string | undefined): boolean {
  return fhirVersion === 'R6';
}

/**
 * Generate R6 limited support warning
 * Task 2.10: Create warning issue for R6 limitations
 * 
 * @param aspect - Validation aspect
 * @param warningType - Type of R6 warning
 * @param additionalContext - Optional additional context
 * @returns ValidationIssue with R6 warning
 */
export function createR6Warning(
  aspect: 'structural' | 'profile' | 'terminology' | 'reference' | 'metadata' | 'businessRule',
  warningType: R6WarningType = 'general',
  additionalContext?: string
): ValidationIssue {
  const versionConfig = getVersionConfig('R6');
  const limitations = versionConfig.limitations || [];

  // Build warning message based on type
  let message: string;
  let code: string;

  switch (warningType) {
    case 'terminology':
      message = 'R6 terminology validation is limited (ballot status). Results may be incomplete or inaccurate.';
      code = 'r6-terminology-limited';
      if (limitations.length > 0) {
        message += ` Limitations: ${limitations[0]}`;
      }
      break;

    case 'profile':
      message = 'R6 profile validation has limited package availability. Some profiles may not be found.';
      code = 'r6-profile-limited';
      if (limitations.length > 1) {
        message += ` ${limitations[1]}`;
      }
      break;

    case 'reference':
      message = 'R6 reference validation may have issues with new FHIR R6 features.';
      code = 'r6-reference-limited';
      if (limitations.length > 2) {
        message += ` ${limitations[2]}`;
      }
      break;

    case 'general':
    default:
      message = `R6 (FHIR 6.0.x-ballot) has partial support. Validation results may be limited.`;
      code = 'r6-support-limited';
      if (limitations.length > 0) {
        message += ` Known limitations: ${limitations.join(', ')}`;
      }
      break;
  }

  // Add additional context if provided
  if (additionalContext) {
    message += ` ${additionalContext}`;
  }

  return {
    id: `r6-warning-${warningType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    aspect,
    severity: 'info',
    code,
    message,
    path: '',
    timestamp: new Date(),
  };
}

/**
 * Check if R6 warning should be added for a validation aspect
 * Task 2.10: Determine if R6 warning is needed
 * 
 * @param fhirVersion - FHIR version
 * @param aspect - Validation aspect
 * @returns true if R6 warning should be added
 */
export function shouldAddR6Warning(
  fhirVersion: string | undefined,
  aspect: 'structural' | 'profile' | 'terminology' | 'reference' | 'metadata' | 'businessRule'
): boolean {
  if (!isR6(fhirVersion)) {
    return false;
  }

  // Add warnings for aspects with known limitations
  const aspectsWithWarnings: Set<string> = new Set([
    'terminology',  // Limited terminology support
    'profile',      // Limited profile package availability
    'reference',    // May have issues with new features
  ]);

  return aspectsWithWarnings.has(aspect);
}

/**
 * Add R6 warning to issues if needed
 * Task 2.10: Helper to add R6 warning to validation results
 * 
 * @param issues - Array of validation issues
 * @param fhirVersion - FHIR version
 * @param aspect - Validation aspect
 * @param warningType - Type of R6 warning
 * @returns Updated issues array with R6 warning if applicable
 */
export function addR6WarningIfNeeded(
  issues: ValidationIssue[],
  fhirVersion: string | undefined,
  aspect: 'structural' | 'profile' | 'terminology' | 'reference' | 'metadata' | 'businessRule',
  warningType?: R6WarningType
): ValidationIssue[] {
  if (!shouldAddR6Warning(fhirVersion, aspect)) {
    return issues;
  }

  // Determine warning type based on aspect if not provided
  const effectiveWarningType = warningType || (aspect as R6WarningType);

  // Check if R6 warning already exists
  const hasR6Warning = issues.some(issue => 
    issue.code?.startsWith('r6-') && issue.severity === 'info'
  );

  if (!hasR6Warning) {
    const warning = createR6Warning(aspect, effectiveWarningType);
    return [warning, ...issues];
  }

  return issues;
}

/**
 * Get R6 support status summary
 * Task 2.10: Provide R6 support information
 * 
 * @returns R6 support summary
 */
export function getR6SupportSummary(): {
  version: string;
  supportStatus: string;
  supportedAspects: string[];
  limitedAspects: string[];
  limitations: string[];
} {
  const config = getVersionConfig('R6');

  return {
    version: 'R6 (6.0.x-ballot)',
    supportStatus: config.supportStatus,
    supportedAspects: [
      'Structure validation (JSON schema)',
      'Profile validation (limited)',
    ],
    limitedAspects: [
      'Terminology validation (ballot status)',
      'Profile packages (may be missing)',
      'Reference validation (new features)',
    ],
    limitations: config.limitations || [],
  };
}

