import type { ValidationAspectType } from './aspect-enums.js';

export const FindingSource = {
  FHIR_CONFORMANCE: 'fhir-conformance',
  DATA_QUALITY: 'data-quality',
} as const;

export type FindingSourceType = typeof FindingSource[keyof typeof FindingSource];
export type FindingAspectType = ValidationAspectType | typeof FindingSource.DATA_QUALITY;

export interface FindingSourceSeverityCounts {
  error: number;
  warning: number;
  information: number;
}

export interface FindingSourceSummary {
  source: FindingSourceType;
  issueGroups: number;
  occurrences: number;
  affectedResources: number;
  bySeverity: FindingSourceSeverityCounts;
}
