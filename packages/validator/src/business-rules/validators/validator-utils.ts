/**
 * Validator Utilities
 * 
 * Shared utilities for business rule validators.
 */

/**
 * FHIR datetime formats supported per R4 spec
 */
export const FHIR_DATETIME_FORMATS = [
  'YYYY-MM-DD',                    // Date only
  'YYYY-MM-DDTHH:mm:ss',          // Datetime without timezone
  'YYYY-MM-DDTHH:mm:ss[Z]',       // Datetime with UTC (literal Z)
  'YYYY-MM-DDTHH:mm:ssZ',         // Datetime with timezone offset (+01:00)
  'YYYY-MM-DDTHH:mm:ss.SSS',      // Datetime with milliseconds, no timezone
  'YYYY-MM-DDTHH:mm:ss.SSS[Z]',   // Datetime with milliseconds and UTC (literal Z)
  'YYYY-MM-DDTHH:mm:ss.SSSZ'      // Datetime with milliseconds and timezone offset
];

