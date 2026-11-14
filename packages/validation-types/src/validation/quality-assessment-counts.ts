import { z } from 'zod';
import { qualityThresholdSchema } from './quality-threshold.js';
import type { QualityAssessmentDecision, QualityAssessmentOutcome } from './quality-assessment-basis.js';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const measurementSchema = z.object({ numerator: count, denominator: count, notEvaluable: count,
  populationComplete: z.boolean() }).strict().refine(value => value.numerator <= value.denominator
    && Number.isSafeInteger(value.denominator + value.notEvaluable), { message: 'Inconsistent quality measurement counts' });
export const qualityAssessmentCriterionSchema = z.discriminatedUnion('mode', [
  z.object({ schemaVersion: z.literal(2), mode: z.literal('observation') }).strict(),
  z.object({ schemaVersion: z.literal(2), mode: z.literal('predicate'), expected: z.boolean() }).strict(),
  z.object({ schemaVersion: z.literal(2), mode: z.literal('threshold'),
    threshold: qualityThresholdSchema.safeExtend({ unit: z.enum(['ratio', 'percent', 'count']) }) }).strict(),
]);
export type QualityAssessmentCriterion = z.infer<typeof qualityAssessmentCriterionSchema>;
export type QualityAssessmentMeasurement = z.infer<typeof measurementSchema>;

/** Shared by execution and evidence verification; it does not supply criteria or interpret provenance. */
export function evaluateQualityAssessmentCriterion(criterionInput: QualityAssessmentCriterion,
  measurementInput: QualityAssessmentMeasurement): Pick<QualityAssessmentDecision, 'schemaVersion' | 'outcome' | 'coverage'> {
  const criterion = qualityAssessmentCriterionSchema.parse(criterionInput);
  const measured = measurementSchema.parse(measurementInput);
  const coverage = measured.notEvaluable > 0 || !measured.populationComplete ? 'partial'
    : measured.denominator === 0 ? 'empty' : 'complete';
  return { schemaVersion: 2, coverage, outcome: decideOutcome(criterion, measured, coverage) };
}

function decideOutcome(basis: QualityAssessmentCriterion, measured: QualityAssessmentMeasurement,
  coverage: QualityAssessmentDecision['coverage']): QualityAssessmentOutcome {
  const { numerator, denominator } = measured;
  if (denominator === 0) return 'not-evaluable';
  if (basis.mode === 'observation') return 'observation';
  if (basis.mode === 'predicate') {
    const violations = basis.expected ? denominator - numerator : numerator;
    return violations > 0 ? 'fail' : coverage === 'complete' ? 'pass' : 'not-evaluable';
  }
  const { operator, unit, value } = basis.threshold;
  const target = unit === 'percent' ? value / 100 : value;
  const current = unit === 'count' ? numerator : numerator / denominator;
  if (coverage === 'complete') return compare(current, target, operator) ? 'pass' : 'fail';
  if (!measured.populationComplete) {
    const certainFailure = unit === 'count'
      ? (operator === 'lte' || operator === 'eq') && numerator > target || operator === 'lt' && numerator >= target
      : (operator === 'gte' || operator === 'eq') && target === 1 && numerator < denominator
        || (operator === 'lte' || operator === 'eq') && target === 0 && numerator > 0
        || operator === 'gt' && target === 1 || operator === 'lt' && target === 0;
    return certainFailure ? 'fail' : 'not-evaluable';
  }
  // Unknown members may change either side of a rate. Only an unavoidable violation is a Fail.
  const total = denominator + measured.notEvaluable;
  const lower = unit === 'count' ? numerator : numerator / total;
  const upper = unit === 'count' ? numerator + measured.notEvaluable : (numerator + measured.notEvaluable) / total;
  const definitelyFailed = operator === 'gte' ? upper < target
    : operator === 'gt' ? upper <= target
      : operator === 'lte' ? lower > target
        : operator === 'lt' ? lower >= target : target < lower || target > upper;
  return definitelyFailed ? 'fail' : 'not-evaluable';
}

function compare(actual: number, target: number, operator: 'gte' | 'gt' | 'lte' | 'lt' | 'eq'): boolean {
  return { gte: actual >= target, gt: actual > target, lte: actual <= target, lt: actual < target, eq: actual === target }[operator];
}
