/**
 * Invariant Executor
 *
 * Validates standard invariant constraints:
 * - FHIRPath constraint validation
 * - Element rules validation
 *
 * Every invariant-aspect validator is wired here rather than at a fan-out call
 * site, so each fan-out path inherits the same rule set from one place.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from '../structure-definition-types.js';
import { containedResourceValidator } from '../../validators/contained-resource-validator.js';
import { resourceSpecificConstraintsValidator } from '../../validators/resource-specific-constraints-validator.js';
import { universalConstraintsValidator } from '../../validators/universal-constraints-validator.js';
import { logger } from '../../logger.js';
import { createExecutorFailureIssue } from './executor-failure-issue.js';
import { profileCanonicalMetadata } from '../../utils/sensitive-logging-metadata.js';
import { resourceTypeOf } from '../fhir-resource.js';

// ============================================================================
// Types
// ============================================================================

export interface InvariantValidationContext {
  resource: unknown;
  structureDef: StructureDefinition;
  profileUrl: string;
  existingIssues?: ValidationIssue[];
}

// ============================================================================
// Invariant Executor
// ============================================================================

export class InvariantExecutor {
  constructor() {
    // ConstraintValidator has been fundamentally relocated to ProfileExecutor
    // to strictly categorize FHIRPath base rules to the 'profile' bucket (HAPI parity)
  }

  /**
   * Validate invariant rules
   * Note: Standard FHIRPath invariants are now evaluated in the profile aspect.
   */
  async validate(
    context: InvariantValidationContext
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      const { resource, profileUrl, existingIssues = [] } = context;
      
      logger.debug('[InvariantExecutor] Validating invariant aspect', {
        resourceType: resourceTypeOf(resource),
        ...profileCanonicalMetadata(profileUrl),
      });

      // Resource-specific hand-coded constraint validators (obs-3/6/7, ait-1/2, cmp-1/2, etc.)
      // These replace FHIRPath evaluation for well-known constraints with more specific error codes.
      const resourceIssues = resourceSpecificConstraintsValidator.validate(resource, existingIssues, profileUrl);
      issues.push(...resourceIssues);

      // DomainResource contained rules (dom-2/dom-3, local reference resolution)
      // and the version-independent universal constraints.
      issues.push(...containedResourceValidator.validate(resource));
      // Reference syntax and ref-1 require the reference executor's enclosing context.
      issues.push(...universalConstraintsValidator.validateElementConstraints(resource));

      return issues;

    } catch {
      logger.error('[InvariantExecutor] Validation failed');
      // Labelled like everything else this executor emits, so a failure lands
      // in the bucket a reader is already filtering.
      return [createExecutorFailureIssue('structural', 'Invariant')];
    }
  }
}
