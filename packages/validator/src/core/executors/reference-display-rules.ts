import { createValidationIssue } from '../../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

const PATTERN_PATH = /element(?:\[\d+\])?\.pattern/;

/**
 * A Reference that neither points at a resource nor names one by identifier
 * should at least say what it means; the reference validator warns when the
 * display is missing too. Pattern values in ElementDefinitions are exempt.
 */
export function referencesWithoutDisplay(value: unknown, path: string): ValidationIssue[] {
  if (PATTERN_PATH.test(path)) return [];
  const items = Array.isArray(value)
    ? value.map((item, index) => [item, `${path}[${index}]`] as const)
    : [[value, path] as const];
  return items
    .filter(([item]) => lacksTargetAndDisplay(item))
    .map(([, itemPath]) => createValidationIssue({
      code: 'reference-without-display',
      path: itemPath,
      resourceType: itemPath.split('.')[0] ?? 'Unknown',
    }));
}

function lacksTargetAndDisplay(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const reference = value as Record<string, unknown>;
  const identifier = typeof reference.identifier === 'object' && reference.identifier !== null
    ? reference.identifier as Record<string, unknown>
    : undefined;
  return !isNonEmptyString(reference.reference)
    && !isNonEmptyString(identifier?.system)
    && !isNonEmptyString(identifier?.value)
    && !isNonEmptyString(reference.display);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
