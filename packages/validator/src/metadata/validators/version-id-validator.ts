/**
 * Version ID Validator
 * 
 * Validates meta.versionId field format and consistency.
 * Refactored to use createValidationIssue factory for consistent issue creation.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../../issues/index.js';
import { logger } from '../../logger.js';
import { validationFailureMetadata } from '../../utils/validation-execution-failure.js';

const PATH = 'meta.versionId';

/**
 * Validates meta.versionId field format and consistency
 */
export class VersionIdValidator {
  /**
   * Validate versionId format
   */
  validateFormat(versionId: unknown, resourceType: string, profileUrl?: string): ValidationIssue[] {
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
      const fhirIdPattern = /^[A-Za-z0-9.-]{1,64}$/;
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
      if (/^[-.]+$/.test(versionId)) {
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
      logger.error('[VersionIdValidator] format validation failed', validationFailureMetadata(error));
      issues.push(createValidationIssue({
        code: 'metadata-version-id-validation-error',
        path: PATH,
        resourceType,
        profile: profileUrl,
        messageParams: { error: 'Operational validation failure' },
        details: validationFailureMetadata(error),
      }));
    }

    return issues;
  }

  /**
   * Validate versionId consistency with resource
   */
  validateConsistency(resource: unknown, resourceType: string, profileUrl?: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    try {
      if (typeof resource !== 'object' || resource === null || Array.isArray(resource)) {
        return issues;
      }
      const resourceRecord = resource as Record<string, unknown>;
      const meta = resourceRecord.meta;
      if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
        return issues;
      }
      const metaRecord = meta as Record<string, unknown>;
      const versionId = metaRecord.versionId;
      if (typeof versionId !== 'string' || versionId.length === 0) return issues;

      // Check versionId != resource.id
      if (typeof resourceRecord.id === 'string' && versionId === resourceRecord.id) {
        issues.push(createValidationIssue({
          code: 'metadata-version-id-same-as-id',
          path: PATH,
          resourceType,
          profile: profileUrl,
          details: { versionId, resourceId: resourceRecord.id },
        }));
      }

      // Check for very high version numbers
      if (/^\d+$/.test(versionId) && metaRecord.lastUpdated) {
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
      logger.error(
        '[VersionIdValidator] consistency check failed',
        validationFailureMetadata(error),
      );
    }

    return issues;
  }
}
