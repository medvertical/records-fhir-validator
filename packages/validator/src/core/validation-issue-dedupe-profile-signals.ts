import { getEffectiveIssueRuleId, getSpecificIssueRuleId } from '@records-fhir/validation-types';
import type { ValidationIssue } from '@records-fhir/validation-types';

export function isStructuralDateTimeMissingTimezoneIssue(issue: ValidationIssue): boolean {
  if (issue.code !== 'invalid' || issue.aspect !== 'structural') return false;
  const details = issue.details;
  const expectedType = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).expectedType
    : undefined;
  if (expectedType !== 'dateTime' && expectedType !== 'instant') return false;
  const message = issue.message?.toLowerCase() ?? '';
  return message.includes('date has a time') && message.includes('timezone');
}

export function isSpecificNameInvariantIssue(issue: ValidationIssue): boolean {
  if (!issue.code?.startsWith('constraint-violation-') &&
      issue.code !== 'profile-constraint-warning' &&
      issue.code !== 'profile-constraint-violation') return false;
  return (issue.message?.toLowerCase() ?? '').includes('name should be usable as an identifier');
}

export function isGermanGenderExtensionMissingIssue(issue: ValidationIssue): boolean {
  if (issue.code !== 'profile-extension-missing') return false;
  const details = issue.details;
  return Boolean(details && typeof details === 'object' && !Array.isArray(details) &&
    (details as Record<string, unknown>).expectedExtension === 'http://fhir.de/StructureDefinition/gender-amtlich-de');
}

export function getSpecificConstraintKey(issue: ValidationIssue): string | null {
  return getSpecificIssueRuleId(issue);
}

export function getEffectiveRuleId(issue: ValidationIssue): string | null {
  return getEffectiveIssueRuleId(issue);
}

export function isInvariantSpecificConstraintIssue(issue: ValidationIssue): boolean {
  return Boolean(issue.code?.trim().toLowerCase().match(/^(?:[a-z][a-z0-9]*-)+invariant-(.+)$/));
}
