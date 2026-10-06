import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

/**
 * A response authored outside the questionnaire's effective period draws a
 * warning from the reference validator (QuestionnaireValidator.checkAuthoringDate).
 */
export function validateAuthoredWithinEffectivePeriod(
  response: Record<string, unknown>,
  questionnaire: Record<string, unknown>,
): ValidationIssue[] {
  const authored = typeof response.authored === 'string' ? response.authored : undefined;
  const period = asRecord(questionnaire.effectivePeriod);
  if (!authored || !period) return [];
  const moment = Date.parse(authored);
  if (Number.isNaN(moment)) return [];
  const issues: ValidationIssue[] = [];
  const bound = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : Number.NaN);
  if (moment > bound(period.end)) {
    issues.push(periodIssue(`The authored date '${authored}' is after the end of the permitted period defined in the Questionnaire ('${String(period.end)}')`));
  }
  if (moment < bound(period.start)) {
    issues.push(periodIssue(`The authored date '${authored}' is before the start of the permitted period defined in the Questionnaire ('${String(period.start)}')`));
  }
  return issues;
}

function periodIssue(message: string): ValidationIssue {
  return createValidationIssue({
    code: 'questionnaire-authored-outside-period',
    path: 'QuestionnaireResponse.authored',
    resourceType: 'QuestionnaireResponse',
    customMessage: message,
    severityOverride: 'warning',
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
