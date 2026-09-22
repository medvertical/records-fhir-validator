import type { Constraint } from '../core/structure-definition-types.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import {
  createConstraintEvaluationError,
  isUnsupportedAsyncFHIRPathError,
} from './sd-fhirpath-issue-factory.js';

interface SDFHIRPathEvaluationFailureInput {
  constraint: Constraint;
  error: unknown;
  path: string;
  phase: 'matched' | 'collected';
  profileUrl?: string;
  resourceType: string;
}

/**
 * Apply the operational failure policy for StructureDefinition FHIRPath.
 *
 * Explicit async-capability limitations remain skippable. Every other failure
 * becomes an informational unchecked diagnostic so callers cannot mistake an
 * evaluator failure for a successful constraint check.
 */
export function handleSDFHIRPathEvaluationFailure(
  input: SDFHIRPathEvaluationFailureInput,
): ValidationIssue[] {
  if (isUnsupportedAsyncFHIRPathError(input.error)) {
    logger.debug(
      '[SDFHIRPathExecutor] Skipping unsupported async function',
      sensitiveValueMetadata(input.constraint.key),
    );
    return [];
  }

  const metadata = {
    ...sensitiveValueMetadata(input.constraint.key, input.path),
    ...validationFailureMetadata(input.error),
  };
  if (input.phase === 'matched') {
    logger.debug(
      '[SDFHIRPathExecutor] Matched constraint evaluation failed',
      metadata,
    );
  } else {
    logger.warn(
      '[SDFHIRPathExecutor] Collected constraint evaluation failed',
      metadata,
    );
  }

  return [createConstraintEvaluationError(
    input.constraint,
    input.path,
    input.resourceType,
    input.error,
    input.profileUrl,
  )];
}
