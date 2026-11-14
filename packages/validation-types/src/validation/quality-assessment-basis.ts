import { z } from 'zod';
import { boundedQualityRuleId } from './quality-rule-schema-foundations.js';
import { qualityThresholdSchema } from './quality-threshold.js';

const version = z.string().min(1).max(64).regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/);
const description = z.string().trim().min(1).max(1_024);
const provenance = z.object({
  kind: z.enum(['records-program', 'workspace-policy', 'profile']),
  id: boundedQualityRuleId,
  version,
  reference: z.string().url().max(2_048).optional(),
}).strict();
const population = z.object({ id: boundedQualityRuleId, version, description }).strict();
const booleanMeasurement = z.object({
  kind: z.literal('boolean'),
  trueMeaning: description,
  falseMeaning: description,
}).strict().refine(measurement => measurement.trueMeaning !== measurement.falseMeaning, {
  message: 'Boolean measurement meanings must be distinct',
});
const distributionMeasurement = z.object({ kind: z.literal('distribution') }).strict();

const impact = z.object({
  severity: z.enum(['information', 'warning', 'error']),
  reason: description,
  /** A named quality decision, never an implicit deployment or FHIR validity gate. */
  blockingAction: z.literal('quality-acceptance').optional(),
}).strict().refine(value => value.blockingAction === undefined || value.severity === 'error', {
  message: 'Only an explicit error may block quality acceptance',
});
const common = { schemaVersion: z.literal(2), provenance, population };

/** Absence means legacy semantics; it must never be replaced by a V2 default on read. */
export const qualityAssessmentBasisSchema = z.discriminatedUnion('mode', [
  z.object({ ...common, mode: z.literal('observation'),
    measurement: z.union([booleanMeasurement, distributionMeasurement]) }).strict(),
  z.object({ ...common, mode: z.literal('predicate'), measurement: booleanMeasurement,
    expected: z.boolean(), impact: impact.optional() }).strict(),
  z.object({ ...common, mode: z.literal('threshold'), measurement: booleanMeasurement,
    // The legacy threshold parser supplies a ratio default; V2 requires an explicit unit.
    threshold: qualityThresholdSchema.safeExtend({ unit: z.enum(['ratio', 'percent', 'count']) }),
    impact: impact.optional() }).strict(),
]);

export type QualityAssessmentBasis = z.infer<typeof qualityAssessmentBasisSchema>;

export function qualityRuleAssessmentIssue(contractVersion: 1 | 2, rule: { assessment?: QualityAssessmentBasis;
  threshold?: unknown; severity: string; scope: string; implementation: { kind: string } }): string | undefined {
  if (contractVersion === 1 && rule.assessment || contractVersion === 2 && !rule.assessment) {
    return 'V2 programs require explicit assessment bases; V1 programs retain legacy semantics';
  }
  if (rule.assessment && (rule.threshold !== undefined
    || (rule.implementation.kind === 'cohort-distribution') !== (rule.assessment.measurement.kind === 'distribution')
    || rule.assessment.mode === 'threshold' && rule.scope !== 'cohort')) {
    return 'V2 assessment must match its measurement kind, scope and sole threshold owner';
  }
  if (rule.assessment && rule.severity !== (rule.assessment.mode === 'observation' ? 'information'
    : rule.assessment.impact?.severity ?? 'warning')) return 'V2 declared severity must agree with the explicit impact or Records default';
  return undefined;
}
export type QualityAssessmentOutcome = 'observation' | 'pass' | 'fail' | 'not-evaluable';

export interface QualityAssessmentDecision {
  schemaVersion: 2;
  outcome: QualityAssessmentOutcome;
  coverage: 'complete' | 'partial' | 'empty';
  /** Present only for a confirmed violation, before separate advisory processing. */
  impact?: {
    severity: 'information' | 'warning' | 'error';
    origin: 'records-default' | 'declared-assessment';
    upstreamSeverity: 'not-provided';
    reason?: string;
    blockingAction?: 'quality-acceptance';
  };
}
