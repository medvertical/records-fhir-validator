/* eslint-disable max-lines */

/**
 * Constraint Validator
 *
 * Validates FHIRPath constraints (invariants) defined in StructureDefinitions
 * Uses fhirpath.js for expression evaluation
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { ElementDefinition, Constraint } from '../core/structure-definition-types';
import fhirpath from 'fhirpath';
import { getValidationTargets } from '../business-rules';
import { getFhirPathModel } from './fhirpath-model-resolver';
import { logger } from '../logger';
import { buildUserInvocationTable } from './fhirpath-custom-functions';
import { getSDFHIRPathCacheStats } from './sd-fhirpath-executor';
import { preprocessTypeLiterals, resolveElementType } from './fhirpath-type-preprocessor';

/** LRU Cache for compiled FHIRPath expressions (version-aware) */
class FHIRPathExpressionCache {
  private cache: Map<string, any> = new Map();
  private maxSize: number = 500;
  private hits: number = 0;
  private misses: number = 0;

  getOrCompile(expression: string, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): any {
    const cacheKey = `${fhirVersion}|${expression}`;
    if (this.cache.has(cacheKey)) {
      this.hits++;
      const compiled = this.cache.get(cacheKey);
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, compiled);
      return compiled;
    }
    this.misses++;
    const compiled = fhirpath.compile(expression, getFhirPathModel(fhirVersion));
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, compiled);
    return compiled;
  }

  getStats(): { hits: number; misses: number; hitRate: string; size: number } {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : '0%';
    return { hits: this.hits, misses: this.misses, hitRate, size: this.cache.size };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

const expressionCache = new FHIRPathExpressionCache();


export class ConstraintValidator {
  private timeout: number = 2000; // 2 seconds timeout per expression

  private strictnessMode: 'compatibility' | 'standard' | 'strict' = 'standard';
  private fhirVersion: 'R4' | 'R5' | 'R6' = 'R4';
  private cachedUserInvocationTable: any = null;
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

    // Log expected core constraints for debugging
    const rootElement = elements.find(el => el.path === resource.resourceType);
    if (rootElement && rootElement.constraint) {
      const coreConstraints = ['dom-2', 'dom-3', 'dom-4', 'dom-5', 'dom-6'];
      const foundCoreConstraints = rootElement.constraint.filter(c => coreConstraints.includes(c.key));
      logger.debug(`[ConstraintValidator] Found ${foundCoreConstraints.length} core constraints on ${resource.resourceType}: ${foundCoreConstraints.map(c => c.key).join(', ')}`);
    }

    // Collect all constraints from all elements
    for (const element of elements) {
      if (element.constraint && element.constraint.length > 0) {
        // Check if this is a root element constraint (e.g., "Patient" - applies to entire resource)
        const isRootElement = element.path === resource.resourceType;

        // Check if element exists for non-root elements
        let elementExists = true;
        if (!isRootElement) {
          const isOptional = (element.min === undefined || element.min === 0);
          elementExists = this.elementExistsInResource(resource, element.path);

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
            const backboneExists = this.hasEmptyBackboneElement(resource, element.path);
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
          // NOTE: we do NOT skip InvariantRegistry-specialised keys
          // here. A naive skip regressed tx/vs-canonical-bad (the
          // generic path was the only one reaching contained.url).
          // Double-reports are handled by dedup in validator-engine.

          // ext-1's FHIRPath expression `extension.exists() != value.exists()`
          // uses polymorphic `value` which fhirpath.js can't resolve on raw JS
          // objects (it needs typed Extension context). The hand-coded checkExt1
          // in complex-type-validator correctly covers all Extension paths.
          if (constraint.key === 'ext-1') continue;

          // ele-1's expression `hasValue() or (children().count() > id.count())`
          // relies on fhirpath's typed `children()` semantics. fhirpath.js can't
          // evaluate that over raw JS objects, so it reports false positives on
          // every sub-element that has children. universal-constraints-validator
          // provides the correct implementation (only truly empty objects).
          // Previously we demoted these to info, which still produced one noise
          // entry per element — skip them outright instead.
          if (constraint.key === 'ele-1') continue;

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
      const { context: evaluationContext, expression } =
        this.resolveConstraintContext(resource, elementPath, preprocessedExpression);

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
        // Determine severity: in strict mode, escalate warnings to errors
        const escalateToError = this.strictnessMode === 'strict' && constraint.severity === 'warning';

        // Determine what should be demoted to info:
        // - Warning-level constraints EXCEPT dom-* (HAPI treats dom-* as errors), unless specifically allowed
        // - dom-6 (narrative) should be INFO unless in strict mode
        // (ele-1 is skipped entirely above — universal-constraints-validator handles it)
        const isDomConstraint = constraint.key?.startsWith('dom-');
        const isDom6 = constraint.key === 'dom-6';
        const isWarningConstraint = constraint.severity === 'warning' && !escalateToError;

        // Allow demotion if:
        // 1. It's a warning AND not a DOM constraint (standard rule)
        // 2. OR it's dom-6 AND we are NOT in strict mode (user requirement)
        const shouldDemoteToInfo = (isWarningConstraint && !isDomConstraint) || (isDom6 && this.strictnessMode !== 'strict');

        // Issue code: dom-* always use 'violation' (HAPI treats them as errors), others use 'warning' if warning-level
        // Exception: dom-6 when demoted should treat as warning/info
        const issueCode = (isWarningConstraint && (!isDomConstraint || (isDom6 && shouldDemoteToInfo)))
          ? 'profile-constraint-warning'
          : 'profile-constraint-violation';

        const escalationNote = escalateToError ? ' [escalated from warning in strict mode]' : '';

        issues.push(createValidationIssue({
          code: issueCode,
          path: elementPath,
          resourceType: resource.resourceType,
          profile: profileUrl,
          customMessage: `Constraint '${constraint.key}' failed: ${constraint.human}${escalationNote}`,
          ruleId: constraint.key,
          details: {
            expression: constraint.expression,
            constraintKey: constraint.key,
            originalSeverity: constraint.severity,
            escalated: escalateToError
          },
          // Override severity to info for demoted constraints
          severityOverride: shouldDemoteToInfo ? 'info' : undefined
        }));
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Silently skip constraints that use unsupported FHIRPath functions (memberOf, resolve, etc.)
      // These can't be evaluated client-side and should not produce false-positive issues.
      if (errorMsg.includes('asynchronous function') || errorMsg.includes('is not allowed')) {
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

  /** Get evaluation context for a constraint, navigating to the target element. */
  private getEvaluationContext(resource: any, elementPath: string): any {
    const segments = elementPath.split('.');
    if (segments.length > 1 && segments[0] === resource.resourceType) segments.shift();
    if (segments.length === 0) return resource;

    let current: any = resource;
    for (const segment of segments) {
      if (!current || typeof current !== 'object') return resource;
      const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const fieldName = arrayMatch[1];
        const index = parseInt(arrayMatch[2], 10);
        if (!current[fieldName] || !Array.isArray(current[fieldName])) return resource;
        if (index >= current[fieldName].length) return resource;
        current = current[fieldName][index];
      } else {
        let value = current[segment];
        // Handle FHIR choice types (e.g. effective[x] → effectiveDateTime)
        if (value === undefined && segment.endsWith('[x]')) {
          const prefix = segment.slice(0, -3);
          const actualKey = Object.keys(current).find(k => k.startsWith(prefix) && k !== prefix);
          if (actualKey) value = current[actualKey];
        }
        current = value;
      }
    }
    return current || resource;
  }

  /**
   * Resolve the evaluation context and (possibly rewritten) expression for a constraint.
   *
   * Two cases require special handling:
   *
   * 1. **Choice-type elements (`[x]`)**: fhirpath.js loses type metadata when
   *    values are extracted as raw JS primitives, so `$this as dateTime` etc.
   *    fail. Fix: keep the parent as context and wrap the expression with
   *    element navigation (`effective.all(...)`) so FHIRPath resolves the
   *    typed value through the model.
   *
   * 2. **Backbone elements** (component, contact, etc.): extracting a backbone
   *    element as a raw JS object strips `resourceType`, so fhirpath.js can't
   *    resolve choice-type children (e.g. `value.exists()` fails because
   *    `valueQuantity` isn't found via the FHIR model). Fix: evaluate from
   *    the resource root and navigate with `pathSegments.all(expr)`.
   */
  private resolveConstraintContext(
    resource: any,
    elementPath: string,
    rawExpression: string,
  ): { context: any; expression: string } {
    const lastSegment = elementPath.split('.').pop() ?? '';
    if (lastSegment.endsWith('[x]')) {
      const choiceElementName = lastSegment.slice(0, -3);
      const parentPath = elementPath.split('.').slice(0, -1).join('.');
      const ctx = parentPath
        ? this.getEvaluationContext(resource, parentPath)
        : resource;
      return { context: ctx, expression: `${choiceElementName}.all(${rawExpression})` };
    }

    const ctx = this.getEvaluationContext(resource, elementPath);

    // Backbone elements (no `resourceType`) lose FHIR model context,
    // so fhirpath.js can't resolve choice-type children like `value`
    // → `valueQuantity`. Only fall back to resource-root evaluation
    // when the context actually contains resolved choice-type properties
    // (e.g. `valueQuantity`, `effectiveDateTime`) that match names
    // used in the expression.
    if (ctx && typeof ctx === 'object' && !Array.isArray(ctx) && !ctx.resourceType && ctx !== resource) {
      if (this.hasUnresolvableChoiceTypes(ctx, rawExpression)) {
        const segments = elementPath.split('.');
        if (segments.length > 1 && segments[0] === resource.resourceType) {
          const fhirPathNav = segments.slice(1).join('.');
          return { context: resource, expression: `${fhirPathNav}.all(${rawExpression})` };
        }
      }
    }

    return { context: ctx, expression: rawExpression };
  }

  private evaluateFHIRPath(
    context: any,
    expression: string,
    rootResource?: any
  ): any {
    // Use compiled expression cache — avoids re-parsing on every call
    const compiled = expressionCache.getOrCompile(expression, this.fhirVersion);

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

  /** True when ctx has resolved choice-type properties (e.g. `valueQuantity`)
   *  whose base name (`value`) appears in the expression but not as a key. */
  private hasUnresolvableChoiceTypes(ctx: any, expression: string): boolean {
    const CHOICE_BASES = [
      'value', 'effective', 'onset', 'abatement', 'deceased', 'multipleBirth',
      'defaultValue', 'medication', 'reported', 'occurrence', 'timing',
      'product', 'serviced', 'location', 'allowed', 'used',
      'rate', 'born', 'age',
    ];
    const keys = Object.keys(ctx);
    for (const base of CHOICE_BASES) {
      if (!new RegExp(`\\b${base}\\b`).test(expression)) continue;
      if (ctx[base] !== undefined) continue;
      if (keys.some(k => k.startsWith(base) && k.length > base.length && k[base.length] === k[base.length].toUpperCase()))
        return true;
    }
    return false;
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
      if (result.length === 1 && typeof result[0] === 'boolean') return result[0];
      return result.some(item => item === true || (item !== false && item != null));
    }
    if (result === null || result === undefined) return false;
    if (typeof result === 'number') return result !== 0;
    if (typeof result === 'string') return result.length > 0;
    return true;
  }

  /** Check if an element exists in the resource */
  private elementExistsInResource(resource: any, elementPath: string): boolean {
    if (!resource || !elementPath) return false;
    const segments = elementPath.split('.');
    const resourceType = resource.resourceType;
    if (segments.length > 1 && segments[0] === resourceType) segments.shift();
    if (segments.length === 0) {
      return true;
    }

    // Navigate through the object to check if the field exists
    let current: any = resource;
    for (const segment of segments) {
      // Handle array indices (e.g., "contact[0]")
      const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const fieldName = arrayMatch[1];
        const index = parseInt(arrayMatch[2], 10);

        if (!current[fieldName] || !Array.isArray(current[fieldName])) {
          return false;
        }
        if (index >= current[fieldName].length) {
          return false;
        }
        current = current[fieldName][index];
      } else {
        // Regular field access
        let value = current[segment];
        // Handle FHIR choice types (e.g. effective[x] → effectiveDateTime)
        if ((value === undefined || value === null) && segment.endsWith('[x]')) {
          const prefix = segment.slice(0, -3);
          const actualKey = Object.keys(current).find(k => k.startsWith(prefix) && k !== prefix);
          if (actualKey) value = current[actualKey];
        }
        if (value === undefined || value === null) {
          return false;
        }
        current = value;
      }
    }

    return true;
  }

  setTimeout(timeout: number): void {
    this.timeout = timeout;
  }

  /** Check if a backbone element exists but is empty (e.g., contact: [{}]) */
  private hasEmptyBackboneElement(resource: any, elementPath: string): boolean {
    if (!resource || !elementPath) return false;
    const segments = elementPath.split('.');
    if (segments.length > 1 && segments[0] === resource.resourceType) segments.shift();
    if (segments.length === 0) return false;

    let current: any = resource;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);

      if (arrayMatch) {
        const fieldName = arrayMatch[1];
        const index = parseInt(arrayMatch[2], 10);
        if (!current[fieldName] || !Array.isArray(current[fieldName]) || index >= current[fieldName].length) {
          return false;
        }
        current = current[fieldName][index];
      } else {
        if (current[segment] === undefined || current[segment] === null) {
          return false;
        }
        current = current[segment];
      }
    }

    // Check the final segment
    const lastSegment = segments[segments.length - 1];
    const value = current[lastSegment];

    if (value === undefined || value === null) {
      return false;
    }

    // Check for empty arrays with empty objects
    if (Array.isArray(value)) {
      return value.some(item => {
        if (item === null || item === undefined) return false;
        if (typeof item !== 'object') return false;
        // Check if object is empty or has only empty values
        const keys = Object.keys(item);
        return keys.length === 0 || keys.every(k =>
          item[k] === undefined || item[k] === null ||
          (typeof item[k] === 'object' && Object.keys(item[k]).length === 0)
        );
      });
    }

    // Check for empty object
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      return keys.length === 0;
    }

    return false;
  }

  static getCacheStats(): { hits: number; misses: number; hitRate: string; size: number } {
    return expressionCache.getStats();
  }

  static clearCache(): void {
    expressionCache.clear();
  }
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
  const constraint = expressionCache.getStats();
  const sd = getSDFHIRPathCacheStats();
  const totalHits = constraint.hits + sd.hits;
  const totalMisses = constraint.misses + sd.misses;
  const total = totalHits + totalMisses;
  return {
    constraint,
    sdExecutor: sd,
    combined: {
      hits: totalHits,
      misses: totalMisses,
      hitRate: total > 0 ? ((totalHits / total) * 100).toFixed(1) + '%' : '0%',
      size: constraint.size + sd.size,
    },
  };
}
