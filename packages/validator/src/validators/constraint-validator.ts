/**
 * Constraint Validator
 *
 * Validates FHIRPath constraints (invariants) defined in StructureDefinitions
 * Uses fhirpath.js for expression evaluation
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { ElementDefinition, Constraint } from '../core/structure-definition-types';
import { getValidationTargets } from '../business-rules';
import { logger } from '../logger';
import { buildUserInvocationTable } from './fhirpath-custom-functions';
import { getSDFHIRPathCacheStats } from './sd-fhirpath-executor';
import { preprocessTypeLiterals, resolveElementType } from './fhirpath-type-preprocessor';
import {
  clearConstraintExpressionCache,
  getConstraintExpressionCacheStats,
  getOrCompileFHIRPathExpression,
} from './constraint-expression-cache';
import { validateDom3Constraint } from './constraint-dom-rules';
import { elementExistsInResource, hasEmptyBackboneElement } from './constraint-path-utils';
import { targetMatchesSliceDefinition } from './constraint-slice-targets';
import { expressionStartsAtResourceRoot } from './constraint-choice-context';
import { resolveConstraintContext } from './constraint-context-resolver';
import { evaluateSimpleMemberOfExists, evaluateTrailingMemberOf } from './fhirpath-memberof-precheck';
import { ValueSetPackageLoader } from './valueset-package-loader';


export class ConstraintValidator {
  private timeout: number = 2000; // 2 seconds timeout per expression

  private strictnessMode: 'compatibility' | 'standard' | 'strict' = 'standard';
  private fhirVersion: 'R4' | 'R5' | 'R6' = 'R4';
  private cachedUserInvocationTable: any = null;
  private memberOfValueSetLoader = new ValueSetPackageLoader();
  async validate(
    resource: any,
    elements: ElementDefinition[],
    profileUrl: string,
    options?: { strictMode?: boolean; fhirVersion?: 'R4' | 'R5' | 'R6' }
  ): Promise<ValidationIssue[]> {
    // Set strictness mode based on options
    this.strictnessMode = options?.strictMode ? 'strict' : 'standard';
    this.fhirVersion = options?.fhirVersion || 'R4';
    const issues: ValidationIssue[] = [];

    // Build user invocation table once per validate() call (not per constraint)
    this.cachedUserInvocationTable = buildUserInvocationTable(resource);

    this.logRootCoreConstraints(resource, elements);

    // Collect all constraints from all elements
    for (const element of elements) {
      if (element.constraint && element.constraint.length > 0) {
        // Check if this is a root element constraint (e.g., "Patient" - applies to entire resource)
        const isRootElement = element.path === resource.resourceType;

        // Check if element exists for non-root elements
        let elementExists = true;
        if (!isRootElement) {
          const isOptional = (element.min === undefined || element.min === 0);
          elementExists = elementExistsInResource(resource, element.path);

          // Special handling for backbone elements (like Patient.contact)
          // Even if the element "exists" as an empty object/array, we should still
          // evaluate constraints on it to catch violations like PAT-1
          const isBackboneElement = element.type?.some(t =>
            t.code === 'BackboneElement' || t.code === 'Element'
          );

          if (isOptional && !elementExists && !isBackboneElement) {
            // Skip validation for missing optional fields to avoid "ghost" errors
            continue;
          }

          // For backbone elements, check if they exist but are empty
          // If so, we should still evaluate constraints
          if (isBackboneElement && !elementExists) {
            // Check if the backbone element exists as an empty array or with empty objects
            const backboneExists = hasEmptyBackboneElement(resource, element.path);
            if (!backboneExists) {
              continue;
            }
            elementExists = true; // Mark as existing for constraint evaluation
          }

          // Per-element logging removed for performance
        } else {
          // Always evaluate root element constraints (dom-2, dom-3, dom-4, dom-5, dom-6, etc.)
        }

        // Resolve the element's declared type once per element so
        // validateConstraint can pre-substitute `%context.type()` literals.
        const elementType = resolveElementType(element as any);

        for (const constraint of element.constraint) {
          if (this.shouldSkipGenericConstraint(constraint)) continue;

          // Absolute FHIRPath roots (`Patient...`, `Observation...`) must be
          // evaluated from the resource root even when the constraint is
          // attached to a nested element. Evaluating once also avoids one
          // duplicate issue per array item.
          if (expressionStartsAtResourceRoot(constraint.expression, resource.resourceType)) {
            const constraintIssues = await this.validateConstraint(
              resource,
              element.path,
              constraint,
              profileUrl,
              elementType,
            );
            issues.push(...constraintIssues);
            continue;
          }

          // Get validation targets to handle array elements (e.g., Patient.link[0].other, Patient.link[1].other)
          const validationTargets = getValidationTargets(resource, element.path);

          if (validationTargets.length === 0) {
            if (!isRootElement && !elementExists) {
              continue;
            }

            // No targets found, validate with original path (for backward compatibility)
            const constraintIssues = await this.validateConstraint(
              resource,
              element.path,
              constraint,
              profileUrl,
              elementType,
            );

            issues.push(...constraintIssues);
          } else {
            // Validate constraint for each array element separately
            for (const target of validationTargets) {
              if (!targetMatchesSliceDefinition(target.value, element, elements)) {
                continue;
              }
              const constraintIssues = await this.validateConstraint(
                resource,
                target.fullPath,
                constraint,
                profileUrl,
                elementType,
              );

              issues.push(...constraintIssues);
            }
          }
        }
      }
    }

    return issues;
  }

  private logRootCoreConstraints(resource: any, elements: ElementDefinition[]): void {
    const rootElement = elements.find(el => el.path === resource.resourceType);
    if (!rootElement?.constraint) return;

    const coreConstraints = ['dom-2', 'dom-3', 'dom-4', 'dom-5', 'dom-6'];
    const foundCoreConstraints = rootElement.constraint.filter(c => coreConstraints.includes(c.key));
    logger.debug(
      `[ConstraintValidator] Found ${foundCoreConstraints.length} core constraints on ${resource.resourceType}: ` +
      foundCoreConstraints.map(c => c.key).join(', ')
    );
  }

  /**
   * Validate a single FHIRPath constraint
   */
  private async validateConstraint(
    resource: any,
    elementPath: string,
    constraint: Constraint,
    profileUrl: string,
    elementType: string | null = null,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Skip if no expression
    if (!constraint.expression) {
      return issues;
    }

    if (constraint.key === 'dom-3') {
      return validateDom3Constraint(resource, elementPath, constraint, profileUrl);
    }

    // Pre-substitute `%context.type().name` / `%resource.type().name` /
    // `%rootResource.type().name` literals with booleans derived from SD
    // type info. fhirpath.js can't resolve `.type()` on raw JS values —
    // without this, cont-1/2/3 on DomainResource.contained silently pass.
    const preprocessedExpression = preprocessTypeLiterals(constraint.expression, {
      elementType,
      resourceType: resource.resourceType,
      rootResourceType: resource.resourceType,
    });

    try {
      const memberOfPassed = await evaluateSimpleMemberOfExists(
        preprocessedExpression,
        resource,
        resource.resourceType,
        this.memberOfValueSetLoader,
        this.fhirVersion,
      );
      if (memberOfPassed !== null) {
        if (!memberOfPassed) {
          issues.push(this.buildConstraintViolationIssue(resource, elementPath, constraint, profileUrl));
        }
        return issues;
      }

      // Boolean `<prefix>.memberOf('<ValueSet>')` constraints: fhirpath.js only
      // offers memberOf as async, which our sync path rejects. Evaluate the
      // prefix synchronously and apply the shared sync memberOf logic.
      const trailingMemberOf = evaluateTrailingMemberOf(
        preprocessedExpression,
        resource,
        this.fhirVersion,
      );
      if (trailingMemberOf !== null) {
        if (!trailingMemberOf) {
          issues.push(this.buildConstraintViolationIssue(resource, elementPath, constraint, profileUrl));
        }
        return issues;
      }

      const { context: evaluationContext, expression } =
        resolveConstraintContext(resource, elementPath, preprocessedExpression);

      // Evaluate FHIRPath expression with the appropriate context
      const result = await this.evaluateFHIRPath(
        evaluationContext,
        expression,
        resource  // Pass root resource for %rootResource access
      );

      // Check result (should be true or non-empty)
      const passed = this.checkConstraintResult(result);

      // Log constraint evaluation result
      const isRootConstraint = elementPath === resource.resourceType;
      if (isRootConstraint) {
        logger.debug(`[ConstraintValidator] Root constraint ${constraint.key} result: ${passed ? 'PASSED' : 'FAILED'} (expression: ${constraint.expression})`);
      }

      if (!passed) {
        issues.push(this.buildConstraintViolationIssue(resource, elementPath, constraint, profileUrl));
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Silently skip constraints that use unsupported FHIRPath functions (memberOf, resolve, etc.)
      // These can't be evaluated client-side and should not produce false-positive issues.
      if (
        errorMsg.includes('asynchronous function') ||
        errorMsg.includes('is not allowed') ||
        isUnsupportedEngineCapabilityError(errorMsg)
      ) {
        logger.debug(`[ConstraintValidator] Skipping constraint ${constraint.key} (unsupported FHIRPath function): ${errorMsg}`);
        return issues;
      }

      // Other FHIRPath evaluation errors — log and report as information,
      // not warning. These are diagnostics about the engine's own
      // limitations (e.g. unsupported `as` operator on non-singletons),
      // not clinical issues with the resource. Java silently skips
      // constraints it can't evaluate; Records should not penalize
      // the resource for its own FHIRPath evaluation gaps.
      logger.warn(`[ConstraintValidator] Error evaluating constraint ${constraint.key}:`, error);

      issues.push(createValidationIssue({
        code: 'profile-constraint-evaluation-error',
        path: elementPath,
        resourceType: resource.resourceType,
        profile: profileUrl,
        customMessage: `Failed to evaluate constraint '${constraint.key}': ${errorMsg}`,
        severityOverride: 'information',
        details: {
          expression: constraint.expression,
          evaluationError: errorMsg,
          constraintKey: constraint.key,
        },
      }));
    }

    return issues;
  }

  private shouldSkipGenericConstraint(constraint: Constraint): boolean {
    return constraint.key === 'con-3' || constraint.key === 'ext-1' || constraint.key === 'ele-1';
  }

  private buildConstraintViolationIssue(
    resource: any,
    elementPath: string,
    constraint: Constraint,
    profileUrl: string,
  ): ValidationIssue {
    const escalateToError = this.strictnessMode === 'strict' && constraint.severity === 'warning';
    const isDomConstraint = constraint.key?.startsWith('dom-');
    const isDom6 = constraint.key === 'dom-6';
    const isWarningConstraint = constraint.severity === 'warning' && !escalateToError;
    const shouldDemoteToInfo = (isWarningConstraint && !isDomConstraint) || (isDom6 && this.strictnessMode !== 'strict');
    const issueCode = isDom6
      ? 'dom-6'
      : ((isWarningConstraint && (!isDomConstraint || (isDom6 && shouldDemoteToInfo)))
        ? 'profile-constraint-warning'
        : 'profile-constraint-violation');
    const issuePath = isDom6 ? `${elementPath.replace(/\.$/, '')}.text` : elementPath;
    const escalationNote = escalateToError ? ' [escalated from warning in strict mode]' : '';
    const severityOverride = isDom6
      ? (escalateToError ? 'error' : 'info')
      : (shouldDemoteToInfo ? 'info' : undefined);

    return createValidationIssue({
      code: issueCode,
      path: issuePath,
      resourceType: resource.resourceType,
      profile: profileUrl,
      customMessage: isDom6
        ? `${constraint.human}${escalationNote}`
        : `Constraint '${constraint.key}' failed: ${constraint.human}${escalationNote}`,
      ruleId: constraint.key,
      details: {
        expression: constraint.expression,
        constraintKey: constraint.key,
        originalSeverity: constraint.severity,
        escalated: escalateToError
      },
      severityOverride
    });
  }

  private evaluateFHIRPath(
    context: any,
    expression: string,
    rootResource?: any
  ): any {
    // Use compiled expression cache — avoids re-parsing on every call
    const compiled = getOrCompileFHIRPathExpression(expression, this.fhirVersion);

    // Evaluate compiled expression synchronously (fhirpath.js is sync;
    // wrapping in Promise + setTimeout was dead code — a setTimeout
    // callback cannot interrupt a synchronous call on the same thread)
    return compiled(
      context,
      {
        resource: rootResource || context,
        rootResource: rootResource || context,
        userInvocationTable: this.cachedUserInvocationTable,
      },
      { traceFn: () => { } },
    );
  }

  /** Check if FHIRPath constraint result indicates success */
  private checkConstraintResult(result: any): boolean {
    if (result === true) return true;
    if (result === false) return false;
    if (Array.isArray(result)) {
      // Empty result = constraint is vacuously satisfied. FHIRPath propagates
      // empty through non-Boolean functions (contains, not, matches) when the
      // element being checked is absent. FHIR spec: "If there is no value,
      // the constraint is satisfied." Matches HAPI behaviour.
      if (result.length === 0) return true;
      if (result.every(item => typeof item === 'boolean')) {
        return result.every(Boolean);
      }
      return result.some(item => item === true || (item !== false && item != null));
    }
    if (result === null || result === undefined) return false;
    if (typeof result === 'number') return result !== 0;
    if (typeof result === 'string') return result.length > 0;
    return true;
  }

  setTimeout(timeout: number): void {
    this.timeout = timeout;
  }

  static getCacheStats(): { hits: number; misses: number; compileErrors: number; hitRate: string; size: number } {
    return getConstraintExpressionCacheStats();
  }

  static clearCache(): void {
    clearConstraintExpressionCache();
  }
}

function isUnsupportedEngineCapabilityError(message: string): boolean {
  return message.includes('Not implemented: htmlChecks');
}

export function getFHIRPathCacheStats() {
  return ConstraintValidator.getCacheStats();
}

export function clearFHIRPathCache() {
  ConstraintValidator.clearCache();
}

/**
 * Get combined FHIRPath cache stats from both ConstraintValidator and SDFHIRPathExecutor.
 * Returns per-cache and aggregate hit rates.
 */
export function getCombinedFHIRPathCacheStats() {
  const constraint = getConstraintExpressionCacheStats();
  const sd = getSDFHIRPathCacheStats();
  const totalHits = constraint.hits + sd.hits;
  const totalMisses = constraint.misses + sd.misses;
  const compileErrors = constraint.compileErrors + sd.compileErrors;
  const total = totalHits + totalMisses;
  return {
    constraint,
    sdExecutor: sd,
    combined: {
      hits: totalHits,
      misses: totalMisses,
      compileErrors,
      hitRate: total > 0 ? ((totalHits / total) * 100).toFixed(1) + '%' : '0%',
      size: constraint.size + sd.size,
    },
  };
}
