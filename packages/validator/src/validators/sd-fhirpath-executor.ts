/**
 * SD FHIRPath Executor
 * 
 * Evaluates ALL FHIRPath constraint expressions from StructureDefinitions.
 * This brings Records to full HAPI parity by executing every constraint
 * in the SD, not just the ones Records has custom validators for.
 * 
 * Key Features:
 * - Extracts all constraints from SD snapshot
 * - Evaluates FHIRPath on appropriate context (root or element)
 * - Handles constraint inheritance
 * - Reports violations with constraint key
 */

import type { ValidationIssue } from '../types';
import type { StructureDefinition, Constraint } from '../core/structure-definition-types';
import { createValidationIssue } from '../issues';
import { sdConstraintCollector, type CollectedConstraint } from './sd-constraint-collector';
import { elementContextResolver } from './element-context-resolver';
import { sdElementMatcher } from './sd-element-matcher';
import { fhirPathCustomFunctions, createFHIRPathContext } from './fhirpath-functions';
import { InvariantRegistry } from './invariant-registry';
import { preprocessTypeLiterals, resolveElementType } from './fhirpath-type-preprocessor';
import fhirpath from 'fhirpath';
import { getFhirPathModel } from '../core/fhirpath-context';
import { logger } from '../logger';

const CHOICE_BASES = [
    'value', 'effective', 'onset', 'abatement', 'deceased', 'multipleBirth',
    'defaultValue', 'medication', 'reported', 'occurrence', 'timing',
    'product', 'serviced', 'location', 'allowed', 'used',
    'rate', 'born', 'age',
];

// ============================================================================
// Types
// ============================================================================

export interface SDFHIRPathContext {
    resource: any;
    resourceType: string;
    structureDef: StructureDefinition;
    bundle?: any;
    bundleResources?: Map<string, any>; // Map of fullUrl/id to resource
    fhirVersion?: 'R4' | 'R5' | 'R6';
}

// ============================================================================
// FHIRPath Cache (shared with constraint-validator)
// ============================================================================

class ExpressionCache {
    private cache = new Map<string, any>();
    private maxSize = 1000;
    private hits = 0;
    private misses = 0;

    getOrCompile(expression: string, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): any {
        const cacheKey = `${fhirVersion}:${expression}`;
        if (this.cache.has(cacheKey)) {
            this.hits++;
            const compiled = this.cache.get(cacheKey);
            this.cache.delete(cacheKey);
            this.cache.set(cacheKey, compiled);
            return compiled;
        }

        this.misses++;
        try {
            const compiled = fhirpath.compile(expression, getFhirPathModel(fhirVersion));

            if (this.cache.size >= this.maxSize) {
                const oldestKey = this.cache.keys().next().value;
                if (oldestKey) this.cache.delete(oldestKey);
            }

            this.cache.set(cacheKey, compiled);
            return compiled;
        } catch (err) {
            logger.warn(`[SDFHIRPathExecutor] Failed to compile: ${expression}`, err);
            return null;
        }
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

const expressionCache = new ExpressionCache();

// ============================================================================
// SD FHIRPath Executor
// ============================================================================

export class SDFHIRPathExecutor {

    /**
     * Execute ALL FHIRPath constraints from StructureDefinition
     */
    async execute(context: SDFHIRPathContext): Promise<ValidationIssue[]> {
        const { resource, resourceType, structureDef, bundleResources, fhirVersion = 'R4' } = context;
        const issues: ValidationIssue[] = [];

        if (!structureDef || !resource) return issues;

        // Create FHIRPath context and build userInvocationTable once per execute() call
        const fhirPathContext = createFHIRPathContext(resource, bundleResources ? Array.from(bundleResources.values()) : undefined);
        const userInvocationTable = fhirPathContext ? {
            resolve: {
                fn: (inputs: any[]) => fhirPathCustomFunctions.resolve.fn(inputs, fhirPathContext),
                arity: { 0: [] }
            },
            memberOf: {
                fn: (inputs: any[], url: string) => fhirPathCustomFunctions.memberOf.fn(inputs, url, fhirPathContext),
                arity: { 1: ['String'] }
            },
            conformsTo: {
                fn: (inputs: any[], url: string) => fhirPathCustomFunctions.conformsTo.fn(inputs, url),
                arity: { 1: ['String'] }
            },
            extension: {
                fn: fhirPathCustomFunctions.extension.fn,
                arity: { 1: ['String'] }
            }
        } : undefined;

        // Use sdElementMatcher for deeper traversal
        const matchResult = sdElementMatcher.match(resource, structureDef);

        logger.debug(`[SDFHIRPathExecutor] Matched ${matchResult.matches.length} elements, ${matchResult.constraintElements.length} with constraints`);

        // Evaluate constraints on matched elements
        for (const matched of matchResult.constraintElements) {
            for (const constraint of matched.element.constraint || []) {
                const constraintIssues = this.evaluateConstraintOnElement(
                    resource,
                    resourceType,
                    matched,
                    constraint,
                    userInvocationTable,
                    fhirVersion
                );
                issues.push(...constraintIssues);
            }
        }

        // Evaluate profile-specific rules (fixed, pattern, min/max)
        for (const matched of matchResult.matches) {
            const profileIssues = this.validateProfileRules(matched, resourceType);
            issues.push(...profileIssues);
        }

        // Also evaluate root-level constraints via collector
        const mandatoryConstraints = sdConstraintCollector.getMandatoryConstraints(structureDef, resource);

        for (const collected of mandatoryConstraints) {
            // Skip if we already evaluated via element matcher
            if (!collected.isRootConstraint) continue;

            const constraintIssues = this.evaluateConstraint(
                resource,
                resourceType,
                collected,
                userInvocationTable,
                fhirVersion
            );
            issues.push(...constraintIssues);
        }

        logger.debug(`[SDFHIRPathExecutor] Found ${issues.length} violations`);

        return issues;
    }

    /**
     * Evaluate constraint on a matched element
     */
    private evaluateConstraintOnElement(
        resource: any,
        resourceType: string,
        matched: any,
        constraint: Constraint,
        userInvocationTable: any,
        fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!constraint.expression) return issues;

        // Skip constraints that are owned by a dedicated Records validator.
        // Source of truth is `invariant-registry.ts` — adding a new
        // specialised handler means adding its key(s) there, not editing
        // this file.
        if (InvariantRegistry.isSpecialised(constraint.key)) {
            return issues;
        }

        // Substitute `%context.type()` / `%resource.type()` literals against
        // the declared element type. fhirpath.js can't resolve `.type()` on
        // raw JS objects — this closes cont-1/2/3 on DomainResource.contained.
        const effectiveExpression = preprocessTypeLiterals(constraint.expression, {
            elementType: resolveElementType(matched.element),
            resourceType,
            rootResourceType: resourceType,
        });

        try {
            const result = this.evaluateExpression(effectiveExpression, matched.data, resource, userInvocationTable, fhirVersion);
            if (!this.constraintPassed(result)) {
                issues.push(this.createViolation(constraint, matched.resourcePath, resourceType));
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);

            // Silently skip constraints that use unsupported async FHIRPath functions
            // (memberOf, resolve, etc.) — these cannot be evaluated client-side.
            if (message.includes('asynchronous function') || message.includes('is not allowed')) {
                logger.debug(`[SDFHIRPathExecutor] Skipping ${constraint.key} (unsupported async function)`);
                return issues;
            }

            logger.debug(
                `[SDFHIRPathExecutor] Error evaluating ${constraint.key} on ${matched.resourcePath}: ${message}`,
            );
            issues.push(createValidationIssue({
                code: 'profile-constraint-evaluation-error',
                path: matched.resourcePath,
                resourceType,
                customMessage:
                    `Constraint '${constraint.key}' could not be evaluated: ${message}. ` +
                    `The underlying data was NOT checked against this constraint.`,
                severityOverride: 'information',
            }));
        }

        return issues;
    }

    /**
     * Validate profile-specific rules: fixed[x], pattern[x], min/max
     */
    private validateProfileRules(matched: any, resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const { element, data, resourcePath } = matched;

        // 1. Fixed Value Check
        if (element.fixedString !== undefined && data !== element.fixedString) {
            issues.push(createValidationIssue({
                code: 'profile-fixed-value-mismatch',
                path: resourcePath,
                resourceType,
                customMessage: `Value must be exactly '${element.fixedString}'`,
                severityOverride: 'error'
            }));
        }
        if (element.fixedCode !== undefined && data !== element.fixedCode) {
            issues.push(createValidationIssue({
                code: 'profile-fixed-value-mismatch',
                path: resourcePath,
                resourceType,
                customMessage: `Code must be exactly '${element.fixedCode}'`,
                severityOverride: 'error'
            }));
        }
        if (element.fixedUri !== undefined && data !== element.fixedUri) {
            const fixed = element.fixedUri;
            if (data !== fixed) {
                issues.push(createValidationIssue({
                    code: 'profile-fixed-value-mismatch',
                    path: resourcePath,
                    resourceType,
                    customMessage: `URI must be exactly '${fixed}'`,
                    severityOverride: 'error'
                }));
            }
        }
        if (element.fixedBoolean !== undefined && data !== element.fixedBoolean) {
            issues.push(createValidationIssue({
                code: 'profile-fixed-value-mismatch',
                path: resourcePath,
                resourceType,
                customMessage: `Value must be ${element.fixedBoolean}`,
                severityOverride: 'error'
            }));
        }

        // 2. Pattern Check (subset match)
        // Note: For complex types, pattern check is recursive. Simplified here for primitives.
        if (element.patternString !== undefined && data !== element.patternString) {
            issues.push(createValidationIssue({
                code: 'profile-pattern-mismatch',
                path: resourcePath,
                resourceType,
                customMessage: `Value must match pattern '${element.patternString}'`,
                severityOverride: 'error'
            }));
        }
        if (element.patternCode !== undefined && data !== element.patternCode) {
            issues.push(createValidationIssue({
                code: 'profile-pattern-mismatch',
                path: resourcePath,
                resourceType,
                customMessage: `Code must match pattern '${element.patternCode}'`,
                severityOverride: 'error'
            }));
        }

        // 3. Min/Max Value (for quantities/integers)
        if (element.minValueInteger !== undefined && typeof data === 'number' && data < element.minValueInteger) {
            issues.push(createValidationIssue({
                code: 'profile-min-value-violation',
                path: resourcePath,
                resourceType,
                customMessage: `Value ${data} is less than minimum ${element.minValueInteger}`,
                severityOverride: 'error'
            }));
        }
        if (element.maxValueInteger !== undefined && typeof data === 'number' && data > element.maxValueInteger) {
            issues.push(createValidationIssue({
                code: 'profile-max-value-violation',
                path: resourcePath,
                resourceType,
                customMessage: `Value ${data} is greater than maximum ${element.maxValueInteger}`,
                severityOverride: 'error'
            }));
        }

        return issues;
    }

    /**
     * Evaluate a single constraint
     */
    private evaluateConstraint(
        resource: any,
        resourceType: string,
        collected: CollectedConstraint,
        userInvocationTable: any,
        fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const { constraint, elementPath, isRootConstraint } = collected;

        if (!constraint.expression) return issues;

        // Skip constraints owned by a dedicated Records validator
        // (see `invariant-registry.ts`).
        if (InvariantRegistry.isSpecialised(constraint.key)) {
            return issues;
        }

        // Skip constraints attached to slice elements. The generic
        // executor resolves contexts at the path level — for
        // `Organization.identifier:NPI`, it sees the path
        // `Organization.identifier` and would fire `value.matches(...)`
        // against EVERY identifier on the resource (NPI, NAIC, CLIA,
        // internal IDs alike), producing one constraint violation per
        // non-matching identifier. On the latest Fire.ly run that's
        // ~700 false positives across us-core-16/17/18/19. Slice-aware
        // discriminator filtering would be the proper fix; until that
        // exists, deferring slice constraints to the slicing-validator
        // (which already enforces "instance matches slice or doesn't")
        // is the safer behaviour. See sd-constraint-collector.ts for
        // the rationale.
        if (collected.sliceName) {
            return issues;
        }

        // Pre-substitute type-literal patterns. Root path: elementType is
        // the resource's own type (isRootConstraint). Monomorphic element
        // paths: single declared type. Polymorphic `[x]`: pass null to
        // leave the expression untouched.
        const declaredType = collected.elementTypes.length === 1
            ? collected.elementTypes[0]
            : isRootConstraint ? resourceType : null;
        const effectiveExpression = preprocessTypeLiterals(constraint.expression, {
            elementType: declaredType,
            resourceType,
            rootResourceType: resourceType,
        });

        try {
            // Use ElementContextResolver for proper array handling
            if (isRootConstraint) {
                // Root constraint - evaluate on entire resource
                const result = this.evaluateExpression(effectiveExpression, resource, resource, userInvocationTable, fhirVersion);
                if (!this.constraintPassed(result)) {
                    issues.push(this.createViolation(constraint, elementPath, resourceType));
                }
            } else {
                // Element constraint - resolve all contexts (including array elements)
                const contexts = elementContextResolver.resolveContexts(resource, elementPath, resourceType);

                for (const ctx of contexts) {
                    const result = this.evaluateExpression(effectiveExpression, ctx.value, resource, userInvocationTable, fhirVersion);
                    if (!this.constraintPassed(result)) {
                        issues.push(this.createViolation(constraint, ctx.fullPath, resourceType));
                    }
                }
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('asynchronous function') || message.includes('is not allowed')) {
                logger.debug(`[SDFHIRPathExecutor] Skipping ${constraint.key} (unsupported async function)`);
                return issues;
            }
            logger.warn(`[SDFHIRPathExecutor] Error evaluating ${constraint.key}: ${err}`);
        }

        return issues;
    }

    /**
     * Evaluate a FHIRPath expression
     */
    private evaluateExpression(expression: string, context: any, rootResource: any, userInvocationTable?: any, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): any {
        const compiled = expressionCache.getOrCompile(expression, fhirVersion);
        if (!compiled) return true; // Skip if can't compile

        return this.evaluateCompiled(
            compiled,
            this.prepareElementContext(context, expression),
            rootResource,
            userInvocationTable,
        );
    }

    /**
     * Create a violation issue
     */
    private createViolation(constraint: Constraint, path: string, resourceType: string): ValidationIssue {
        return createValidationIssue({
            code: `constraint-violation-${constraint.key}`,
            path,
            resourceType,
            customMessage: constraint.human || `Constraint ${constraint.key} failed: ${constraint.expression}`,
            severityOverride: constraint.severity === 'error' ? 'error' : 'warning',
        });
    }

    /**
     * Get the evaluation context for an element path
     */
    private getElementContext(resource: any, path: string, resourceType: string): any {
        // Remove resource type prefix
        let relativePath = path;
        if (path.startsWith(resourceType + '.')) {
            relativePath = path.substring(resourceType.length + 1);
        }

        if (!relativePath) return resource;

        const segments = relativePath.split('.');
        let current = resource;

        for (const segment of segments) {
            if (current === undefined || current === null) return undefined;

            // Handle choice types
            if (segment.endsWith('[x]')) {
                const baseName = segment.slice(0, -3);
                for (const key of Object.keys(current)) {
                    if (key.startsWith(baseName) && key !== baseName) {
                        current = current[key];
                        break;
                    }
                }
            } else if (Array.isArray(current)) {
                // For arrays, return the array itself for constraint evaluation
                return current;
            } else {
                current = current[segment];
            }
        }

        return current;
    }

    /**
     * Evaluate a compiled FHIRPath expression synchronously.
     * (fhirpath.js is synchronous — the previous Promise + setTimeout wrapper
     * was dead code since a setTimeout cannot interrupt a sync call.)
     */
    private evaluateCompiled(compiled: any, context: any, rootResource: any, userInvocationTable?: any): any {
        return compiled(
            context,
            {
                resource: rootResource,
                rootResource: rootResource,
                userInvocationTable,
            },
            { traceFn: () => { } },
        );
    }

    /**
     * fhirpath.js can resolve `value[x]` aliases such as `valueQuantity` when
     * evaluating from a typed resource root. SD traversal evaluates some
     * constraints on raw BackboneElement objects, which have no FHIR type
     * metadata. Add shallow choice aliases so element-local constraints like
     * `value.exists() or dataAbsentReason.exists()` keep FHIR choice semantics.
     */
    private prepareElementContext(context: any, expression: string): any {
        if (Array.isArray(context)) {
            return context.map(item => this.prepareElementContext(item, expression));
        }

        if (!context || typeof context !== 'object' || context.resourceType) {
            return context;
        }

        const keys = Object.keys(context);
        let normalized: any | undefined;

        for (const base of CHOICE_BASES) {
            if (!new RegExp(`\\b${base}\\b`).test(expression)) continue;
            if (context[base] !== undefined) continue;

            const concreteKey = keys.find(key =>
                key.startsWith(base) &&
                key.length > base.length &&
                key[base.length] === key[base.length].toUpperCase()
            );

            if (concreteKey) {
                normalized ??= { ...context };
                normalized[base] = context[concreteKey];
            }
        }

        return normalized ?? context;
    }

    /**
     * Check if a FHIRPath constraint passed
     */
    private constraintPassed(result: any): boolean {
        if (result === undefined || result === null) return true;
        if (typeof result === 'boolean') return result;
        if (Array.isArray(result)) {
            if (result.length === 0) return true;
            if (result.length === 1 && typeof result[0] === 'boolean') return result[0];
            return result.length > 0; // Non-empty array = true
        }
        return true; // Default to passing
    }
}

// Singleton
export const sdFHIRPathExecutor = new SDFHIRPathExecutor();

/** Get cache stats for the SD FHIRPath expression cache */
export function getSDFHIRPathCacheStats() {
    return expressionCache.getStats();
}

/** Clear the SD FHIRPath expression cache */
export function clearSDFHIRPathCache() {
    expressionCache.clear();
}
