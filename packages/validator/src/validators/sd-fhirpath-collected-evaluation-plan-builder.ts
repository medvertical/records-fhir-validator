import { ElementContextResolver } from './element-context-resolver.js';
import { preprocessTypeLiterals } from './fhirpath-type-preprocessor.js';
import { InvariantRegistry } from './invariant-registry.js';
import type { CollectedConstraint } from './sd-constraint-collector.js';
import { getCollectedConstraintTargets } from './sd-fhirpath-constraint-contexts.js';
import type { SDFHIRPathEvaluationPlan } from './sd-fhirpath-evaluation-plan.js';
import type { SDFHIRPathEvaluationScope } from './sd-fhirpath-evaluation-scope.js';
import { createConstraintViolation } from './sd-fhirpath-issue-factory.js';
import { evaluateSpecialisedRootConstraint } from './sd-fhirpath-specialised-root-constraints.js';
import { fixKnownInvariantExpression } from './fhirpath-expression-fixer.js';
import { focusResourceOf } from './sd-fhirpath-focus-resource.js';

const EMPTY_PLAN: SDFHIRPathEvaluationPlan = {
  immediateIssues: [],
  resolveTargets: () => [],
};

export class SDFHIRPathCollectedEvaluationPlanBuilder {
  private readonly elementContextResolver = new ElementContextResolver();

  build(
    collected: CollectedConstraint,
    scope: SDFHIRPathEvaluationScope,
  ): SDFHIRPathEvaluationPlan {
    const { constraint, elementPath, isRootConstraint } = collected;
    if (!constraint.expression || InvariantRegistry.isSpecialised(constraint.key)) {
      return EMPTY_PLAN;
    }

    const specialisedResult = evaluateSpecialisedRootConstraint(
      constraint.key,
      scope.resource,
    );
    if (specialisedResult !== null) {
      return {
        immediateIssues: specialisedResult ? [] : [createConstraintViolation(
          constraint,
          elementPath,
          scope.resourceType,
          scope.profileUrl,
        )],
        resolveTargets: () => [],
      };
    }
    if (collected.sliceName) return EMPTY_PLAN;

    const declaredType = collected.elementTypes.length === 1
      ? collected.elementTypes[0]
      : isRootConstraint ? scope.resourceType : null;
    const expression = preprocessTypeLiterals(
      fixKnownInvariantExpression(constraint.expression, constraint.key, scope.fhirVersion),
      {
        elementType: declaredType,
        resourceType: scope.resourceType,
        rootResourceType: scope.resourceType,
      },
    );

    return {
      resolveTargets: () => getCollectedConstraintTargets(
        scope.resource,
        scope.resourceType,
        elementPath,
        isRootConstraint,
        this.elementContextResolver,
      ).map(target => ({
        constraint,
        expression,
        context: target.context,
        rootResource: scope.rootResource,
        focusResource: scope.focusResource ?? (scope.resource === scope.rootResource ? focusResourceOf(scope.resource, target.path) : undefined),
        resolveRootResource: scope.resource,
        path: target.path,
        resourceType: scope.resourceType,
        userInvocationTable: scope.userInvocationTable,
        profileUrl: scope.profileUrl,
        fhirVersion: scope.fhirVersion,
        bundle: scope.bundle,
        checkHtml: target.checkHtml,
        terminologyResolver: scope.terminologyResolver,
      })),
    };
  }
}
