import {
  DEFAULT_ANOMALY_DETECTOR_CONFIG,
  type AnomalyDetectorConfig,
} from './anomaly-types.js';

export function normalizeAnomalyDetectorConfig(
  config: Partial<AnomalyDetectorConfig>,
): AnomalyDetectorConfig {
  const defaults = DEFAULT_ANOMALY_DETECTOR_CONFIG;
  return {
    missingFieldThreshold: isFiniteNumber(config.missingFieldThreshold)
      ? Math.min(1, Math.max(0, config.missingFieldThreshold))
      : defaults.missingFieldThreshold,
    minBatchSize: isFiniteNumber(config.minBatchSize)
      ? Math.max(1, Math.floor(config.minBatchSize))
      : defaults.minBatchSize,
    temporalGapDays: isFiniteNumber(config.temporalGapDays)
      ? Math.max(1, config.temporalGapDays)
      : defaults.temporalGapDays,
    enableMissingField: getBoolean(
      config.enableMissingField,
      defaults.enableMissingField,
    ),
    enableDuplicateDetection: getBoolean(
      config.enableDuplicateDetection,
      defaults.enableDuplicateDetection,
    ),
    enableOrphanReferences: getBoolean(
      config.enableOrphanReferences,
      defaults.enableOrphanReferences,
    ),
    enableValueRangeOutlier: getBoolean(
      config.enableValueRangeOutlier,
      defaults.enableValueRangeOutlier,
    ),
    enableTemporalGap: getBoolean(
      config.enableTemporalGap,
      defaults.enableTemporalGap,
    ),
    enableCodingConsistency: getBoolean(
      config.enableCodingConsistency,
      defaults.enableCodingConsistency,
    ),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
