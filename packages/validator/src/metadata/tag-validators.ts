/**
 * Tag Validators for Metadata
 * 
 * Validates meta.tag field:
 * - Coding structure validation
 * - System, code, and display consistency
 * - Duplicate detection
 * 
 * Refactored to use createValidationIssue factory.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import { isObjectRecord } from './metadata-boundary-utils.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

/**
 * Validates meta.tag labels
 */
export class TagValidator {
  /**
   * Validate tags
   */
  validate(tags: unknown, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    try {
      if (!Array.isArray(tags)) {
        issues.push(createValidationIssue({
          code: 'metadata-tag-invalid-array',
          path: 'meta.tag',
          resourceType,
          details: { actualValue: tags },
        }));
        return issues;
      }

      tags.forEach((tag: unknown, index: number) => {
        const path = `meta.tag[${index}]`;

        if (!isObjectRecord(tag)) {
          issues.push(createValidationIssue({
            code: 'metadata-tag-invalid-object',
            path,
            resourceType,
            messageParams: { index },
          }));
          return;
        }

        // Validate Coding structure
        if (!tag.system && !tag.code) {
          issues.push(createValidationIssue({
            code: 'metadata-tag-missing-system-code',
            path,
            resourceType,
            messageParams: { index },
          }));
        }

        // Validate system
        if (tag.system) {
          if (typeof tag.system !== 'string') {
            issues.push(createValidationIssue({
              code: 'metadata-tag-invalid-system-type',
              path: `${path}.system`,
              resourceType,
              messageParams: { index },
              details: { actualValue: tag.system },
            }));
          } else {
            // Coding.system is a FHIR `uri`, which permits relative URI
            // references. Reject whitespace (invalid in a URI) but do not
            // require an absolute URL here; Identifier.system has the stricter
            // absolute-reference rule and is validated separately.
            if (/\s/.test(tag.system)) {
              issues.push(createValidationIssue({
                code: 'metadata-tag-invalid-system-uri',
                path: `${path}.system`,
                resourceType,
                messageParams: { system: tag.system },
                details: { reason: 'URI must not contain whitespace' },
              }));
            }
          }
        }

        // Validate code type
        if (tag.code && typeof tag.code !== 'string') {
          issues.push(createValidationIssue({
            code: 'metadata-tag-invalid-code-type',
            path: `${path}.code`,
            resourceType,
            messageParams: { index },
            details: { actualValue: tag.code },
          }));
        }

        // Validate display type
        if (tag.display && typeof tag.display !== 'string') {
          issues.push(createValidationIssue({
            code: 'metadata-tag-invalid-display-type',
            path: `${path}.display`,
            resourceType,
            messageParams: { index },
            details: { actualValue: tag.display },
          }));
        }

        // Check consistency
        if (
          typeof tag.system === 'string' &&
          typeof tag.code === 'string' &&
          typeof tag.display === 'string'
        ) {
          issues.push(...this.validateTagConsistency({
            system: tag.system,
            code: tag.code,
            display: tag.display,
          }, index, resourceType));
        }

        // Warn if code without system
        if (tag.code && !tag.system) {
          issues.push(createValidationIssue({
            code: 'metadata-tag-code-without-system',
            path,
            resourceType,
            messageParams: { index, code: tag.code },
          }));
        }

        // Note: We don't warn about missing display since it's optional per FHIR spec.
        // The Coding.display field is 0..1 cardinality.

        // Check for duplicates
        const duplicateIndex = tags.findIndex((otherTag: unknown, otherIndex: number) =>
          otherIndex > index &&
          isObjectRecord(otherTag) &&
          otherTag.system === tag.system &&
          otherTag.code === tag.code
        );

        if (duplicateIndex !== -1) {
          issues.push(createValidationIssue({
            code: 'metadata-tag-duplicate',
            path,
            resourceType,
            messageParams: { index, duplicateIndex },
            details: { system: tag.system, code: tag.code },
          }));
        }
      });

    } catch (error) {
      logger.error('[TagValidator] validation failed', validationFailureMetadata(error));
    }

    return issues;
  }

  /**
   * Validate tag consistency
   */
  private validateTagConsistency(
    tag: { system: string; code: string; display: string },
    index: number,
    resourceType: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const path = `meta.tag[${index}]`;

    try {
      // Check if display is too short
      if (tag.display && tag.display.length < 2) {
        issues.push(createValidationIssue({
          code: 'metadata-tag-short-display',
          path: `${path}.display`,
          resourceType,
          messageParams: { index, value: tag.display },
          details: { actualLength: tag.display.length },
        }));
      }

      // Check if code and display are identical
      if (
        tag.code &&
        typeof tag.display === 'string' &&
        tag.code === tag.display.toUpperCase() &&
        tag.display === tag.code
      ) {
        issues.push(createValidationIssue({
          code: 'metadata-tag-code-as-display',
          path: `${path}.display`,
          resourceType,
          messageParams: { index },
          details: { code: tag.code, display: tag.display },
        }));
      }

      // Check if display is excessively long
      if (tag.display && tag.display.length > 200) {
        issues.push(createValidationIssue({
          code: 'metadata-tag-long-display',
          path: `${path}.display`,
          resourceType,
          messageParams: { index, length: tag.display.length },
          details: { actualLength: tag.display.length, recommendedMaxLength: 200 },
        }));
      }

    } catch (error) {
      logger.error('[TagValidator] consistency check failed', validationFailureMetadata(error));
    }

    return issues;
  }
}
