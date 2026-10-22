import type { Constraint } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { resolveConstraintContext } from './constraint-context-resolver.js';
import type { ConstraintExpressionCache } from './constraint-expression-cache.js';
import { ConstraintMemberOfPrechecks } from './constraint-memberof-prechecks.js';
import type { ConstraintValidationState, FhirResource } from './constraint-validation-input.js';
import { constraintOutcomeIssues } from './constraint-violation-issue.js';
import { appendHtmlChecksConstraintIssues } from './fhirpath-html-checks.js';
import { evaluateResolveExistsConstraint } from './fhirpath-resolve-precheck.js';
import { getEvaluationContext } from './constraint-path-utils.js';
import type { ValueSetCache } from './valueset-cache.js';

export type ConstraintPrecheckResult =
  | { handled: true; issues: ValidationIssue[] }
  | { handled: false; context: unknown; expression: string };

/**
 * Runs deterministic constraint checks before the general FHIRPath engine.
 * The order is significant: each supported shape either owns the outcome or
 * supplies the resolved context and rewritten expression for fallback.
 */
export class ConstraintEvaluationPrecheckPipeline {
  private readonly memberOfPrechecks: ConstraintMemberOfPrechecks;

  constructor(
    valueSetCache: ValueSetCache,
    private readonly expressionCache: ConstraintExpressionCache,
  ) {
    this.memberOfPrechecks = new ConstraintMemberOfPrechecks(
      valueSetCache,
      expressionCache,
    );
  }

  async evaluate({
    resource,
    elementPath,
    constraint,
    profileUrl,
    expression,
    state,
    terminologyResolverConfigured,
  }: {
    resource: FhirResource;
    elementPath: string;
    constraint: Constraint;
    profileUrl: string;
    expression: string;
    state: ConstraintValidationState;
    terminologyResolverConfigured: boolean;
  }): Promise<ConstraintPrecheckResult> {
    const readContext = state.getEvaluationContext ?? (path => getEvaluationContext(resource, path));
    const htmlIssues: ValidationIssue[] = [];
    if (appendHtmlChecksConstraintIssues(
      htmlIssues,
      expression,
      readContext(elementPath),
      elementPath,
      resource.resourceType,
      profileUrl,
      constraint.key,
    )) {
      return { handled: true, issues: htmlIssues };
    }

    const resolvedContext = resolveConstraintContext(resource, elementPath, expression, state.fhirVersion, readContext);
    // A configured resolver owns its package selection and terminology policy.
    const simpleMemberOf = terminologyResolverConfigured ? null : await this.memberOfPrechecks.evaluateSimple(
      resolvedContext.expression,
      resolvedContext.context,
      resource.resourceType,
      state.fhirVersion,
      terminologyResolverConfigured,
    );
    if (simpleMemberOf !== null) {
      return this.outcome(simpleMemberOf, resource, elementPath, constraint, profileUrl, state);
    }

    const cachedMemberOf = terminologyResolverConfigured ? null : await this.memberOfPrechecks.evaluateCached(
      resolvedContext.expression,
      resolvedContext.context,
      state.fhirVersion,
      terminologyResolverConfigured,
    );
    if (cachedMemberOf !== null) {
      return this.outcome(cachedMemberOf, resource, elementPath, constraint, profileUrl, state);
    }

    const resolvableExpression = terminologyResolverConfigured
      ? this.memberOfPrechecks.rewriteLegacyExpression(resolvedContext.expression)
      : resolvedContext.expression;
    const resolveExists = evaluateResolveExistsConstraint({
      expression: resolvedContext.expression,
      context: resolvedContext.context,
      rootResource: state.rootResource ?? resource,
      fhirVersion: state.fhirVersion,
      bundle: state.bundle,
      expressionCache: this.expressionCache,
      referenceResolver: state.referenceResolver,
    });
    if (resolveExists !== null) {
      return this.outcome(resolveExists, resource, elementPath, constraint, profileUrl, state);
    }

    return {
      handled: false,
      context: resolvedContext.context,
      expression: resolvableExpression,
    };
  }

  private outcome(
    passed: boolean,
    resource: FhirResource,
    elementPath: string,
    constraint: Constraint,
    profileUrl: string,
    state: ConstraintValidationState,
  ): ConstraintPrecheckResult {
    return {
      handled: true,
      issues: constraintOutcomeIssues(
        passed,
        resource,
        elementPath,
        constraint,
        profileUrl,
        state.strictnessMode,
      ),
    };
  }
}
