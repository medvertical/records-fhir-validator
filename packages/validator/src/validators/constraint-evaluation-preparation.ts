import type { Constraint } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateDom3Constraint } from './constraint-dom-rules.js';
import { resolveKnownConstraintOutcome } from './constraint-evaluation-outcome.js';
import type { ConstraintValidationState, FhirResource } from './constraint-validation-input.js';
import { preprocessTypeLiterals, resolveTypeLiteralContext } from './fhirpath-type-preprocessor.js';
import { evaluateSpecialisedRootConstraint } from './sd-fhirpath-executor.js';

export type PreparedConstraintEvaluation =
  | { handled: true; issues: ValidationIssue[] }
  | { handled: false; expression: string };

interface ConstraintEvaluationPreparationInput {
  resource: FhirResource;
  elementPath: string;
  constraint: Constraint;
  profileUrl: string;
  elementType: string | null;
  state: ConstraintValidationState;
}

/**
 * Resolves deterministic constraint outcomes and prepares the expression for
 * the stateful FHIRPath runtime. Preparation intentionally remains outside
 * the runtime failure boundary so preprocessing defects are not misclassified
 * as unsupported FHIRPath capabilities.
 */
export function prepareConstraintEvaluation({
  resource,
  elementPath,
  constraint,
  profileUrl,
  elementType,
  state,
}: ConstraintEvaluationPreparationInput): PreparedConstraintEvaluation {
  if (!constraint.expression) return { handled: true, issues: [] };
  if (constraint.key === 'dom-3') {
    return {
      handled: true,
      issues: validateDom3Constraint(resource, elementPath, constraint, profileUrl),
    };
  }

  if (elementPath === resource.resourceType) {
    const specialisedResult = evaluateSpecialisedRootConstraint(constraint.key, resource);
    if (specialisedResult !== null) {
      return {
        handled: true,
        issues: resolveKnownConstraintOutcome(specialisedResult, {
          constraint,
          elementPath,
          profileUrl,
          resource,
          strictnessMode: state.strictnessMode,
        }),
      };
    }
  }

  return {
    handled: false,
    expression: preprocessTypeLiterals(
      constraint.expression,
      resolveTypeLiteralContext(resource, elementPath, elementType, state.fhirVersion),
    ),
  };
}
