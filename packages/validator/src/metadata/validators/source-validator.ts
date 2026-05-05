/**
 * Source Validator
 * 
 * Validates meta.source field (URI format).
 * Refactored to use createValidationIssue factory for consistent issue creation.
 */

import type { ValidationIssue } from '../../types';
import { createValidationIssue } from '../../issues';
import { validateUriFormat } from '../uri-validators';
import { logger } from '../../logger';

const PATH = 'meta.source';

/**
 * Validates meta.source field (URI format)
 */
export class SourceValidator {
  /**
   * Validate source URI format
   */
  validate(source: string, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    try {
      // Check if source is a string
      if (typeof source !== 'string') {
        issues.push(createValidationIssue({
          code: 'metadata-source-invalid-type',
          path: PATH,
          resourceType,
          messageParams: { value: source },
          details: { actualValue: source, expectedType: 'string' },
        }));
        return issues;
      }

      // Check if source is empty
      if (!source || source.trim() === '') {
        issues.push(createValidationIssue({
          code: 'metadata-source-empty',
          path: PATH,
          resourceType,
        }));
        return issues;
      }

      // Check for excessive length
      if (source.length > 2000) {
        issues.push(createValidationIssue({
          code: 'metadata-source-too-long',
          path: PATH,
          resourceType,
          messageParams: { length: source.length },
          details: { actualLength: source.length, recommendedMax: 2000 },
        }));
      }

      // Check for whitespace (invalid in URI)
      if (/\s/.test(source)) {
        issues.push(createValidationIssue({
          code: 'metadata-source-invalid-format',
          path: PATH,
          resourceType,
          messageParams: { value: source },
          details: { reason: 'contains-whitespace' },
        }));
      }

      // Validate URI format
      const uriValidation = validateUriFormat(source);
      if (!uriValidation.isValid) {
        issues.push(createValidationIssue({
          code: 'metadata-source-invalid-format',
          path: PATH,
          resourceType,
          messageParams: { value: source, reason: uriValidation.reason },
          details: { reason: uriValidation.reason, uriType: uriValidation.type },
        }));
      }

      // Warn about localhost references
      if (source.includes('localhost') || source.includes('127.0.0.1')) {
        issues.push(createValidationIssue({
          code: 'metadata-source-localhost',
          path: PATH,
          resourceType,
          messageParams: { value: source },
          details: { reason: 'localhost-reference' },
        }));
      }

      // Warn about local network IP references
      const localIpPattern = /\b(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
      if (localIpPattern.test(source)) {
        issues.push(createValidationIssue({
          code: 'metadata-source-localhost',
          path: PATH,
          resourceType,
          messageParams: { value: source },
          details: { reason: 'local-network-ip' },
        }));
      }

      // Check if source looks like a FHIR reference
      const referencePattern = /^[A-Z][a-z]+\/[A-Za-z0-9\-\.]+$/;
      if (referencePattern.test(source)) {
        issues.push(createValidationIssue({
          code: 'metadata-source-looks-like-reference',
          path: PATH,
          resourceType,
          messageParams: { value: source },
        }));
      }

      // Recommend absolute URIs
      if (uriValidation.type === 'relative' || uriValidation.type === 'unknown') {
        issues.push(createValidationIssue({
          code: 'metadata-source-relative-uri',
          path: PATH,
          resourceType,
          messageParams: { value: source },
          details: { uriType: uriValidation.type },
        }));
      }

    } catch (error) {
      logger.error('[SourceValidator] validation failed:', error);
      issues.push(createValidationIssue({
        code: 'metadata-source-validation-error',
        path: PATH,
        resourceType,
        messageParams: { error: error instanceof Error ? error.message : 'Unknown error' },
      }));
    }

    return issues;
  }
}
