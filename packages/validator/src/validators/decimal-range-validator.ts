import { createValidationIssue } from '../issues/index.js';
import { normalizeResourceType } from '../issues/resource-type-normalizer.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

/**
 * HL7 parity bound (org.hl7.fhir.utilities.Utilities.checkDecimal, core
 * 6.10.0): a decimal lexeme is flagged as RANGE — warning
 * Type_Specific_Checks_DT_Decimal_Range — when its integer + fraction
 * positions exceed 18 digits, or its exponent has more than 4 digits.
 */
const MAX_DECIMAL_DIGITS = 18;

/**
 * JSON.parse collapses the original lexeme into a double, so the digit rule
 * runs on the canonical JS rendering, which matches the Java behaviour for
 * every plain-notation value (|v| < 1e21):
 *
 * - 1000000000000000000 (1e18) renders with 19 positional digits -> warned,
 *   exactly as Java warns on the same lexeme (fhir-test-cases obs-decimal).
 * - Values the JS renderer puts in positive e-notation (|v| >= 1e21) are
 *   warned by magnitude: their positional form always needs > 18 digits, and
 *   an out-of-range plain lexeme is indistinguishable from an exponent one
 *   after parsing. Java accepts a literal '1e+300', so this is a deliberate,
 *   documented widening forced by the lexeme loss.
 * - Small e-notation values (1e-22 and below) stay accepted, because Java
 *   accepts those lexemes and fhir-test-cases pins that behaviour.
 * - Exponent lexemes with > 4 exponent digits (1E+30000) overflow the double
 *   to Infinity, which is reported here as the same range warning Java emits.
 */
export function validateDecimalRange(
  value: number,
  path: string,
  profileUrl?: string,
): ValidationIssue | null {
  return isOutsideSupportedDecimalRange(value)
    ? createDecimalRangeIssue(value, path, profileUrl)
    : null;
}

function isOutsideSupportedDecimalRange(value: number): boolean {
  if (!Number.isFinite(value)) return true;
  const rendered = String(value);
  const exponentIndex = rendered.indexOf('e');
  if (exponentIndex >= 0) {
    return !rendered.includes('e-');
  }
  const positionalDigits = rendered.replace('-', '').replace('.', '').length;
  return positionalDigits > MAX_DECIMAL_DIGITS;
}

function createDecimalRangeIssue(
  value: number,
  path: string,
  profileUrl?: string,
): ValidationIssue {
  return createValidationIssue({
    code: 'decimal-value-out-of-range',
    path,
    resourceType: normalizeResourceType('Unknown', path),
    profile: profileUrl,
    customMessage:
      `The value '${String(value)}' is outside the range of commonly/reasonably supported decimals`,
    severityOverride: 'warning',
    details: {
      value: String(value),
      maxSignificantDigits: MAX_DECIMAL_DIGITS,
      fixHint: 'Check the value for data-entry errors; commonly supported decimals carry at most 18 digits.',
    },
  });
}
