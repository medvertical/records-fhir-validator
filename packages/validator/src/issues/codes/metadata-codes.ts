/** Metadata validation code catalog. */

import type { ValidationSeverity } from '@records-fhir/validation-types';
import type { ValidationCodeMetadata } from './validation-code-types.js';

function metadataCode(
  severity: ValidationSeverity,
  description: string,
): ValidationCodeMetadata {
  return { aspect: 'metadata', severity, description };
}

export const MetadataCodes = {
  // Version ID
  'metadata-version-id-invalid-type': metadataCode('error', 'versionId must be a string'),
  'metadata-version-id-empty': metadataCode('error', 'versionId cannot be empty'),
  'metadata-version-id-invalid-format': metadataCode('error', 'versionId does not match FHIR id pattern'),
  'metadata-version-id-timestamp-pattern': metadataCode('info', 'versionId appears to be a timestamp'),
  'metadata-version-id-non-positive': metadataCode('warning', 'Numeric versionId should be positive'),
  'metadata-version-id-special-chars-only': metadataCode('warning', 'versionId consists only of special characters'),
  'metadata-version-id-etag-format': metadataCode('warning', 'versionId appears to be in ETag format'),
  'metadata-version-id-same-as-id': metadataCode('info', 'versionId matches resource.id'),
  'metadata-version-id-very-high': metadataCode('info', 'versionId is unusually high'),
  'metadata-version-id-validation-error': metadataCode('warning', 'versionId validation failed'),

  // Last updated and chronology
  'metadata-last-updated-invalid-type': metadataCode('error', 'lastUpdated must be a string'),
  'metadata-last-updated-missing-timezone': metadataCode('warning', 'lastUpdated is missing timezone'),
  'metadata-last-updated-invalid-format': metadataCode('error', 'lastUpdated does not match instant format'),
  'metadata-last-updated-non-utc': metadataCode('info', 'lastUpdated uses non-UTC timezone'),
  'metadata-last-updated-missing-seconds': metadataCode('info', 'lastUpdated is missing seconds precision'),
  'metadata-last-updated-future': metadataCode('warning', 'lastUpdated is in the future'),
  'metadata-last-updated-old': metadataCode('info', 'lastUpdated is very old'),
  'metadata-last-updated-unix-epoch': metadataCode('info', 'lastUpdated is near Unix epoch'),
  'metadata-last-updated-at-midnight': metadataCode('info', 'lastUpdated is exactly at midnight'),
  'metadata-last-updated-validation-error': metadataCode('warning', 'lastUpdated validation failed'),
  'metadata-chronological-order-violation': metadataCode('error', 'Timestamps are not in chronological order'),
  'metadata-identical-timestamps': metadataCode('info', 'Multiple timestamps have identical values'),

  // Tags
  'metadata-tag-invalid-array': metadataCode('error', 'meta.tag must be an array'),
  'metadata-tag-invalid-object': metadataCode('error', 'Tag must be an object'),
  'metadata-tag-missing-system-code': metadataCode('warning', 'Tag should have system and/or code'),
  'metadata-tag-missing-code': metadataCode('warning', 'Tag should have a code'),
  'metadata-tag-invalid-system-type': metadataCode('error', 'Tag system must be a string'),
  'metadata-tag-invalid-system-uri': metadataCode('warning', 'Tag system is not a valid URI'),
  'metadata-tag-invalid-code-type': metadataCode('error', 'Tag code must be a string'),
  'metadata-tag-invalid-display-type': metadataCode('warning', 'Tag display must be a string'),
  'metadata-tag-code-without-system': metadataCode('info', 'Tag has code without system'),
  'metadata-tag-duplicate': metadataCode('info', 'Duplicate tag detected'),
  'metadata-tag-short-display': metadataCode('info', 'Tag display is very short'),
  'metadata-tag-code-as-display': metadataCode('info', 'Tag display appears to be same as code'),
  'metadata-tag-long-display': metadataCode('info', 'Tag display is very long'),

  // Security labels
  'metadata-security-invalid-array': metadataCode('error', 'meta.security must be an array'),
  'metadata-security-invalid-object': metadataCode('error', 'Security label must be an object'),
  'metadata-security-missing-system': metadataCode('warning', 'Security label missing system'),
  'metadata-security-missing-code': metadataCode('warning', 'Security label missing code'),
  'metadata-security-invalid-system': metadataCode('error', 'Security system is not a valid URI'),
  'metadata-security-invalid-code-type': metadataCode('error', 'Security code must be a string'),
  'metadata-security-invalid-display-type': metadataCode('warning', 'Security display must be a string'),
  // A repeated label carries no additional meaning, and the reference
  // validator reports it as an error.
  'metadata-security-duplicate': metadataCode('error', 'Duplicate security label'),
  'metadata-security-missing-display': metadataCode('info', 'Security label missing display'),
  'metadata-security-unknown-code': metadataCode('warning', 'Unknown security code'),
  'metadata-security-unknown-system': metadataCode('warning', 'Unknown security system'),

  // Source
  'metadata-source-invalid-type': metadataCode('error', 'source must be a string'),
  'metadata-source-empty': metadataCode('error', 'source cannot be empty'),
  'metadata-source-too-long': metadataCode('warning', 'source exceeds reasonable length'),
  'metadata-source-invalid-format': metadataCode('warning', 'source is not a valid URI'),
  'metadata-source-localhost': metadataCode('info', 'source references localhost'),
  'metadata-source-looks-like-reference': metadataCode('info', 'source looks like a FHIR reference'),
  'metadata-source-relative-uri': metadataCode('info', 'source is a relative URI'),
  'metadata-source-validation-error': metadataCode('warning', 'source validation failed'),

  // Profiles and general metadata
  'metadata-profile-invalid-array': metadataCode('error', 'meta.profile must be an array'),
  'metadata-profile-invalid-type': metadataCode('error', 'Profile entry must be a string'),
  'metadata-profile-invalid-url': metadataCode('warning', 'Profile URL is not valid'),
  'metadata-profile-resource-type-mismatch': metadataCode('warning', 'Profile does not match resource type'),
  'metadata-profile-duplicate': metadataCode('info', 'Duplicate profile declared'),
  'metadata-profile-not-accessible': metadataCode('warning', 'Profile is not accessible'),
  'metadata-profile-wrong-resource-type': metadataCode('error', 'Profile is for wrong resource type'),
  'metadata-missing-meta': metadataCode('info', 'Resource is missing meta element'),
  'metadata-invalid-meta-type': metadataCode('error', 'meta must be an object'),
} as const satisfies Record<string, ValidationCodeMetadata>;

export type MetadataCode = keyof typeof MetadataCodes;
