/* eslint-disable max-lines */
/**
 * Cross-Resource Anomaly Detector
 * --------------------------------
 *
 * Phase C differentiator: analyses a BATCH of resources after per-
 * resource validation and surfaces cohort-level data-quality anomalies
 * that no single-resource validator can detect.
 *
 * HAPI, Firely, and every other FHIR validator operate per-resource.
 * Records sees the batch. This module is why.
 *
 * Anomaly types (Phase C.1):
 *
 *   1. **Missing-field anomaly** — a field that is technically optional
 *      but present in ≥N% of resources of the same type. Resources
 *      where it's absent are flagged as outliers. Threshold is
 *      configurable (default 80%).
 *
 *   2. **Duplicate detection** — resources of the same type with
 *      identical (code + effective date + value) tuples for the same
 *      subject. Probable import duplicates.
 *
 *   3. **Orphan reference detection** — references inside the batch
 *      that point at resources not present in the batch. Useful for
 *      Bundle and bulk-import scenarios.
 *
 * Integration: called from `validator-engine.ts` `batchValidate()`
 * after all per-resource validation is complete. Receives the full
 * resource array and returns `AnomalyFinding[]`.
 */

// ============================================================================
// Types
// ============================================================================

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
   * for the same subject to flag as a temporal gap. Default 180 (6 months).
   */
  temporalGapDays: number;
}

const DEFAULT_CONFIG: AnomalyDetectorConfig = {
  missingFieldThreshold: 0.8,
  minBatchSize: 5,
  enableMissingField: true,
  enableDuplicateDetection: true,
  enableOrphanReferences: true,
  enableValueRangeOutlier: true,
  enableTemporalGap: true,
  enableCodingConsistency: true,
  temporalGapDays: 180,
};

// ============================================================================
// Anomaly Detector
// ============================================================================

export class AnomalyDetector {
  private config: AnomalyDetectorConfig;

  constructor(config: Partial<AnomalyDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run all enabled detectors on a batch of resources.
   *
   * @param resources — the full batch (same array passed to batchValidate)
   * @returns anomaly findings, sorted by confidence descending
   */
  detect(resources: any[]): AnomalyFinding[] {
    if (!resources || resources.length < this.config.minBatchSize) {
      return [];
    }

    const findings: AnomalyFinding[] = [];

    if (this.config.enableMissingField) {
      findings.push(...this.detectMissingFields(resources));
    }
    if (this.config.enableDuplicateDetection) {
      findings.push(...this.detectDuplicates(resources));
    }
    if (this.config.enableOrphanReferences) {
      findings.push(...this.detectOrphanReferences(resources));
    }
    if (this.config.enableValueRangeOutlier) {
      findings.push(...this.detectValueRangeOutliers(resources));
    }
    if (this.config.enableTemporalGap) {
      findings.push(...this.detectTemporalGaps(resources));
    }
    if (this.config.enableCodingConsistency) {
      findings.push(...this.detectCodingInconsistencies(resources));
    }

    // Sort by confidence descending, then by outlier count descending
    findings.sort((a, b) => b.confidence - a.confidence || (b.outlierCount ?? 0) - (a.outlierCount ?? 0));

    return findings;
  }

  // --------------------------------------------------------------------------
  // Detector 1: Missing-field anomaly
  // --------------------------------------------------------------------------

  /**
   * For each resource type in the batch, compute field-presence
   * statistics. If a field is present in ≥threshold% of resources
   * but absent in the rest, flag the absent ones as anomalies.
   *
   * Only checks direct top-level fields (not deeply nested) to keep
   * it fast and the findings actionable.
   */
  private detectMissingFields(resources: any[]): AnomalyFinding[] {
    const findings: AnomalyFinding[] = [];
    const byType = this.groupByType(resources);

    for (const [resourceType, group] of byType) {
      if (group.length < this.config.minBatchSize) continue;

      // Count field presence across the cohort
      const fieldCounts = new Map<string, number>();
      for (const { resource } of group) {
        for (const key of Object.keys(resource)) {
          if (key === 'resourceType' || key === 'id' || key === 'meta' || key === 'text') continue;
          if (resource[key] === undefined || resource[key] === null) continue;
          fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
        }
      }

      // Find fields above threshold that have outliers
      const threshold = this.config.missingFieldThreshold;
      for (const [field, count] of fieldCounts) {
        const ratio = count / group.length;
        if (ratio >= threshold && ratio < 1.0) {
          // This field is present in most but not all
          const missing = group.filter(g => {
            const v = g.resource[field];
            return v === undefined || v === null;
          });
          if (missing.length === 0) continue;

          const pct = Math.round(ratio * 100);
          findings.push({
            type: 'missing-field',
            description:
              `${pct}% of ${resourceType} resources have '${field}', ` +
              `but ${missing.length} are missing it. This is likely a ` +
              `data-quality issue rather than intentional omission.`,
            confidence: ratio, // Higher presence ratio = higher confidence it should be there
            affectedIndices: missing.map(m => m.index),
            affectedIds: missing.map(m => m.resource.id || `[index ${m.index}]`),
            resourceType,
            fieldPath: `${resourceType}.${field}`,
            suggestion:
              `Review the ${missing.length} ${resourceType} resources missing '${field}'. ` +
              `If the field is expected, add it. If intentionally absent, consider ` +
              `adding a data-absent-reason extension.`,
            cohortCount: count,
            outlierCount: missing.length,
          });
        }
      }
    }

    return findings;
  }

  // --------------------------------------------------------------------------
  // Detector 2: Duplicate detection
  // --------------------------------------------------------------------------

  /**
   * For Observations: group by (subject + code + effective date).
   * If multiple resources share the same key, flag as probable
   * duplicates.
   */
  private detectDuplicates(resources: any[]): AnomalyFinding[] {
    const findings: AnomalyFinding[] = [];
    const byType = this.groupByType(resources);

    // Observation duplicates: same subject + code + effectiveDateTime
    const observations = byType.get('Observation');
    if (observations && observations.length >= 2) {
      const keyMap = new Map<string, Array<{ index: number; resource: any }>>();

      for (const entry of observations) {
        const r = entry.resource;
        const subject = r.subject?.reference || '';
        const code = r.code?.coding?.[0]?.code || r.code?.text || '';
        const effective = r.effectiveDateTime || r.effectivePeriod?.start || '';
        if (!subject || !code) continue;

        const key = `${subject}|${code}|${effective}`;
        if (!keyMap.has(key)) keyMap.set(key, []);
        keyMap.get(key)!.push(entry);
      }

      for (const [key, group] of keyMap) {
        if (group.length < 2) continue;
        const [subject, code, effective] = key.split('|');
        findings.push({
          type: 'duplicate-resource',
          description:
            `${group.length} Observations for subject '${subject}' with ` +
            `code '${code}'${effective ? ` at ${effective}` : ''} — ` +
            `probable duplicate import.`,
          confidence: 0.85,
          affectedIndices: group.map(g => g.index),
          affectedIds: group.map(g => g.resource.id || `[index ${g.index}]`),
          resourceType: 'Observation',
          suggestion:
            `Review and deduplicate. If these are intentional repeat ` +
            `measurements, consider using different effectiveDateTime values ` +
            `or adding a method/device discriminator.`,
          outlierCount: group.length,
        });
      }
    }

    // Generic duplicate: same resourceType + same id
    for (const [resourceType, group] of byType) {
      const idMap = new Map<string, Array<{ index: number; resource: any }>>();
      for (const entry of group) {
        const id = entry.resource.id;
        if (!id) continue;
        if (!idMap.has(id)) idMap.set(id, []);
        idMap.get(id)!.push(entry);
      }
      for (const [id, dupes] of idMap) {
        if (dupes.length < 2) continue;
        findings.push({
          type: 'duplicate-resource',
          description:
            `${dupes.length} ${resourceType} resources share id '${id}' — ` +
            `duplicate resources in the same batch.`,
          confidence: 0.95,
          affectedIndices: dupes.map(d => d.index),
          affectedIds: dupes.map(() => id),
          resourceType,
          suggestion: `Remove duplicate ${resourceType}/${id} entries from the batch.`,
          outlierCount: dupes.length,
        });
      }
    }

    return findings;
  }

  // --------------------------------------------------------------------------
  // Detector 3: Orphan reference detection
  // --------------------------------------------------------------------------

  /**
   * Collect all reference targets inside the batch and check which
   * ones point at resources not present in the batch. Only fires
   * for relative references (Type/id) since absolute URLs may
   * legitimately point outside the batch.
   */
  private detectOrphanReferences(resources: any[]): AnomalyFinding[] {
    const findings: AnomalyFinding[] = [];

    // Build a set of all resource identities in the batch
    const present = new Set<string>();
    for (const r of resources) {
      if (r.resourceType && r.id) {
        present.add(`${r.resourceType}/${r.id}`);
      }
    }
    if (present.size === 0) return findings;

    // Walk each resource and collect outgoing relative references
    const orphans = new Map<string, number[]>(); // target → source indices

    for (let i = 0; i < resources.length; i++) {
      const refs = this.collectReferences(resources[i]);
      for (const ref of refs) {
        // Only check relative references (Type/id pattern)
        if (/^[A-Z][A-Za-z]+\/[A-Za-z0-9\-.]+$/.test(ref)) {
          if (!present.has(ref)) {
            if (!orphans.has(ref)) orphans.set(ref, []);
            orphans.get(ref)!.push(i);
          }
        }
      }
    }

    for (const [target, sourceIndices] of orphans) {
      // Only flag if multiple resources reference the same missing target
      // (a single reference could be an external reference that's fine)
      if (sourceIndices.length < 2) continue;

      findings.push({
        type: 'orphan-reference',
        description:
          `${sourceIndices.length} resources reference '${target}' ` +
          `which is not present in this batch.`,
        confidence: 0.7,
        affectedIndices: sourceIndices,
        affectedIds: sourceIndices.map(i => resources[i]?.id || `[index ${i}]`),
        resourceType: target.split('/')[0],
        suggestion:
          `Include '${target}' in the batch, or verify that the ` +
          `reference is intentionally external.`,
        outlierCount: sourceIndices.length,
      });
    }

    return findings;
  }

  // --------------------------------------------------------------------------
  // Detector 4: Value-range outlier detection
  // --------------------------------------------------------------------------

  /**
   * Known clinical plausibility ranges for common LOINC-coded
   * Observation quantities. Values outside these ranges are almost
   * certainly data-entry errors or unit-conversion bugs.
   *
   * Each entry: [LOINC code, display name, min, max, expected UCUM unit].
   * Ranges are deliberately wide ("physiologically possible") not
   * narrow ("normal lab range") to avoid false positives on unusual
   * but real clinical values.
   */
  private static readonly PLAUSIBILITY_RANGES: Array<{
    loincCode: string;
    display: string;
    min: number;
    max: number;
    unit: string;
  }> = [
    { loincCode: '8480-6',  display: 'Systolic BP',      min: 30,   max: 350,  unit: 'mm[Hg]' },
    { loincCode: '8462-4',  display: 'Diastolic BP',     min: 10,   max: 250,  unit: 'mm[Hg]' },
    { loincCode: '8310-5',  display: 'Body temperature',  min: 25,   max: 45,   unit: 'Cel' },
    { loincCode: '29463-7', display: 'Body weight',       min: 0.1,  max: 700,  unit: 'kg' },
    { loincCode: '8302-2',  display: 'Body height',       min: 10,   max: 300,  unit: 'cm' },
    { loincCode: '8867-4',  display: 'Heart rate',        min: 10,   max: 400,  unit: '/min' },
    { loincCode: '9279-1',  display: 'Respiratory rate',  min: 2,    max: 100,  unit: '/min' },
    { loincCode: '59408-5', display: 'SpO2',              min: 0,    max: 100,  unit: '%' },
    { loincCode: '2339-0',  display: 'Glucose',           min: 1,    max: 2000, unit: 'mg/dL' },
    { loincCode: '2345-7',  display: 'Glucose (alt)',     min: 1,    max: 2000, unit: 'mg/dL' },
    { loincCode: '718-7',   display: 'Hemoglobin',        min: 1,    max: 30,   unit: 'g/dL' },
    { loincCode: '4548-4',  display: 'HbA1c',             min: 2,    max: 25,   unit: '%' },
    { loincCode: '2093-3',  display: 'Total Cholesterol', min: 10,   max: 1500, unit: 'mg/dL' },
    { loincCode: '2571-8',  display: 'Triglycerides',     min: 5,    max: 20000, unit: 'mg/dL' },
    { loincCode: '2160-0',  display: 'Creatinine',        min: 0.01, max: 50,   unit: 'mg/dL' },
  ];

  private static plausibilityMap: Map<string, (typeof AnomalyDetector.PLAUSIBILITY_RANGES)[0]> | null = null;

  private getPlausibilityMap() {
    if (!AnomalyDetector.plausibilityMap) {
      AnomalyDetector.plausibilityMap = new Map(
        AnomalyDetector.PLAUSIBILITY_RANGES.map(r => [r.loincCode, r]),
      );
    }
    return AnomalyDetector.plausibilityMap;
  }

  /**
   * Check Observation Quantities against known clinical plausibility
   * ranges. A systolic BP of 500 mmHg or a body weight of 9999 kg is
   * almost certainly a bug, even though it's structurally valid FHIR.
   */
  private detectValueRangeOutliers(resources: any[]): AnomalyFinding[] {
    const findings: AnomalyFinding[] = [];
    const rangeMap = this.getPlausibilityMap();

    for (let i = 0; i < resources.length; i++) {
      const r = resources[i];
      if (r?.resourceType !== 'Observation') continue;

      // Check top-level value
      this.checkQuantityRange(r, r.valueQuantity, `Observation.valueQuantity`, i, rangeMap, findings);

      // Check components (blood pressure panel, etc.)
      if (Array.isArray(r.component)) {
        for (let c = 0; c < r.component.length; c++) {
          const comp = r.component[c];
          this.checkQuantityRange(r, comp?.valueQuantity, `Observation.component[${c}].valueQuantity`, i, rangeMap, findings);
        }
      }
    }

    return findings;
  }

  private checkQuantityRange(
    observation: any,
    quantity: any,
    path: string,
    resourceIndex: number,
    rangeMap: Map<string, (typeof AnomalyDetector.PLAUSIBILITY_RANGES)[0]>,
    findings: AnomalyFinding[],
  ): void {
    if (!quantity || typeof quantity.value !== 'number') return;

    // Find the LOINC code — could be on the observation or in the
    // component that contains this quantity.
    const codings = [
      ...(observation.code?.coding || []),
      // Component-level code is in the parent component (caller
      // already navigated there).
    ];

    // Also check the component code if the path contains 'component'
    if (path.includes('component')) {
      const compIdx = path.match(/component\[(\d+)\]/)?.[1];
      if (compIdx !== undefined) {
        const comp = observation.component?.[Number(compIdx)];
        codings.push(...(comp?.code?.coding || []));
      }
    }

    for (const coding of codings) {
      if (coding.system !== 'http://loinc.org') continue;
      const range = rangeMap.get(coding.code);
      if (!range) continue;

      const val = quantity.value;
      if (val < range.min || val > range.max) {
        const id = observation.id || `[index ${resourceIndex}]`;
        findings.push({
          type: 'value-distribution-outlier',
          description:
            `${range.display} value ${val} ${quantity.unit || range.unit} is outside the ` +
            `physiologically plausible range (${range.min}–${range.max} ${range.unit}). ` +
            `This is almost certainly a data-entry error or unit-conversion bug.`,
          confidence: 0.9,
          affectedIndices: [resourceIndex],
          affectedIds: [id],
          resourceType: 'Observation',
          fieldPath: path,
          suggestion:
            `Check ${id}: ${range.display} = ${val}. ` +
            `Expected range ${range.min}–${range.max} ${range.unit}. ` +
            `Common causes: wrong unit (lbs vs kg), decimal-point shift, ` +
            `placeholder value not replaced.`,
          outlierCount: 1,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Detector 5: Temporal gap detection
  // --------------------------------------------------------------------------

  /**
   * For each subject (patient), collect all dated events (Encounters,
   * Observations, Conditions, Procedures) and find gaps exceeding the
   * configured threshold. A patient with encounters on Jan 1 and Dec 31
   * but nothing in between has an 11-month care gap that likely
   * indicates missing imports rather than a real treatment pause.
   */
  private detectTemporalGaps(resources: any[]): AnomalyFinding[] {
    const findings: AnomalyFinding[] = [];
    const gapMs = this.config.temporalGapDays * 24 * 60 * 60 * 1000;

    // Collect events per subject
    const subjectTimelines = new Map<string, Array<{ date: Date; index: number; rt: string; id: string }>>();

    for (let i = 0; i < resources.length; i++) {
      const r = resources[i];
      if (!r?.resourceType) continue;
      const subject = r.subject?.reference || r.patient?.reference;
      if (!subject) continue;

      let dateStr: string | undefined;
      switch (r.resourceType) {
        case 'Encounter':
          dateStr = r.period?.start; break;
        case 'Observation':
          dateStr = r.effectiveDateTime || r.effectivePeriod?.start; break;
        case 'Condition':
          dateStr = r.onsetDateTime || r.recordedDate; break;
        case 'Procedure':
          dateStr = r.performedDateTime || r.performedPeriod?.start; break;
        case 'MedicationRequest':
          dateStr = r.authoredOn; break;
        case 'DiagnosticReport':
          dateStr = r.effectiveDateTime || r.effectivePeriod?.start; break;
        default:
          continue;
      }
      if (!dateStr) continue;
      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) continue;

      if (!subjectTimelines.has(subject)) subjectTimelines.set(subject, []);
      subjectTimelines.get(subject)!.push({ date, index: i, rt: r.resourceType, id: r.id || `[${i}]` });
    }

    // Find gaps per subject
    for (const [subject, events] of subjectTimelines) {
      if (events.length < 2) continue;
      events.sort((a, b) => a.date.getTime() - b.date.getTime());

      for (let j = 1; j < events.length; j++) {
        const prev = events[j - 1];
        const curr = events[j];
        const diffMs = curr.date.getTime() - prev.date.getTime();

        if (diffMs > gapMs) {
          const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
          const diffMonths = Math.round(diffDays / 30);
          findings.push({
            type: 'temporal-gap',
            description:
              `${diffMonths}-month gap (${diffDays} days) in care timeline for ${subject}: ` +
              `last event ${prev.rt}/${prev.id} on ${prev.date.toISOString().slice(0, 10)}, ` +
              `next event ${curr.rt}/${curr.id} on ${curr.date.toISOString().slice(0, 10)}.`,
            confidence: Math.min(0.5 + (diffDays / 365) * 0.3, 0.9),
            affectedIndices: [prev.index, curr.index],
            affectedIds: [prev.id, curr.id],
            resourceType: 'Patient',
            fieldPath: subject,
            suggestion:
              `Check whether events between ${prev.date.toISOString().slice(0, 10)} and ` +
              `${curr.date.toISOString().slice(0, 10)} were missed during import. ` +
              `If the gap is real (patient transferred care), no action needed.`,
            outlierCount: 1,
          });
        }
      }
    }

    return findings;
  }

  // --------------------------------------------------------------------------
  // Detector 6: Coding consistency
  // --------------------------------------------------------------------------

  /**
   * For Conditions in the batch: group by normalized code display. If
   * the same clinical concept is coded differently (different systems
   * or different codes but same display text), flag it as an
   * inconsistency. This catches "Diabetes mellitus" coded as SNOMED
   * 73211009 in some records and ICD-10 E11.9 in others within the
   * same batch — a sign of inconsistent coding practice.
   */
  private detectCodingInconsistencies(resources: any[]): AnomalyFinding[] {
    const findings: AnomalyFinding[] = [];

    // Group conditions by normalized display text
    const byDisplay = new Map<string, Array<{ index: number; id: string; system: string; code: string }>>();

    for (let i = 0; i < resources.length; i++) {
      const r = resources[i];
      if (r?.resourceType !== 'Condition' && r?.resourceType !== 'AllergyIntolerance') continue;
      const codings = r.code?.coding || [];
      for (const coding of codings) {
        if (!coding.display) continue;
        const normDisplay = coding.display.toLowerCase().trim();
        if (normDisplay.length < 3) continue; // Skip very short displays
        if (!byDisplay.has(normDisplay)) byDisplay.set(normDisplay, []);
        byDisplay.get(normDisplay)!.push({
          index: i,
          id: r.id || `[${i}]`,
          system: coding.system || '(no system)',
          code: coding.code || '(no code)',
        });
      }
    }

    // Find displays with multiple different system+code pairs
    for (const [display, entries] of byDisplay) {
      const uniqueCodes = new Set(entries.map(e => `${e.system}|${e.code}`));
      if (uniqueCodes.size < 2) continue;

      const codeList = [...uniqueCodes].map(c => {
        const [sys, code] = c.split('|');
        const sysShort = sys.split('/').pop() || sys;
        return `${sysShort}#${code}`;
      }).join(', ');

      findings.push({
        type: 'coding-inconsistency',
        description:
          `'${display}' is coded differently across ${entries.length} resources: ${codeList}. ` +
          `Inconsistent coding breaks cohort queries and analytics.`,
        confidence: 0.75,
        affectedIndices: entries.map(e => e.index),
        affectedIds: entries.map(e => e.id),
        resourceType: 'Condition',
        suggestion:
          `Standardize coding for '${display}'. Pick one authoritative ` +
          `code system (preferably SNOMED CT) and map all instances to it.`,
        outlierCount: entries.length,
      });
    }

    return findings;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private groupByType(resources: any[]): Map<string, Array<{ index: number; resource: any }>> {
    const map = new Map<string, Array<{ index: number; resource: any }>>();
    for (let i = 0; i < resources.length; i++) {
      const rt = resources[i]?.resourceType;
      if (!rt) continue;
      if (!map.has(rt)) map.set(rt, []);
      map.get(rt)!.push({ index: i, resource: resources[i] });
    }
    return map;
  }

  private collectReferences(obj: any, refs: string[] = []): string[] {
    if (!obj || typeof obj !== 'object') return refs;
    if (Array.isArray(obj)) {
      for (const item of obj) this.collectReferences(item, refs);
      return refs;
    }
    if (typeof obj.reference === 'string') {
      refs.push(obj.reference);
    }
    for (const key of Object.keys(obj)) {
      if (key === 'resourceType' || key === 'id') continue;
      this.collectReferences(obj[key], refs);
    }
    return refs;
  }
}
