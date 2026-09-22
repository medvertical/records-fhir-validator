import type { Constraint } from '../core/structure-definition-types.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';
import { interpretConstraintResult } from './constraint-result-policy.js';
import type { ConstraintValidationState, FhirResource } from './constraint-validation-input.js';
import { constraintOutcomeIssues } from './constraint-violation-issue.js';

interface ConstraintEvaluationOutcomeContext {
  constraint: Constraint;
  elementPath: string;
  profileUrl: string;
  resource: FhirResource;
  strictnessMode: ConstraintValidationState['strictnessMode'];
}

/** Resolve an outcome already evaluated by a specialised root rule. */
export function resolveKnownConstraintOutcome(
  passed: boolean,
  context: ConstraintEvaluationOutcomeContext,
): ValidationIssue[] {
  return constraintOutcomeIssues(
    passed,
    context.resource,
    context.elementPath,
    context.constraint,
    context.profileUrl,
    context.strictnessMode,
  );
}

/** Interpret a raw FHIRPath result and map it to the public issue contract. */
export function resolveEvaluatedConstraintOutcome(
  result: unknown,
  context: ConstraintEvaluationOutcomeContext,
): ValidationIssue[] {
  const interpretedResult = interpretConstraintResult(result, {
    constraint: context.constraint,
    elementPath: context.elementPath,
    resourceType: context.resource.resourceType,
    profileUrl: context.profileUrl,
  });
  if (interpretedResult.issue) return [interpretedResult.issue];

  const passed = interpretedResult.passed === true;
  if (context.elementPath === context.resource.resourceType) {
    const expressionLength = context.constraint.expression?.length ?? 0;
    logger.debug('[ConstraintValidator] Root constraint evaluated', {
      passed,
      expressionLength,
      ...sensitiveValueMetadata(context.constraint.key),
    });
  }

  return resolveKnownConstraintOutcome(passed, context);
}
