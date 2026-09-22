import type { Constraint } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { CollectedConstraint } from './sd-constraint-collector.js';
import type { MatchedElement } from './sd-element-matcher.js';
import { handleSDFHIRPathEvaluationFailure } from './sd-fhirpath-evaluation-failure.js';
import {
  SDFHIRPathEvaluationPlanFactory,
  type SDFHIRPathEvaluationPlan,
} from './sd-fhirpath-evaluation-plans.js';
import type { SDFHIRPathEvaluationScope } from './sd-fhirpath-evaluation-scope.js';
import { SDFHIRPathExpressionCache } from './sd-fhirpath-expression-cache.js';
import { SDFHIRPathExpressionRuntime } from './sd-fhirpath-expression-runtime.js';
import type { ValueSetCache } from './valueset-cache.js';

export type { SDFHIRPathEvaluationScope } from './sd-fhirpath-evaluation-scope.js';

export class SDFHIRPathConstraintEvaluator {
  private readonly evaluationPlans = new SDFHIRPathEvaluationPlanFactory();
  private readonly expressionRuntime: SDFHIRPathExpressionRuntime;

  constructor(
    valueSetCache: ValueSetCache,
    expressionCache: SDFHIRPathExpressionCache = new SDFHIRPathExpressionCache(),
  ) {
    this.expressionRuntime = new SDFHIRPathExpressionRuntime(valueSetCache, expressionCache);
  }

  async evaluateMatchedConstraint(
    matched: MatchedElement,
    constraint: Constraint,
    scope: SDFHIRPathEvaluationScope,
  ): Promise<ValidationIssue[]> {
    const plan = this.evaluationPlans.createMatchedPlan(matched, constraint, scope);
    if (plan.immediateIssues) return plan.immediateIssues;

    try {
      return await this.evaluatePlan(plan);
    } catch (error: unknown) {
      return handleSDFHIRPathEvaluationFailure({
        constraint,
        error,
        path: matched.resourcePath,
        phase: 'matched',
        profileUrl: scope.profileUrl,
        resourceType: scope.resourceType,
      });
    }
  }

  async evaluateCollectedConstraint(
    collected: CollectedConstraint,
    scope: SDFHIRPathEvaluationScope,
  ): Promise<ValidationIssue[]> {
    const plan = this.evaluationPlans.createCollectedPlan(collected, scope);
    if (plan.immediateIssues) return plan.immediateIssues;

    try {
      return await this.evaluatePlan(plan);
    } catch (error: unknown) {
      return handleSDFHIRPathEvaluationFailure({
        constraint: collected.constraint,
        error,
        path: collected.elementPath,
        phase: 'collected',
        profileUrl: scope.profileUrl,
        resourceType: scope.resourceType,
      });
    }
  }

  private async evaluatePlan(plan: SDFHIRPathEvaluationPlan): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    for (const target of plan.resolveTargets()) {
      issues.push(...await this.expressionRuntime.evaluateTarget(target));
    }
    return issues;
  }
}
