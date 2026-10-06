import { createValidationIssue } from '../../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

/**
 * An element the base specification defines as single-valued must not be a
 * JSON array, even one holding a single item; the reference validator
 * reports "The property identifier must be an Object, not an Array". A
 * profile can only narrow a repeating element to one value, which stays an
 * array, so the base cardinality decides.
 */
export function singleValuedArrayIssue(path: string, primitive: boolean): ValidationIssue {
  const property = path.split('.').pop() ?? path;
  const expected = primitive ? 'a JSON primitive' : 'an Object';
  return createValidationIssue({
    code: 'structural-validation-error',
    path,
    resourceType: path.split('.')[0] ?? 'Unknown',
    customMessage: `The property ${property} must be ${expected}, not an Array (at ${path})`,
    severityOverride: 'error',
  });
}

/** Resource-level elements the walker exempts from the snapshot lookup. */
const SINGLE_VALUED_SPECIAL_KEYS = new Set(['id', 'meta', 'implicitRules', 'language', 'text']);

export function specialElementArrayIssue(key: string, value: unknown, path: string): ValidationIssue | null {
  if (!SINGLE_VALUED_SPECIAL_KEYS.has(key) || !Array.isArray(value)) return null;
  return singleValuedArrayIssue(path, key !== 'meta' && key !== 'text');
}
