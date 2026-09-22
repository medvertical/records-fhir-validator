/**
 * Datatype Invariant Evaluator
 * ----------------------------
 *
 * Evaluates the FHIRPath constraints declared on core datatype
 * StructureDefinitions (Range rng-2, Quantity qty-3, Ratio rat-1,
 * Timing tim-*, ContactPoint cpt-2, SampledData sdd-1, ...) against each
 * element instance of that type. Resource SD snapshots do not copy these
 * rows onto typed elements, so without this pass they were never
 * evaluated anywhere.
 *
 * Expressions compile once per (version, element, expression) via a
 * bounded LRU; the extracted constraint plan is memoised per SD object.
 */

import fhirpath from 'fhirpath';
import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { getFhirPathModel } from '../core/fhirpath-context.js';
import type {
  Constraint,
  StructureDefinition,
} from '../core/structure-definition-types.js';
import { isRecord } from '../core/fhir-resource.js';
import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { classifyConstraintResult } from './constraint-result-policy.js';
import { rewriteCollectionTypeOperators } from './fhirpath-as-operator-rewrite.js';
import { InvariantRegistry } from './invariant-registry.js';
import { RANGE_BOUND_CONSTRAINT_KEYS } from './range-bound-invariants.js';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';

type FhirVersion = 'R4' | 'R5' | 'R6';

/**
 * Constraint keys that already have a dedicated Records reporter for the
 * datatype case. Kept local instead of extending `InvariantRegistry`:
 * that registry also gates the generic SD FHIRPath executor, and
 * registering these keys there would suppress existing findings from
 * profile snapshots that inline datatype rows.
 */
const DATATYPE_CONSTRAINT_OWNERS: Record<string, string> = {
  // attachment-validator emits `attachment-att1-violation` with MIME-level
  // diagnostics; a second generic report would double-fire the same defect.
  'att-1': 'attachment-validator.ts',
  // complex-type-invariants.checkPeriodPer1 compares by instant with
  // precision ranges (DST-safe, partial dates) and emits the established
  // `business-invalid-period-end` code; the raw `start <= end` FHIRPath
  // would both double-report and false-positive on precision overlaps.
  'per-1': 'complex-type-invariants.ts',
  // range-bound-invariants.checkRangeBounds compares the numeric bounds: the
  // R5+ expressions use lowBoundary(), which fhirpath.js rejects for Quantity,
  // and R4's `low <= high` answers true for two unit-less Quantities, so the
  // generic path reports an inverted range on neither version.
  ...Object.fromEntries(
    RANGE_BOUND_CONSTRAINT_KEYS.map(key => [key, 'range-bound-invariants.ts'] as const),
  ),
};

/**
 * FHIRPath features fhirpath.js cannot evaluate (probe-verified): keeping
 * them would either throw on every element or silently mis-evaluate.
 * Skipped with this documented list instead.
 */
const UNSUPPORTED_EXPRESSION_FEATURES: readonly string[] = [
  // txt-1 / txt-2 — fhirpath.js throws "Not implemented: htmlChecks".
  'htmlChecks(',
  // fhirpath.js boundary functions reject Quantity input ("Expected a
  // Decimal, Date, DateTime, or Time"); rng-2 / ratrng-2 reach their
  // substitute through DATATYPE_CONSTRAINT_OWNERS before this list.
  'lowBoundary(',
  'highBoundary(',
];

interface DatatypeConstraintPlanEntry {
  /** Snapshot element path the constraint is declared on, e.g. `Timing.repeat`. */
  elementPath: string;
  /** Path segments below the datatype root; empty for root constraints. */
  relativeSegments: string[];
  constraint: Constraint;
}

interface ConstraintTarget {
  value: unknown;
  path: string;
}

interface DatatypeInvariantInput {
  value: Record<string, unknown>;
  structureDef: StructureDefinition;
  basePath: string;
  profileUrl: string;
  fhirVersion: FhirVersion;
}

type CompiledExpression = (
  context: unknown,
  envVars: Record<string, unknown>,
  options: Record<string, unknown>,
) => unknown;

const MAX_COMPILED_EXPRESSIONS = 256;

export class DatatypeInvariantEvaluator {
  private readonly planCache = new WeakMap<StructureDefinition, DatatypeConstraintPlanEntry[]>();
  // null marks a failed compile so broken expressions are not retried per element.
  private readonly compiledExpressions = new BoundedLruCache<string, CompiledExpression | null>(
    MAX_COMPILED_EXPRESSIONS,
  );

  evaluate(input: DatatypeInvariantInput): ValidationIssue[] {
    const plan = this.getPlan(input.structureDef);
    if (plan.length === 0) return [];

    const issues: ValidationIssue[] = [];
    for (const entry of plan) {
      for (const target of resolveConstraintTargets(input.value, input.basePath, entry.relativeSegments)) {
        if (this.isViolated(entry, target.value, input.fhirVersion)) {
          issues.push(buildDatatypeInvariantIssue(entry.constraint, target.path, input));
        }
      }
    }
    return issues;
  }

  private getPlan(structureDef: StructureDefinition): DatatypeConstraintPlanEntry[] {
    const cached = this.planCache.get(structureDef);
    if (cached) return cached;
    const plan = collectEvaluableConstraints(structureDef);
    this.planCache.set(structureDef, plan);
    return plan;
  }

  private isViolated(
    entry: DatatypeConstraintPlanEntry,
    contextValue: unknown,
    fhirVersion: FhirVersion,
  ): boolean {
    const compiled = this.getCompiled(entry, fhirVersion);
    if (!compiled) return false;
    try {
      const result = compiled(contextValue, {}, { traceFn: () => {} });
      // Non-boolean results mean the expression did not evaluate as an
      // invariant; treat as unevaluated rather than emitting per-element noise.
      return classifyConstraintResult(result).status === 'failed';
    } catch (error) {
      logger.debug(
        '[DatatypeInvariant] Evaluation failed',
        {
          ...validationFailureMetadata(error),
          ...sensitiveValueMetadata(entry.constraint.key, entry.elementPath),
        },
      );
      return false;
    }
  }

  private getCompiled(
    entry: DatatypeConstraintPlanEntry,
    fhirVersion: FhirVersion,
  ): CompiledExpression | null {
    const expression = entry.constraint.expression ?? '';
    const key = `${fhirVersion}|${entry.elementPath}|${expression}`;
    const cached = this.compiledExpressions.get(key);
    if (cached !== undefined) return cached;

    let compiled: CompiledExpression | null = null;
    try {
      // `base` types the context (e.g. Range.low as Quantity) so operators
      // like `low <= high` use FHIR Quantity semantics instead of raw JS.
      compiled = fhirpath.compile(
        { base: entry.elementPath, expression: rewriteCollectionTypeOperators(expression) },
        getFhirPathModel(fhirVersion),
        { async: false },
      ) as CompiledExpression;
    } catch (error) {
      logger.debug(
        '[DatatypeInvariant] Compile failed',
        {
          ...validationFailureMetadata(error),
          ...sensitiveValueMetadata(entry.constraint.key, entry.elementPath),
        },
      );
    }
    this.compiledExpressions.set(key, compiled);
    return compiled;
  }
}

function collectEvaluableConstraints(structureDef: StructureDefinition): DatatypeConstraintPlanEntry[] {
  const elements = structureDef.snapshot?.element ?? [];
  const rootPath = elements[0]?.path;
  if (!rootPath || rootPath.includes('.')) return [];

  const plan: DatatypeConstraintPlanEntry[] = [];
  for (const element of elements) {
    if (!element.constraint?.length) continue;
    if (element.path !== rootPath && !element.path.startsWith(`${rootPath}.`)) continue;
    const relativeSegments = element.path === rootPath
      ? []
      : element.path.slice(rootPath.length + 1).split('.');
    // Choice landing points would need per-type context resolution.
    if (relativeSegments.some(segment => segment.includes('[x]'))) continue;

    for (const constraint of element.constraint) {
      if (isEvaluableConstraint(constraint)) {
        plan.push({ elementPath: element.path, relativeSegments, constraint });
      }
    }
  }
  return plan;
}

function isEvaluableConstraint(constraint: Constraint): boolean {
  if (!constraint.expression) return false;
  // Warning rows stay out of scope, matching the generic executor's stance.
  if (constraint.severity !== 'error') return false;
  if (DATATYPE_CONSTRAINT_OWNERS[constraint.key]) return false;
  // Covers ele-1 / ext-1 / ref-1 — each has a dedicated JS reporter.
  if (InvariantRegistry.isSpecialised(constraint.key)) return false;
  return !UNSUPPORTED_EXPRESSION_FEATURES.some(feature => constraint.expression!.includes(feature));
}

function resolveConstraintTargets(
  value: Record<string, unknown>,
  basePath: string,
  segments: string[],
): ConstraintTarget[] {
  let targets: ConstraintTarget[] = [{ value, path: basePath }];
  for (const segment of segments) {
    const next: ConstraintTarget[] = [];
    for (const target of targets) {
      if (!isRecord(target.value)) continue;
      const child = target.value[segment];
      if (child === undefined || child === null) continue;
      if (Array.isArray(child)) {
        child.forEach((item, index) => {
          if (item !== undefined && item !== null) {
            next.push({ value: item, path: `${target.path}.${segment}[${index}]` });
          }
        });
      } else {
        next.push({ value: child, path: `${target.path}.${segment}` });
      }
    }
    targets = next;
    if (targets.length === 0) break;
  }
  return targets;
}

function buildDatatypeInvariantIssue(
  constraint: Constraint,
  path: string,
  input: DatatypeInvariantInput,
): ValidationIssue {
  return createValidationIssue({
    code: 'profile-constraint-violation',
    path,
    resourceType: rootResourceTypeFromPath(input.basePath, input.structureDef.type ?? 'Element'),
    profile: input.profileUrl || undefined,
    customMessage: `Constraint '${constraint.key}' failed: ${constraint.human}`,
    severityOverride: 'error',
    ruleId: constraint.key,
    details: {
      expression: constraint.expression,
      constraintKey: constraint.key,
      originalSeverity: constraint.severity,
    },
  });
}

function rootResourceTypeFromPath(basePath: string, fallback: string): string {
  const rootSegment = basePath.split('.')[0]?.replace(/\[\d+\]$/, '');
  return rootSegment && /^[A-Z]/.test(rootSegment) ? rootSegment : fallback;
}
