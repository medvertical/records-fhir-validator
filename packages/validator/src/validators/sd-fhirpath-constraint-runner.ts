import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { expressionStartsAtResourceRoot } from './constraint-choice-context.js';
import { SDConstraintCollector } from './sd-constraint-collector.js';
import type { MatchResult } from './sd-element-matcher.js';
import {
  SDFHIRPathConstraintEvaluator,
  type SDFHIRPathEvaluationScope,
} from './sd-fhirpath-constraint-evaluator.js';
import { SDFHIRPathExpressionCache } from './sd-fhirpath-expression-cache.js';
import { ValueSetCache } from './valueset-cache.js';

export class SDFHIRPathConstraintRunner {
  private readonly constraintEvaluator: SDFHIRPathConstraintEvaluator;

  constructor(
    valueSetCache: ValueSetCache = new ValueSetCache(),
    private readonly expressionCache: SDFHIRPathExpressionCache = new SDFHIRPathExpressionCache(),
    private readonly constraintCollector: SDConstraintCollector = new SDConstraintCollector(),
  ) {
    this.constraintEvaluator = new SDFHIRPathConstraintEvaluator(
      valueSetCache,
      expressionCache,
    );
  }

  async evaluate(
    matchResult: MatchResult,
    structureDef: StructureDefinition,
    resource: unknown,
    resourceType: string,
    evaluationScope: SDFHIRPathEvaluationScope,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    const rootExpressionConstraints = new Set<string>();
    for (const matched of matchResult.constraintElements) {
      if (matched.element?.path === resourceType) {
        continue;
      }

      for (const constraint of matched.element.constraint || []) {
        if (expressionStartsAtResourceRoot(constraint.expression, resourceType)) {
          const key = `${matched.element?.id ?? matched.element?.path ?? matched.resourcePath}|${constraint.key}|${constraint.expression}`;
          if (rootExpressionConstraints.has(key)) {
            continue;
          }
          rootExpressionConstraints.add(key);
        }

        const constraintIssues = await this.constraintEvaluator.evaluateMatchedConstraint(
          matched,
          constraint,
          evaluationScope,
        );
        issues.push(...constraintIssues);
      }
    }

    const mandatoryConstraints = this.constraintCollector.getMandatoryConstraints(
      structureDef,
      resource,
    );
    for (const collected of mandatoryConstraints) {
      if (!collected.isRootConstraint) continue;

      const constraintIssues = await this.constraintEvaluator.evaluateCollectedConstraint(
        collected,
        evaluationScope,
      );
      issues.push(...constraintIssues);
    }

    return issues;
  }

  getExpressionCacheStats(): ReturnType<SDFHIRPathExpressionCache['getStats']> {
    return this.expressionCache.getStats();
  }

  clearExpressionCache(): void {
    this.expressionCache.clear();
  }
}
