import type { Constraint } from '../core/structure-definition-types.js';
import { isFhirResource } from '../core/fhir-resource.js';
import { expressionStartsAtResourceRoot } from './constraint-choice-context.js';
import {
  preprocessTypeLiterals,
  resolveElementType,
  resolveTypeLiteralContext,
  type PreprocessContext,
} from './fhirpath-type-preprocessor.js';
import { InvariantRegistry } from './invariant-registry.js';
import type { MatchedElement } from './sd-element-matcher.js';
import {
  deriveChoiceTypeFromConcretePath,
  resolveChoiceTypeCast,
} from './sd-fhirpath-choice-utils.js';
import type { SDFHIRPathEvaluationPlan } from './sd-fhirpath-evaluation-plan.js';
import type { SDFHIRPathEvaluationScope } from './sd-fhirpath-evaluation-scope.js';

const EMPTY_PLAN: SDFHIRPathEvaluationPlan = {
  immediateIssues: [],
  resolveTargets: () => [],
};

function resolveMatchedTypeLiteralContext(
  matched: MatchedElement,
  scope: SDFHIRPathEvaluationScope,
  declaredElementType: string | null,
): PreprocessContext {
  const outerRoot = isFhirResource(scope.rootResource) ? scope.rootResource : undefined;
  const scopedResource = isFhirResource(scope.resource) ? scope.resource : undefined;
  const resolutionRoot = [scopedResource, outerRoot].find(candidate => (
    candidate && (
      matched.resourcePath === candidate.resourceType
      || matched.resourcePath.startsWith(`${candidate.resourceType}.`)
    )
  ));

  if (!resolutionRoot) {
    return {
      elementType: declaredElementType,
      resourceType: scopedResource?.resourceType ?? scope.resourceType,
      rootResourceType:
        outerRoot?.resourceType ?? scopedResource?.resourceType ?? scope.resourceType,
    };
  }

  const resolved = resolveTypeLiteralContext(
    resolutionRoot,
    matched.resourcePath,
    declaredElementType,
    scope.fhirVersion,
  );
  return {
    ...resolved,
    rootResourceType: outerRoot?.resourceType ?? resolved.rootResourceType,
  };
}

export class SDFHIRPathMatchedEvaluationPlanBuilder {
  build(
    matched: MatchedElement,
    constraint: Constraint,
    scope: SDFHIRPathEvaluationScope,
  ): SDFHIRPathEvaluationPlan {
    if (!constraint.expression || InvariantRegistry.isSpecialised(constraint.key)) {
      return EMPTY_PLAN;
    }

    const declaredElementType = resolveElementType(matched.element)
      ?? deriveChoiceTypeFromConcretePath(matched);
    const typeLiteralContext = resolveMatchedTypeLiteralContext(
      matched,
      scope,
      declaredElementType,
    );
    const effectiveExpression = preprocessTypeLiterals(
      constraint.expression,
      typeLiteralContext,
    );
    const choiceCast = resolveChoiceTypeCast(effectiveExpression, matched);
    if (choiceCast.skip) return EMPTY_PLAN;

    const evaluationContext = expressionStartsAtResourceRoot(
      choiceCast.expression,
      scope.resourceType,
    ) ? scope.resource : matched.data;

    return {
      resolveTargets: () => [{
        constraint,
        expression: choiceCast.expression,
        context: evaluationContext,
        rootResource: scope.rootResource,
        resolveRootResource: scope.resource,
        path: matched.resourcePath,
        resourceType: scope.resourceType,
        userInvocationTable: scope.userInvocationTable,
        profileUrl: scope.profileUrl,
        fhirVersion: scope.fhirVersion,
        bundle: scope.bundle,
        terminologyResolver: scope.terminologyResolver,
      }],
    };
  }
}
