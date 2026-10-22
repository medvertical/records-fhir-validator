import type { Constraint } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { appendHtmlChecksConstraintIssues } from './fhirpath-html-checks.js';
import {
  evaluateSimpleMemberOfExists,
  evaluateCachedMemberOf,
  rewriteLegacyValueSetInExists,
} from './fhirpath-memberof-precheck.js';
import { evaluateResolveExistsConstraint } from './fhirpath-resolve-precheck.js';
import { constraintPassed } from './sd-fhirpath-result-utils.js';
import { choiceElementsAt, prepareElementContext, typeChoiceContext } from './sd-fhirpath-choice-utils.js';
import { createConstraintViolation } from './sd-fhirpath-issue-factory.js';
import type { ValueSetPackageLoader } from './valueset-package-loader.js';
import type { FHIRPathBundleInput } from './fhirpath-functions.js';
import type { FHIRPathTerminologyResolver } from './fhirpath-async-terminology.js';
import type { ValueSetCache } from './valueset-cache.js';
import type { SynchronousFHIRPathExpressionCache } from './constraint-expression-cache.js';
import type { ReferenceResolver } from './slice-types.js';

type FhirVersion = 'R4' | 'R5' | 'R6';

export interface ConstraintTargetEvaluation {
  constraint: Constraint;
  expression: string;
  context: unknown;
  rootResource: unknown;
  /** %resource: the resource containing the node, when it is not the root. */
  focusResource?: unknown;
  resolveRootResource: unknown;
  path: string;
  resourceType: string;
  userInvocationTable: unknown;
  profileUrl?: string;
  fhirVersion: FhirVersion;
  bundle?: FHIRPathBundleInput;
  referenceResolver?: ReferenceResolver | null;
  checkHtml?: boolean;
  memberOfValueSetLoader: ValueSetPackageLoader;
  valueSetCache: ValueSetCache;
  expressionCache: SynchronousFHIRPathExpressionCache;
  terminologyResolver?: FHIRPathTerminologyResolver;
  evaluateExpression(
    expression: string,
    context: unknown,
    rootResource: unknown,
    userInvocationTable: unknown,
    fhirVersion: FhirVersion,
    terminologyResolver?: FHIRPathTerminologyResolver,
    focusResource?: unknown,
  ): unknown | Promise<unknown>;
}

export async function evaluateConstraintTarget(
  target: ConstraintTargetEvaluation,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (appendHtmlIssues(target, issues)) return issues;

  // Local prechecks must not override the configured resolver's stores or policy.
  const memberOfPassed = target.terminologyResolver ? null : await evaluateSimpleMemberOfExists(
    target.expression,
    target.context,
    target.resourceType,
    target.memberOfValueSetLoader,
    target.fhirVersion,
    Boolean(target.terminologyResolver),
  );
  if (memberOfPassed !== null) {
    return resultIssues(target, memberOfPassed);
  }

  const cachedMemberOf = target.terminologyResolver
    ? null
    : await evaluateCachedMemberOf(
      target.expression,
      prepareElementContext(target.context, target.expression, choiceElementsAt(target.path, target.fhirVersion)),
      target.valueSetCache,
      target.memberOfValueSetLoader,
      target.fhirVersion,
      Boolean(target.terminologyResolver),
      target.expressionCache,
    );
  if (cachedMemberOf !== null) {
    return resultIssues(target, cachedMemberOf);
  }

  const resolveExists = evaluateResolveExistsConstraint({
    expression: target.expression,
    context: target.context,
    rootResource: target.resolveRootResource,
    fhirVersion: target.fhirVersion,
    bundle: target.bundle,
    expressionCache: target.expressionCache,
    referenceResolver: target.referenceResolver,
  });
  if (resolveExists !== null) {
    return resultIssues(target, resolveExists);
  }

  const result = await target.evaluateExpression(
    target.terminologyResolver
      ? rewriteLegacyValueSetInExists(target.expression)
      : target.expression,
    prepareElementContext(
      typeChoiceContext(target.context, target.expression, target.path, target.fhirVersion),
      target.expression,
      choiceElementsAt(target.path, target.fhirVersion),
    ),
    target.rootResource,
    target.userInvocationTable,
    target.fhirVersion,
    target.terminologyResolver,
    target.focusResource,
  );
  return resultIssues(target, constraintPassed(result));
}

function appendHtmlIssues(
  target: ConstraintTargetEvaluation,
  issues: ValidationIssue[],
): boolean {
  return target.checkHtml !== false && appendHtmlChecksConstraintIssues(
    issues,
    target.expression,
    target.context,
    target.path,
    target.resourceType,
    target.profileUrl,
    target.constraint.key,
  );
}

function resultIssues(
  target: ConstraintTargetEvaluation,
  passed: boolean,
): ValidationIssue[] {
  return passed
    ? []
    : [createConstraintViolation(
      target.constraint,
      target.path,
      target.resourceType,
      target.profileUrl,
    )];
}
