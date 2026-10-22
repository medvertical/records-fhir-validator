import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import type { CustomRuleApplicabilityReason, CustomRuleSelectedRelease } from './applicability.js';

/** Uncertainty is execution evidence, never a resource data violation. */
export function createCustomRuleApplicabilityUnknownIssue(
  resourceType: string,
  ruleId: string | undefined,
  selectedRelease: CustomRuleSelectedRelease | null,
  applicabilityReason: CustomRuleApplicabilityReason,
): ValidationIssue {
  return createValidationIssue({
    code: 'custom-rule-applicability-unknown',
    path: resourceType,
    resourceType,
    customMessage: 'Custom rule applicability could not be established; this validation result is incomplete',
    severityOverride: 'warning',
    aspectOverride: 'custom_rule',
    details: { ...(ruleId === undefined ? {} : { ruleId }), selectedRelease, checkOutcome: 'unknown', validationComplete: false, applicabilityReason },
  });
}
