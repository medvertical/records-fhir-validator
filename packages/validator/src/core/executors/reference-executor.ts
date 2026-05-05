/**
 * Reference Executor
 * 
 * Validates resource references:
 * - Reference resolution
 * - Contained resource validation
 * - Bundle reference validation
 * - Reference integrity checking
 */

import type { ValidationIssue, ValidationSettings } from '../../types';
import { ReferenceValidator } from '../../reference';
import { logger } from '../../logger';

// ============================================================================
// Types
// ============================================================================

export interface ReferenceValidationContext {
  resource: any;
  fhirClient?: any;
  fhirVersion?: 'R4' | 'R5' | 'R6';
  settings?: ValidationSettings;
}

// ============================================================================
// Reference Executor
// ============================================================================

export class ReferenceExecutor {
  private referenceValidator: ReferenceValidator;

  constructor() {
    this.referenceValidator = new ReferenceValidator();
  }

  /**
   * Validate references in a resource
   */
  async validate(
    context: ReferenceValidationContext
  ): Promise<ValidationIssue[]> {
    try {
      const { resource, fhirClient: _fhirClient, fhirVersion, settings } = context;

      logger.debug(`[ReferenceExecutor] Validating references for ${resource.resourceType}...`);

      // Delegate to reference validator's internal method (returns ValidationIssue[])
      const issues = await this.referenceValidator.validateInternal(
        resource,
        resource.resourceType,
        fhirVersion,
        settings
      );

      // Add contained-reference validation (#id refs must resolve within contained[])
      // This catches the ref-1 invariant: SHALL have a contained resource if a
      // local reference is provided.
      const containedIssues = this.referenceValidator.validateContainedReferencesSync(resource);
      issues.push(...containedIssues);

      return issues;

    } catch (error) {
      logger.error('[ReferenceExecutor] Validation error:', error);
      return [{
        id: `reference-executor-error-${Date.now()}`,
        aspect: 'reference',
        severity: 'error',
        code: 'validation-error',
        message: `Reference validation failed: ${error instanceof Error ? error.message : String(error)}`,
        path: '',
        timestamp: new Date()
      }];
    }
  }
}

