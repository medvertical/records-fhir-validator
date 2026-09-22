import type { Constraint } from '../core/structure-definition-types.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import {
  classifyUnsupportedEngineCapabilityError,
  type FHIRPathConstraintDiagnosticTracker,
} from './fhirpath-constraint-diagnostics.js';
import {
  createConstraintEvaluationError,
  getEvaluationErrorMessage,
} from './sd-fhirpath-issue-factory.js';

interface ConstraintEvaluationFailureInput {
  constraint: Constraint;
  diagnosticTracker: Pick<FHIRPathConstraintDiagnosticTracker, 'record'>;
  elementPath: string;
  error: unknown;
  profileUrl: string;
  resourceType: string;
}

/** Apply the operational failure policy for general constraint evaluation. */
export function handleConstraintEvaluationFailure(
  input: ConstraintEvaluationFailureInput,
): ValidationIssue[] {
  const errorMessage = getEvaluationErrorMessage(input.error);
  const skipReason = classifyUnsupportedEngineCapabilityError(errorMessage);
  if (skipReason !== null) {
    input.diagnosticTracker.record(
      skipReason,
      input.constraint,
      input.profileUrl,
      input.elementPath,
      errorMessage,
    );
    logger.debug('[ConstraintValidator] Skipping unsupported FHIRPath function', {
      skipReason,
      ...sensitiveValueMetadata(input.constraint.key),
    });
    return [];
  }

  // Still a constraint that produced no verdict, so it belongs in the same
  // count; only the issue differs, because an unnamed failure is worth
  // surfacing on the resource rather than absorbing silently.
  input.diagnosticTracker.record(
    'evaluation-error',
    input.constraint,
    input.profileUrl,
    input.elementPath,
    errorMessage,
  );
  logger.warn('[ConstraintValidator] Constraint evaluation failed', {
    ...sensitiveValueMetadata(input.constraint.key),
    ...validationFailureMetadata(input.error),
  });
  return [
    createConstraintEvaluationError(
      input.constraint,
      input.elementPath,
      input.resourceType,
      input.error,
      input.profileUrl,
    ),
  ];
}
