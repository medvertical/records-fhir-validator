import { createValidationIssue } from '../issues/index.js';
import { normalizeResourceType } from '../issues/resource-type-normalizer.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { isWhitespaceOnlyString } from './string-character-rules.js';

const INVALID_FORMAT_VALUE_PREVIEW_LIMIT = 120;

// Freeze the 2026 reference year so persisted evidence remains reproducible.
// Advancing this window requires a validation ruleset version change.
const MIN_PLAUSIBLE_YEAR = 1800;
const MAX_PLAUSIBLE_YEAR = 2106;

export function validatePrimitiveStringFormat(
  value: string,
  effectiveType: string,
  path: string,
  profileUrl?: string,
): ValidationIssue | null {
  switch (effectiveType) {
    case 'date':
      return isValidFhirDate(value)
        ? null
        : createInvalidFormatIssue(
          path,
          profileUrl,
          `Invalid date format: ${formatInvalidValueForMessage(value)}`,
          value,
          'date',
        );
    case 'dateTime':
    case 'instant':
      if (value.includes('T') && !/[Z+-]/.test(value.split('T')[1] || '')) {
        return createInvalidFormatIssue(
          path,
          profileUrl,
          'If a date has a time, it must have a timezone',
          value,
          effectiveType,
        );
      }
      return isValidFhirDateTime(value)
        ? null
        : createInvalidFormatIssue(
          path,
          profileUrl,
          `Invalid ${effectiveType} format: ${formatInvalidValueForMessage(value)}`,
          value,
          effectiveType,
        );
    case 'time':
      return /^([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?$/.test(value)
        ? null
        : createInvalidFormatIssue(
          path,
          profileUrl,
          `Invalid time format: ${formatInvalidValueForMessage(value)}`,
          value,
          'time',
        );
    case 'base64Binary':
      return isValidBase64Binary(value)
        ? null
        : createInvalidFormatIssue(
          path,
          profileUrl,
          `Invalid base64Binary format at ${path}`,
          value,
          'base64Binary',
          'structural-invalid-base64-format',
        );
    case 'string':
      return createStringWhitespacePaddingIssue(value, path, profileUrl);
    default:
      return null;
  }
}

/**
 * Warning-level lint mirroring HL7's reasonable-year check. Only call for
 * values that already passed format validation — an unparseable value gets
 * the format error instead of a plausibility hint.
 */
export function validateDateYearPlausibility(
  value: string,
  effectiveType: string,
  path: string,
  profileUrl?: string,
): ValidationIssue | null {
  if (!['date', 'dateTime', 'instant'].includes(effectiveType)) return null;
  const yearDigits = value.match(/^\d{4}/);
  if (!yearDigits) return null;
  const year = Number(yearDigits[0]);
  const maxPlausibleYear = MAX_PLAUSIBLE_YEAR;
  if (year >= MIN_PLAUSIBLE_YEAR && year <= maxPlausibleYear) return null;
  return createValidationIssue({
    code: 'date-year-implausible',
    path,
    resourceType: normalizeResourceType('Unknown', path),
    profile: profileUrl,
    // The year carries the whole finding, the rest of the value does not — and
    // a full date (a birthDate above all) is identifying, so it stays out of
    // the message and details that persistence writes to the database.
    customMessage: `The year ${year} is outside the range of reasonable years (${MIN_PLAUSIBLE_YEAR}-${maxPlausibleYear}) - check for data entry error`,
    severityOverride: 'warning',
    details: {
      year,
      minPlausibleYear: MIN_PLAUSIBLE_YEAR,
      maxPlausibleYear,
    },
  });
}

/**
 * HAPI parity: Type_Specific_Checks_DT_String_WS. Deliberately limited to the
 * plain `string` type — trailing whitespace can be semantic in markdown, and
 * whitespace-only values are already reported separately by
 * validateWhitespaceOnlyPrimitives.
 */
function createStringWhitespacePaddingIssue(
  value: string,
  path: string,
  profileUrl?: string,
): ValidationIssue | null {
  // isWhitespaceOnlyString, not trim().length: JS trim() misses U+0085, so a
  // whitespace-only value with a NEL would otherwise read as padded content.
  if (isWhitespaceOnlyString(value)) return null;
  const trimmed = value.trim();
  if (trimmed === value) return null;
  // Unlike a malformed lexical token, a padded string is well-formed clinical
  // content (Patient.name.family, Organization.name). Message and details are
  // persisted verbatim, so the finding describes the padding instead of
  // quoting the value: position and width locate it without copying data.
  const leading = value.length - value.trimStart().length;
  const trailing = value.length - value.trimEnd().length;
  const where = leading > 0 && trailing > 0 ? 'leading and trailing' : leading > 0 ? 'leading' : 'trailing';
  return createValidationIssue({
    code: 'string-whitespace-padding',
    path,
    resourceType: normalizeResourceType('Unknown', path),
    profile: profileUrl,
    customMessage:
      `String value has ${where} whitespace (${leading} leading, ${trailing} trailing of ${value.length} characters)`,
    severityOverride: 'warning',
    details: {
      leadingWhitespace: leading,
      trailingWhitespace: trailing,
      valueLength: value.length,
      fixHint: 'Remove the leading/trailing whitespace from the string value.',
    },
  });
}

export function buildDateTimeFormatDetails(
  value: string,
  expectedType: string,
): Record<string, unknown> {
  const suggestedValue = suggestFhirDateTime(value);
  return {
    value,
    expectedType,
    ...(suggestedValue ? { suggestedValue } : {}),
    fixHint: suggestedValue
      ? `Replace '${value}' with '${suggestedValue}' or another valid FHIR ${expectedType} value with required seconds and timezone.`
      : `Use a valid FHIR ${expectedType}: include seconds when a time is present and include a timezone (Z or +/-HH:MM).`,
  };
}

function createInvalidFormatIssue(
  path: string,
  profileUrl: string | undefined,
  message: string,
  value: string,
  expectedType: string,
  code = 'structural-invalid-format',
): ValidationIssue {
  return createValidationIssue({
    code,
    path,
    resourceType: normalizeResourceType('Unknown', path),
    profile: profileUrl,
    customMessage: message,
    severityOverride: 'error',
    details: ['dateTime', 'instant'].includes(expectedType)
      ? buildDateTimeFormatDetails(value, expectedType)
      : buildInvalidPrimitiveFormatDetails(value, expectedType),
  });
}

function buildInvalidPrimitiveFormatDetails(
  value: string,
  expectedType: string,
): Record<string, unknown> {
  if (value.length <= INVALID_FORMAT_VALUE_PREVIEW_LIMIT) {
    return {
      value,
      expectedType,
      fixHint: `Replace '${value}' with a valid FHIR ${expectedType} value.`,
    };
  }
  return {
    expectedType,
    valuePreview: truncateInvalidFormatValue(value),
    valueLength: value.length,
    valueTruncated: true,
    fixHint: `Replace this value with a valid FHIR ${expectedType} value. The current value is ${value.length} characters and was truncated in this report.`,
  };
}

function formatInvalidValueForMessage(value: string): string {
  return value.length <= INVALID_FORMAT_VALUE_PREVIEW_LIMIT
    ? `'${value}'`
    : `'${truncateInvalidFormatValue(value)}' (${value.length} characters)`;
}

function truncateInvalidFormatValue(value: string): string {
  return value.length <= INVALID_FORMAT_VALUE_PREVIEW_LIMIT
    ? value
    : `${value.slice(0, INVALID_FORMAT_VALUE_PREVIEW_LIMIT)}...`;
}

function suggestFhirDateTime(value: string): string | undefined {
  const missingSeconds = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/);
  if (missingSeconds) return `${missingSeconds[1]}:00${missingSeconds[2]}`;
  const trailingComma = value.match(/^(.+)(Z|[+-]\d{2}:\d{2}),$/);
  if (trailingComma) return `${trailingComma[1]}${trailingComma[2]}`;
  if (value.includes('T') && !/[Z+-]/.test(value.split('T')[1] || '')) return `${value}Z`;
  return undefined;
}

function isValidFhirDate(value: string): boolean {
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value) && hasValidCalendarDay(value);
}

function isValidFhirDateTime(value: string): boolean {
  const format = /^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?$/;
  return format.test(value) && hasValidCalendarDay(value);
}

function hasValidCalendarDay(value: string): boolean {
  const match = value.match(/^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])/);
  if (!match) return true;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day);
}

function isValidBase64Binary(value: string): boolean {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  const paddingIndex = value.indexOf('=');
  return paddingIndex === -1 || /^=+$/.test(value.slice(paddingIndex));
}
