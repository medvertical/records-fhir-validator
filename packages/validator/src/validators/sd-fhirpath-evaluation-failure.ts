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
 * Capability limitations and other failures retain an unchecked diagnostic
 * on the affected instance so callers cannot mistake them for successful checks.
 */
export function handleSDFHIRPathEvaluationFailure(
  input: SDFHIRPathEvaluationFailureInput,
): ValidationIssue[] {
  if (isUnsupportedAsyncFHIRPathError(input.error)) {
    logger.debug(
      '[SDFHIRPathExecutor] Skipping unsupported async function',
      sensitiveValueMetadata(input.constraint.key),
    );
    return [createConstraintEvaluationError(
      input.constraint,
      input.path,
      input.resourceType,
      input.error,
      input.profileUrl,
    )];
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
