/**
 * Security Validators for Metadata
 * 
 * Validates meta.security field:
 * - Coding structure validation
 * - System and code format
 * - Known FHIR security label systems
 * 
 * Refactored to use createValidationIssue factory.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { validateUriFormat } from './uri-validators';
import { logger } from '../logger';

// Common FHIR security label systems
const KNOWN_SYSTEMS: Record<string, { name: string; commonCodes: string[] }> = {
  'http://terminology.hl7.org/CodeSystem/v3-Confidentiality': {
    name: 'Confidentiality',
    commonCodes: ['U', 'L', 'M', 'N', 'R', 'V'],
  },
  'http://terminology.hl7.org/CodeSystem/v3-ActCode': {
    name: 'ActCode',
    commonCodes: ['ETHUD', 'GDIS', 'HIV', 'PSY', 'SCA', 'SDV', 'SEX', 'STD', 'TBOO'],
  },
  'http://terminology.hl7.org/CodeSystem/v3-ActReason': {
    name: 'ActReason',
    commonCodes: ['HTEST'],
  },
  'http://terminology.hl7.org/CodeSystem/v3-ObservationValue': {
    name: 'ObservationValue',
    commonCodes: ['ABSTRED', 'AGGRED', 'ANONYED', 'MAPPED', 'MASKED', 'PSEUDED', 'REDACTED', 'SUBSETTED', 'SYNTAC', 'TRSLT'],
  },
};

/**
 * Validates meta.security labels
 */
export class SecurityValidator {
  /**
   * Validate security labels
   */
  validate(security: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    try {
      if (!Array.isArray(security)) {
        issues.push(createValidationIssue({
          code: 'metadata-security-invalid-array',
          path: 'meta.security',
          resourceType,
          details: { actualValue: security },
        }));
        return issues;
      }

      security.forEach((label: any, index: number) => {
        const path = `meta.security[${index}]`;

        if (typeof label !== 'object' || Array.isArray(label)) {
          issues.push(createValidationIssue({
            code: 'metadata-security-invalid-object',
            path,
            resourceType,
            messageParams: { index },
          }));
          return;
        }

        if (!label.system) {
          issues.push(createValidationIssue({
            code: 'metadata-security-missing-system',
            path: `${path}.system`,
            resourceType,
            messageParams: { index },
          }));
        }

        if (!label.code) {
          issues.push(createValidationIssue({
            code: 'metadata-security-missing-code',
            path: `${path}.code`,
            resourceType,
            messageParams: { index },
          }));
        }

        // Validate system URI
        if (label.system && typeof label.system === 'string') {
          const systemValidation = validateUriFormat(label.system);
          if (!systemValidation.isValid) {
            issues.push(createValidationIssue({
              code: 'metadata-security-invalid-system',
              path: `${path}.system`,
              resourceType,
              messageParams: { value: label.system },
              details: { reason: systemValidation.reason },
            }));
          }
        }

        // Validate code type
        if (label.code && typeof label.code !== 'string') {
          issues.push(createValidationIssue({
            code: 'metadata-security-invalid-code-type',
            path: `${path}.code`,
            resourceType,
            messageParams: { index },
            details: { actualValue: label.code },
          }));
        }

        // Validate display type
        if (label.display && typeof label.display !== 'string') {
          issues.push(createValidationIssue({
            code: 'metadata-security-invalid-display-type',
            path: `${path}.display`,
            resourceType,
            messageParams: { index },
            details: { actualValue: label.display },
          }));
        }

        // Validate against known systems
        if (label.system && label.code) {
          issues.push(...this.validateKnownSecuritySystem(label.system, label.code, index, resourceType));
        }

        // Check for duplicates
        const duplicateIndex = security.findIndex((other: any, otherIndex: number) =>
          otherIndex > index && other.system === label.system && other.code === label.code
        );

        if (duplicateIndex !== -1) {
          issues.push(createValidationIssue({
            code: 'metadata-security-duplicate',
            path,
            resourceType,
            messageParams: { index, duplicateIndex },
            details: { system: label.system, code: label.code },
          }));
        }

        // Warn if display missing
        if (!label.display) {
          issues.push(createValidationIssue({
            code: 'metadata-security-missing-display',
            path,
            resourceType,
            messageParams: { index },
          }));
        }
      });

    } catch (error) {
      logger.error('[SecurityValidator] validation failed:', error);
    }

    return issues;
  }

  /**
   * Validate against known FHIR security label systems
   */
  private validateKnownSecuritySystem(
    system: string,
    code: string,
    index: number,
    resourceType: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const path = `meta.security[${index}]`;
    const systemInfo = KNOWN_SYSTEMS[system];

    if (systemInfo) {
      if (!systemInfo.commonCodes.includes(code)) {
        issues.push(createValidationIssue({
          code: 'metadata-security-unknown-code',
          path: `${path}.code`,
          resourceType,
          messageParams: { code, systemName: systemInfo.name },
          details: { system, code, commonCodes: systemInfo.commonCodes },
        }));
      }
    } else {
      issues.push(createValidationIssue({
        code: 'metadata-security-unknown-system',
        path: `${path}.system`,
        resourceType,
        messageParams: { system },
      }));
    }

    return issues;
  }
}
