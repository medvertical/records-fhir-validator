import { createValidationIssue } from '../issues/index.js';
import type { Constraint } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

export type ConstraintResultStatus = 'passed' | 'failed' | 'non-boolean';

export interface ClassifiedConstraintResult {
  status: ConstraintResultStatus;
  resultTypes: string[];
}

interface ConstraintResultContext {
  constraint: Constraint;
  elementPath: string;
  resourceType: string;
  profileUrl: string;
}

interface InterpretedConstraintResult {
  passed: boolean | null;
  issue: ValidationIssue | null;
}

/**
 * FHIR invariants must return a Boolean collection. An empty collection is
 * vacuously satisfied; arbitrary truthy JavaScript values are not Booleans.
 */
export function classifyConstraintResult(result: unknown): ClassifiedConstraintResult {
  if (result === true) return { status: 'passed', resultTypes: ['boolean'] };
  if (result === false) return { status: 'failed', resultTypes: ['boolean'] };

  if (Array.isArray(result)) {
    if (result.length === 0) return { status: 'passed', resultTypes: [] };
    const resultTypes = [...new Set(result.map(resultType))];
    if (resultTypes.length === 1 && resultTypes[0] === 'boolean') {
      return {
        status: result.every(Boolean) ? 'passed' : 'failed',
        resultTypes,
      };
    }
    return { status: 'non-boolean', resultTypes };
  }

  return {
    status: 'non-boolean',
    resultTypes: [resultType(result)],
  };
}

export function interpretConstraintResult(
  result: unknown,
  { constraint, elementPath, resourceType, profileUrl }: ConstraintResultContext,
): InterpretedConstraintResult {
  const classification = classifyConstraintResult(result);
  if (classification.status !== 'non-boolean') {
    return {
      passed: classification.status === 'passed',
      issue: null,
    };
  }

  return {
    passed: null,
    issue: createValidationIssue({
      code: 'profile-constraint-evaluation-error',
      path: elementPath,
      resourceType,
      profile: profileUrl,
      customMessage: `Constraint '${constraint.key}' did not return a Boolean result`,
      severityOverride: 'information',
      details: {
        expression: constraint.expression,
        constraintKey: constraint.key,
        resultTypes: classification.resultTypes,
      },
    }),
  };
}

function resultType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
