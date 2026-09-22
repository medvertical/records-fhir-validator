/**
 * Reference Executor
 * 
 * Validates resource references:
 * - Reference resolution
 * - Contained resource validation
 * - Bundle reference validation
 * - Reference integrity checking
 */

import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { ReferenceValidator } from '../../reference/index.js';
import { logger } from '../../logger.js';
import { createExecutorFailureIssue } from './executor-failure-issue.js';
import type { FhirClientLike } from '../profile-loader-utils.js';
import { resourceTypeOf } from '../fhir-resource.js';
import type { ReferenceResourceFetcher } from '../../reference/reference-fetch-deadline.js';

// ============================================================================
// Types
// ============================================================================

export interface ReferenceValidationContext {
  resource: unknown;
  fhirClient?: FhirClientLike;
  fhirVersion?: 'R4' | 'R5' | 'R6';
  settings?: ValidationSettings;
  resourceFetcher?: ReferenceResourceFetcher;
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
      const { resource, fhirClient, fhirVersion, settings } = context;
      const resourceType = resourceTypeOf(resource);

      logger.debug(`[ReferenceExecutor] Validating references for ${resourceType}...`);

      // Delegate to reference validator's internal method (returns ValidationIssue[])
      const issues = await this.referenceValidator.validateInternal(
        resource,
        resourceType,
        fhirClient,
        fhirVersion,
        settings,
        context.resourceFetcher,
      );

      // Add contained-reference validation (#id refs must resolve within contained[])
      // This catches the ref-1 invariant: SHALL have a contained resource if a
      // local reference is provided.
      const containedIssues = this.referenceValidator.validateContainedReferencesSync(resource);
      issues.push(...containedIssues);

      return issues;

    } catch {
      logger.error('[ReferenceExecutor] Validation failed');
      return [createExecutorFailureIssue('reference', 'Reference')];
    }
  }
}
