/**
 * Metadata Validation Types and Constants
 * 
 * Shared types and configuration for metadata validation.
 */

/**
 * Required metadata rules by resource type
 */
export interface MetadataRequirement {
  field: 'versionId' | 'lastUpdated' | 'profile' | 'security' | 'tag' | 'source';
  severity: 'error' | 'warning' | 'info';
  reason: string;
}

/**
 * Metadata requirements per resource type
 * 
 * Defines metadata fields that can be generically expected from server-managed
 * resources. Security labels are intentionally not required here: they are
 * policy/profile-specific, and absent labels should not be reported by the
 * universal validator unless a concrete policy says so.
 */
export const RESOURCE_METADATA_REQUIREMENTS: Record<string, MetadataRequirement[]> = {
  // Clinical resources that should track provenance
  // Note: All demoted to 'info' because HAPI doesn't validate metadata completeness
  'Patient': [
    { field: 'lastUpdated', severity: 'info', reason: 'Patient resources should track last modification time' },
    { field: 'versionId', severity: 'info', reason: 'Version tracking recommended for audit purposes' },
  ],
  'Observation': [
    { field: 'lastUpdated', severity: 'info', reason: 'Observation resources should track last modification time' },
  ],
  'Condition': [
    { field: 'lastUpdated', severity: 'info', reason: 'Condition resources should track last modification time' },
    { field: 'versionId', severity: 'info', reason: 'Version tracking recommended for clinical accuracy' },
  ],
  'MedicationRequest': [
    { field: 'lastUpdated', severity: 'info', reason: 'Medication orders should track last modification time' },
    { field: 'versionId', severity: 'info', reason: 'Version tracking important for medication safety' },
  ],
  'AllergyIntolerance': [
    { field: 'lastUpdated', severity: 'info', reason: 'Allergy records should track last modification time' },
    { field: 'versionId', severity: 'info', reason: 'Version tracking critical for patient safety' },
  ],
  'Immunization': [
    { field: 'lastUpdated', severity: 'info', reason: 'Immunization records should track last modification time' },
    { field: 'versionId', severity: 'info', reason: 'Version tracking recommended for immunization history' },
  ],
  'Procedure': [
    { field: 'lastUpdated', severity: 'info', reason: 'Procedure records should track last modification time' },
    { field: 'versionId', severity: 'info', reason: 'Version tracking recommended for audit purposes' },
  ],
  'DiagnosticReport': [
    { field: 'lastUpdated', severity: 'info', reason: 'Diagnostic reports should track last modification time' },
    { field: 'versionId', severity: 'info', reason: 'Version tracking recommended for report history' },
  ],

  // Infrastructure resources
  'Bundle': [
    { field: 'lastUpdated', severity: 'info', reason: 'Bundle modification time helps track freshness' },
  ],
  'Provenance': [
    { field: 'lastUpdated', severity: 'info', reason: 'Provenance resources should track when they were created' },
  ],
  'AuditEvent': [
    { field: 'lastUpdated', severity: 'info', reason: 'Audit events must track creation time' },
  ],
  'Consent': [
    { field: 'lastUpdated', severity: 'info', reason: 'Consent records must track last modification time' },
    { field: 'versionId', severity: 'info', reason: 'Version tracking critical for legal compliance' },
  ],

  // Financial resources
  'Claim': [
    { field: 'lastUpdated', severity: 'info', reason: 'Claims should track last modification time' },
    { field: 'versionId', severity: 'info', reason: 'Version tracking important for billing accuracy' },
  ],
  'Coverage': [
    { field: 'lastUpdated', severity: 'info', reason: 'Coverage records should track last modification time' },
    { field: 'versionId', severity: 'info', reason: 'Version tracking recommended for coverage changes' },
  ],
};

/**
 * Known FHIR security label systems and their common codes
 */
export const KNOWN_SECURITY_SYSTEMS: Record<string, { name: string; commonCodes: string[] }> = {
  'http://terminology.hl7.org/CodeSystem/v3-Confidentiality': {
    name: 'Confidentiality',
    commonCodes: ['U', 'L', 'M', 'N', 'R', 'V'],
  },
  'http://terminology.hl7.org/CodeSystem/v3-ActCode': {
    name: 'ActCode',
    commonCodes: ['ETHUD', 'GDIS', 'HIV', 'PSY', 'SCA', 'SDV', 'SEX', 'STD', 'TBOO'],
  },
  'http://terminology.hl7.org/CodeSystem/v3-ObservationValue': {
    name: 'ObservationValue',
    commonCodes: ['ABSTRED', 'AGGRED', 'ANONYED', 'MAPPED', 'MASKED', 'PSEUDED', 'REDACTED', 'SUBSETTED', 'SYNTAC', 'TRSLT'],
  },
};

/**
 * Common FHIR resource types for profile URL extraction
 * Sorted by length descending to match longer types first
 */
export const COMMON_RESOURCE_TYPES = [
  'MedicationRequest', 'AllergyIntolerance', 'DiagnosticReport', 'DocumentReference',
  'Observation', 'Condition', 'Procedure', 'Medication', 'Encounter',
  'Organization', 'Practitioner', 'Immunization', 'CarePlan',
  'Bundle', 'Composition', 'Provenance', 'Patient',
];
