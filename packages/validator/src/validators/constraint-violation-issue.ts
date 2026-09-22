import type { Constraint } from '../core/structure-definition-types.js';
import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ConstraintValidationState, FhirResource } from './constraint-validation-input.js';

export function constraintOutcomeIssues(
  passed: boolean,
  resource: FhirResource,
  elementPath: string,
  constraint: Constraint,
  profileUrl: string,
  strictnessMode: ConstraintValidationState['strictnessMode'],
): ValidationIssue[] {
  return passed
    ? []
    : [buildConstraintViolationIssue(resource, elementPath, constraint, profileUrl, strictnessMode)];
}

export function buildConstraintViolationIssue(
  resource: FhirResource,
  elementPath: string,
  constraint: Constraint,
  profileUrl: string,
  strictnessMode: ConstraintValidationState['strictnessMode'],
): ValidationIssue {
  const escalateToError = strictnessMode === 'strict' && constraint.severity === 'warning';
  const isDomConstraint = constraint.key?.startsWith('dom-');
  const isDom6 = constraint.key === 'dom-6';
  const isWarningConstraint = constraint.severity === 'warning' && !escalateToError;
  // A profile that declares `severity: warning` on a constraint means warning,
  // and the reference validator reports it as one. Demoting every non-dom
  // warning constraint to information diverged from that on every fixture
  // carrying such a constraint. dom-6 keeps its demotion: it is a best-practice
  // narrative rule the reference validator also treats as advisory.
  const shouldDemoteToInfo = (isDom6 && strictnessMode !== 'strict');
  const issueCode = isDom6
    ? 'dom-6'
    : ((isWarningConstraint && (!isDomConstraint || (isDom6 && shouldDemoteToInfo)))
      ? 'profile-constraint-warning'
      : 'profile-constraint-violation');
  const severityOverride = isDom6
    ? (escalateToError ? 'error' : 'info')
    : (shouldDemoteToInfo ? 'info' : undefined);
  const escalationNote = escalateToError ? ' [escalated from warning in strict mode]' : '';

  return createValidationIssue({
    code: issueCode,
    path: isDom6 ? `${elementPath.replace(/\.$/, '')}.text` : elementPath,
    resourceType: resource.resourceType,
    profile: profileUrl,
    customMessage: isDom6
      ? `${constraint.human}${escalationNote}`
      : `Constraint '${constraint.key}' failed: ${constraint.human}${escalationNote}`,
    ruleId: constraint.key,
    details: {
      expression: constraint.expression,
      constraintKey: constraint.key,
      originalSeverity: constraint.severity,
      escalated: escalateToError,
    },
    severityOverride,
  });
}
