export type AnomalyType =
  | 'missing-field'
  | 'duplicate-resource'
  | 'orphan-reference'
  | 'value-distribution-outlier'
  | 'temporal-gap'
  | 'coding-inconsistency';

export interface AnomalyFinding {
  /** Anomaly category */
  type: AnomalyType;
  /** Human-readable description */
  description: string;
  /** How confident the detector is (0.0 = wild guess, 1.0 = certain) */
  confidence: number;
  /** Resource indices in the input array that are affected */
  affectedIndices: number[];
  /** Resource IDs (if available) for display */
  affectedIds: string[];
  /** Resource type this anomaly concerns */
  resourceType: string;
  /** The field path that triggered the anomaly (for missing-field) */
  fieldPath?: string;
  /** Remediation suggestion */
  suggestion: string;
  /** How many resources in the cohort have the expected pattern */
  cohortCount?: number;
  /** How many are outliers */
  outlierCount?: number;
}

export interface AnomalyDetectorConfig {
  /**
   * Minimum fraction of resources that must have a field for the
   * missing-field detector to flag outliers. Default 0.8 (80%).
   */
  missingFieldThreshold: number;

  /**
   * Minimum batch size before anomaly detection kicks in. Below this
   * threshold, cohort-level statistics are meaningless.
   */
  minBatchSize: number;

  /**
   * Enable/disable individual detectors.
   */
  enableMissingField: boolean;
  enableDuplicateDetection: boolean;
  enableOrphanReferences: boolean;
  enableValueRangeOutlier: boolean;
  enableTemporalGap: boolean;
  enableCodingConsistency: boolean;

  /**
   * Minimum gap in days between consecutive encounters/observations
   * for the same subject to flag as a temporal gap. Default 730 (2 years).
   */
  temporalGapDays: number;
}

export const DEFAULT_ANOMALY_DETECTOR_CONFIG: AnomalyDetectorConfig = {
  missingFieldThreshold: 0.8,
  minBatchSize: 5,
  enableMissingField: true,
  enableDuplicateDetection: true,
  enableOrphanReferences: true,
  enableValueRangeOutlier: true,
  enableTemporalGap: true,
  enableCodingConsistency: true,
  temporalGapDays: 730,
};
