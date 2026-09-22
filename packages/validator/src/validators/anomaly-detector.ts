import {
  detectDuplicates,
  detectMissingFields,
  detectOrphanReferences,
} from './anomaly-cohort-detectors.js';
import {
  type AnomalyDetectorConfig,
  type AnomalyFinding,
} from './anomaly-types.js';
import { normalizeAnomalyDetectorConfig } from './anomaly-config.js';
import { detectValueRangeOutliers } from './anomaly-value-range-detector.js';
import { detectCodingInconsistencies, detectTemporalGaps } from './anomaly-longitudinal-detectors.js';

export type { AnomalyDetectorConfig, AnomalyFinding, AnomalyType } from './anomaly-types.js';

export class AnomalyDetector {
  private readonly config: AnomalyDetectorConfig;

  constructor(config: Partial<AnomalyDetectorConfig> = {}) {
    this.config = normalizeAnomalyDetectorConfig(config);
  }

  detect(value: unknown): AnomalyFinding[] {
    const resources = Array.isArray(value) ? value : [];
    if (resources.length < this.config.minBatchSize) {
      return [];
    }

    const findings: AnomalyFinding[] = [];

    if (this.config.enableMissingField) {
      findings.push(...detectMissingFields(resources, this.config));
    }
    if (this.config.enableDuplicateDetection) {
      findings.push(...detectDuplicates(resources));
    }
    if (this.config.enableOrphanReferences) {
      findings.push(...detectOrphanReferences(resources));
    }
    if (this.config.enableValueRangeOutlier) {
      findings.push(...detectValueRangeOutliers(resources));
    }
    if (this.config.enableTemporalGap) {
      findings.push(...detectTemporalGaps(resources, this.config.temporalGapDays));
    }
    if (this.config.enableCodingConsistency) {
      findings.push(...detectCodingInconsistencies(resources));
    }

    findings.sort((a, b) => b.confidence - a.confidence || (b.outlierCount ?? 0) - (a.outlierCount ?? 0));

    return findings;
  }
}
