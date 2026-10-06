import type { ValidationIssue } from '@records-fhir/validation-types';
import type { Binding } from '../core/structure-definition-types.js';
import { createValidationIssue } from '../issues/index.js';
import { resourceTypeFromElementPath } from './valueset-display-utils.js';

/**
 * A CodeableConcept that carries no code at all against its binding: only
 * text, or codings with nothing but a display. The reference validator asks
 * for a code from an extensible value set here, and says of every coding
 * without a system that it cannot be validated, as warnings.
 */
export function bindingWithoutCodeIssues(
  value: unknown,
  binding: Binding,
  elementPath: string,
  valueSetUrl: string,
  profileUrl: string | undefined,
): ValidationIssue[] {
  if (!isCodeableConceptWithoutCode(value)) return [];
  const codings = Array.isArray(value.coding) ? value.coding : [];
  return [
    ...codings.flatMap((coding, index) => (isRecord(coding) && coding.system === undefined
      ? [createValidationIssue({
        code: 'terminology-coding-missing-system',
        path: `${elementPath}.coding[${index}]`,
        resourceType: resourceTypeFromElementPath(elementPath),
        profile: profileUrl,
        severityOverride: 'warning',
        customMessage:
          'Coding has no system. A code with no system has no defined meaning, and it cannot be validated. A system should be provided',
      })]
      : [])),
    ...(binding.strength === 'extensible'
      ? [createValidationIssue({
        code: 'terminology-binding-extensible-no-code',
        path: elementPath,
        resourceType: resourceTypeFromElementPath(elementPath),
        profile: profileUrl,
        messageParams: { valueSet: valueSetUrl },
      })]
      : []),
  ];
}

function isCodeableConceptWithoutCode(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if ('system' in value || 'code' in value) return false;
  return !Array.isArray(value.coding)
    || !value.coding.some(coding => isRecord(coding) && typeof coding.code === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
