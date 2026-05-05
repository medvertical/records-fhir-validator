/**
 * Version ID Validator
 * 
 * Validates meta.versionId field format and consistency.
 * Refactored to use createValidationIssue factory for consistent issue creation.
 */

import type { ValidationIssue } from '../../types';
import { createValidationIssue } from '../../issues';
import { logger } from '../../logger';

const PATH = 'meta.versionId';

/**
 * Validates meta.versionId field format and consistency
 */
export class VersionIdValidator {
  /**
   * Validate versionId format
   */
  validateFormat(versionId: string, resourceType: string, profileUrl?: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    try {
      // Check if versionId is a string
      if (typeof versionId !== 'string') {
        issues.push(createValidationIssue({
          code: 'metadata-version-id-invalid-type',
          path: PATH,
          resourceType,
          profile: profileUrl,
          messageParams: { value: versionId },
          details: { actualValue: versionId, expectedType: 'string' },
        }));
        return issues;
      }

      // Check if versionId is empty
      if (!versionId || versionId.trim() === '') {
        issues.push(createValidationIssue({
          code: 'metadata-version-id-empty',
          path: PATH,
          resourceType,
          profile: profileUrl,
        }));
        return issues;
      }

      // Validate FHIR id type pattern
      const fhirIdPattern = /^[A-Za-z0-9\-\.]{1,64}$/;
      if (!fhirIdPattern.test(versionId)) {
        issues.push(createValidationIssue({
          code: 'metadata-version-id-invalid-format',
          path: PATH,
          resourceType,
          profile: profileUrl,
          messageParams: { value: versionId },
          details: {
            actualValue: versionId,
            actualLength: versionId.length,
            maxLength: 64
          },
        }));
      }

      // Warn if versionId looks like a timestamp
      if (/^\d{13,}$/.test(versionId)) {
        issues.push(createValidationIssue({
          code: 'metadata-version-id-timestamp-pattern',
          path: PATH,
          resourceType,
          profile: profileUrl,
          messageParams: { value: versionId },
        }));
      }

      // Check numeric versionId is positive
      if (/^\d+$/.test(versionId)) {
        const numericVersion = parseInt(versionId, 10);
        if (numericVersion <= 0) {
          issues.push(createValidationIssue({
            code: 'metadata-version-id-non-positive',
            path: PATH,
            resourceType,
            profile: profileUrl,
            messageParams: { value: versionId },
            details: { numericValue: numericVersion },
          }));
        }
      }

      // Warn if only special characters
      if (/^[\-\.]+$/.test(versionId)) {
        issues.push(createValidationIssue({
          code: 'metadata-version-id-special-chars-only',
          path: PATH,
          resourceType,
          profile: profileUrl,
          messageParams: { value: versionId },
        }));
      }

      // Note: We don't warn about "long" versionIds (e.g., UUIDs at 36 chars)
      // because UUIDs are standard practice. The FHIR 64-char limit is already
      // enforced by the fhirIdPattern regex above.

      // Warn if ETag format
      if (versionId.startsWith('"') || versionId.startsWith('W/"')) {
        issues.push(createValidationIssue({
          code: 'metadata-version-id-etag-format',
          path: PATH,
          resourceType,
          profile: profileUrl,
          messageParams: { value: versionId },
        }));
      }

    } catch (error) {
      logger.error('[VersionIdValidator] format validation failed:', error);
      issues.push(createValidationIssue({
        code: 'metadata-version-id-validation-error',
        path: PATH,
        resourceType,
        profile: profileUrl,
        messageParams: { error: error instanceof Error ? error.message : 'Unknown error' },
      }));
    }

    return issues;
  }

  /**
   * Validate versionId consistency with resource
   */
  validateConsistency(resource: any, resourceType: string, profileUrl?: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    try {
      const versionId = resource.meta?.versionId;
      if (!versionId) return issues;

      // Check versionId != resource.id
      if (resource.id && versionId === resource.id) {
        issues.push(createValidationIssue({
          code: 'metadata-version-id-same-as-id',
          path: PATH,
          resourceType,
          profile: profileUrl,
          details: { versionId, resourceId: resource.id },
        }));
      }

      // Check for very high version numbers
      if (/^\d+$/.test(versionId) && resource.meta?.lastUpdated) {
        const numericVersion = parseInt(versionId, 10);
        if (numericVersion > 10000) {
          issues.push(createValidationIssue({
            code: 'metadata-version-id-very-high',
            path: PATH,
            resourceType,
            profile: profileUrl,
            messageParams: { value: versionId },
            details: { numericValue: numericVersion, threshold: 10000 },
          }));
        }
      }

    } catch (error) {
      logger.error('[VersionIdValidator] consistency check failed:', error);
    }

    return issues;
  }
}
