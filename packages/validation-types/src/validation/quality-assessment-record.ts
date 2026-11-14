import { z } from 'zod';
import { qualityAssessmentCriterionSchema } from './quality-assessment-counts.js';
import { boundedQualityRuleId } from './quality-rule-schema-foundations.js';

const hash = z.custom<`sha256:${string}`>(value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value));
const version = z.string().min(1).max(64).regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/);
export const qualityAssessmentProvenanceSchema = z.object({ basisOrigin: z.enum(['program', 'policy']),
  severityOrigin: z.enum(['records-default', 'program', 'policy']), upstreamSeverity: z.literal('not-provided'),
  populationFingerprint: hash }).strict();
const impact = z.object({ severity: z.enum(['information', 'warning', 'error']),
  origin: z.enum(['records-default', 'program', 'policy']), upstreamSeverity: z.literal('not-provided'),
  reasonFingerprint: hash.optional(), blockingAction: z.literal('quality-acceptance').optional() }).strict()
  .refine(value => value.blockingAction === undefined || value.severity === 'error');

/** Metadata-only result basis. Authored free text and source values are never copied here. */
export const qualityAssessmentRecordBasisSchema = z.object({
  schemaVersion: z.literal(2), criterion: qualityAssessmentCriterionSchema, basisFingerprint: hash,
  basisOrigin: z.enum(['program', 'policy']),
  source: z.object({ kind: z.enum(['records-program', 'workspace-policy', 'profile']),
    id: boundedQualityRuleId, version, referenceFingerprint: hash.optional() }).strict(),
  population: z.object({ id: boundedQualityRuleId, version, descriptionFingerprint: hash, selectionFingerprint: hash }).strict(),
  measurement: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('boolean'), trueMeaningFingerprint: hash, falseMeaningFingerprint: hash }).strict(),
    z.object({ kind: z.literal('distribution') }).strict(),
  ]),
  impactPolicy: impact,
}).strict().refine(value => value.measurement.kind !== 'distribution' || value.criterion.mode === 'observation');

export const qualityAssessmentRecordSchema = qualityAssessmentRecordBasisSchema.safeExtend({
  populationComplete: z.boolean(),
  decision: z.object({ schemaVersion: z.literal(2), outcome: z.enum(['observation', 'pass', 'fail', 'not-evaluable']),
    coverage: z.enum(['complete', 'partial', 'empty']), impact: impact.optional() }).strict(),
}).superRefine((record, context) => {
  if ((record.decision.outcome === 'fail') !== Boolean(record.decision.impact)
    || record.criterion.mode === 'observation' && ['pass', 'fail'].includes(record.decision.outcome)
    || record.decision.impact && JSON.stringify(record.decision.impact) !== JSON.stringify(record.impactPolicy)) {
    context.addIssue({ code: 'custom', message: 'Inconsistent recorded assessment impact' });
  }
});

export type QualityAssessmentRecordBasis = z.infer<typeof qualityAssessmentRecordBasisSchema>;
export type QualityAssessmentRecord = z.infer<typeof qualityAssessmentRecordSchema>;

export function qualityAssessmentBasisOfRecord(record: QualityAssessmentRecord): QualityAssessmentRecordBasis {
  const { populationComplete: _complete, decision: _decision, ...basis } = record;
  return qualityAssessmentRecordBasisSchema.parse(basis);
}
