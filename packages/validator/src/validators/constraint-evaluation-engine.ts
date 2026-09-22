import type { Constraint } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { evaluateConstraintFHIRPath } from './constraint-fhirpath-evaluator.js';
import { prepareConstraintEvaluation } from './constraint-evaluation-preparation.js';
import { ConstraintEvaluationPrecheckPipeline } from './constraint-evaluation-precheck-pipeline.js';
import { resolveEvaluatedConstraintOutcome } from './constraint-evaluation-outcome.js';
import {
  FHIRPathConstraintDiagnosticTracker,
  type FHIRPathConstraintDiagnostics,
} from './fhirpath-constraint-diagnostics.js';
import {
  AsyncFHIRPathTerminologyCache,
  type FHIRPathTerminologyResolver,
} from './fhirpath-async-terminology.js';
import type { ConstraintValidationState, FhirResource } from './constraint-validation-input.js';
import { ValueSetCache } from './valueset-cache.js';
import { ConstraintExpressionCache } from './constraint-expression-cache.js';
import { handleConstraintEvaluationFailure } from './constraint-evaluation-failure.js';

type ConstraintFHIRPathEvaluator = typeof evaluateConstraintFHIRPath;

export class ConstraintEvaluationEngine {
  private readonly prechecks: ConstraintEvaluationPrecheckPipeline;
  private readonly diagnosticTracker = new FHIRPathConstraintDiagnosticTracker();
  private readonly asyncExpressionCache = new AsyncFHIRPathTerminologyCache();

  constructor(
    private readonly terminologyResolver?: FHIRPathTerminologyResolver,
    private readonly evaluateFHIRPath: ConstraintFHIRPathEvaluator = evaluateConstraintFHIRPath,
    valueSetCache: ValueSetCache = new ValueSetCache(),
    private readonly expressionCache: ConstraintExpressionCache = new ConstraintExpressionCache(),
  ) {
    this.prechecks = new ConstraintEvaluationPrecheckPipeline(valueSetCache, expressionCache);
  }

  async evaluate(
    resource: FhirResource,
    elementPath: string,
    constraint: Constraint,
    profileUrl: string,
    elementType: string | null,
    state: ConstraintValidationState,
  ): Promise<ValidationIssue[]> {
    const preparation = prepareConstraintEvaluation({
      resource,
      elementPath,
      constraint,
      profileUrl,
      elementType,
      state,
    });
    if (preparation.handled) return preparation.issues;

    try {
      return await this.evaluatePreparedExpression(
        resource, elementPath, constraint, profileUrl, preparation.expression, state,
      );
    } catch (error) {
      return handleConstraintEvaluationFailure({
        constraint,
        diagnosticTracker: this.diagnosticTracker,
        elementPath,
        error,
        profileUrl,
        resourceType: resource.resourceType,
      });
    }
  }

  getDiagnostics(): FHIRPathConstraintDiagnostics {
    return this.diagnosticTracker.get();
  }

  clearDiagnostics(): void {
    this.diagnosticTracker.clear();
  }

  getExpressionCacheStats(): ReturnType<ConstraintExpressionCache['getStats']> {
    return this.expressionCache.getStats();
  }

  clearExpressionCache(): void {
    this.expressionCache.clear();
  }

  private async evaluatePreparedExpression(
    resource: FhirResource,
    elementPath: string,
    constraint: Constraint,
    profileUrl: string,
    preprocessedExpression: string,
    state: ConstraintValidationState,
  ): Promise<ValidationIssue[]> {
    const precheck = await this.prechecks.evaluate({
      resource,
      elementPath,
      constraint,
      profileUrl,
      expression: preprocessedExpression,
      state,
      terminologyResolverConfigured: Boolean(this.terminologyResolver),
    });
    if (precheck.handled) return precheck.issues;

    const result = await this.evaluateFHIRPath(
      precheck.context,
      precheck.expression,
      state.rootResource ?? resource,
      state.fhirVersion,
      state.userInvocationTable,
      this.terminologyResolver,
      this.expressionCache,
      this.asyncExpressionCache,
    );
    return resolveEvaluatedConstraintOutcome(result, {
      constraint,
      elementPath,
      profileUrl,
      resource,
      strictnessMode: state.strictnessMode,
    });
  }
}
