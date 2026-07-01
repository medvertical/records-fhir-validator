import type { ValidationIssue } from '../types';
import type { StructureDefinition, Constraint } from '../core/structure-definition-types';
import { createValidationIssue } from '../issues';
import { sdConstraintCollector, type CollectedConstraint } from './sd-constraint-collector';
import { elementContextResolver } from './element-context-resolver';
import { sdElementMatcher } from './sd-element-matcher';
import { fhirPathCustomFunctions, createFHIRPathContext } from './fhirpath-functions';
import { InvariantRegistry } from './invariant-registry';
import { preprocessTypeLiterals, resolveElementType } from './fhirpath-type-preprocessor';
import { evaluateSimpleMemberOfExists, evaluateTrailingMemberOf } from './fhirpath-memberof-precheck';
import { evaluateResolveExistsConstraint } from './fhirpath-resolve-precheck';
import { appendHtmlChecksConstraintIssues } from './fhirpath-html-checks';
import { ValueSetPackageLoader } from './valueset-package-loader';
import { logger } from '../logger';
import {
    prepareElementContext,
    resolveChoiceTypeCast,
    deriveChoiceTypeFromConcretePath,
} from './sd-fhirpath-choice-utils';
import { sdFHIRPathExpressionCache } from './sd-fhirpath-expression-cache';
import { constraintPassed } from './sd-fhirpath-result-utils';
import { validateProfileRules } from './sd-profile-rules-validator';

export interface SDFHIRPathContext {
    resource: any;
    resourceType: string;
    structureDef: StructureDefinition;
    bundle?: any;
    bundleResources?: Map<string, any>; // Map of fullUrl/id to resource
    fhirVersion?: 'R4' | 'R5' | 'R6';
}

export class SDFHIRPathExecutor {
    private memberOfValueSetLoader = new ValueSetPackageLoader();

    /**
     * Execute ALL FHIRPath constraints from StructureDefinition
     */
    async execute(context: SDFHIRPathContext): Promise<ValidationIssue[]> {
        const { resource, resourceType, structureDef, bundle, bundleResources, fhirVersion = 'R4' } = context;
        const issues: ValidationIssue[] = [];
        const profileUrl = structureDef.url;

        if (!structureDef || !resource) return issues;

        // Create FHIRPath context and build userInvocationTable once per execute() call
        const fhirPathContext = createFHIRPathContext(resource, bundleResources ?? bundle);
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
        const rootExpressionConstraints = new Set<string>();
        for (const matched of matchResult.constraintElements) {
            if (matched.element?.path === resourceType) {
                continue;
            }
            for (const constraint of matched.element.constraint || []) {
                if (this.expressionStartsAtResourceRoot(constraint.expression, resourceType)) {
                    const key = `${matched.element?.id ?? matched.element?.path ?? matched.resourcePath}|${constraint.key}|${constraint.expression}`;
                    if (rootExpressionConstraints.has(key)) {
                        continue;
                    }
                    rootExpressionConstraints.add(key);
                }
                const constraintIssues = await this.evaluateConstraintOnElement(
                    resource,
                    resourceType,
                    matched,
                    constraint,
                    userInvocationTable,
                    profileUrl,
                    fhirVersion,
                    bundleResources ?? bundle
                );
                issues.push(...constraintIssues);
            }
        }

        // Evaluate profile-specific rules (fixed, pattern, min/max)
        for (const matched of matchResult.matches) {
            const profileIssues = validateProfileRules(matched, resourceType);
            issues.push(...profileIssues);
        }

        // Also evaluate root-level constraints via collector
        const mandatoryConstraints = sdConstraintCollector.getMandatoryConstraints(structureDef, resource);

        for (const collected of mandatoryConstraints) {
            // Skip if we already evaluated via element matcher
            if (!collected.isRootConstraint) continue;

            const constraintIssues = await this.evaluateConstraint(
                resource,
                resourceType,
                collected,
                userInvocationTable,
                profileUrl,
                fhirVersion,
                bundleResources ?? bundle
            );
            issues.push(...constraintIssues);
        }

        logger.debug(`[SDFHIRPathExecutor] Found ${issues.length} violations`);

        return issues;
    }

    /**
     * Evaluate constraint on a matched element
     */
    private async evaluateConstraintOnElement(
        resource: any,
        resourceType: string,
        matched: any,
        constraint: Constraint,
        userInvocationTable: any,
        profileUrl?: string,
        fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
        bundle?: any,
    ): Promise<ValidationIssue[]> {
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
        // For polymorphic `value[x]` elements `resolveElementType` is null (the
        // SD lists every choice type), so fall back to the *concrete* type the
        // element matcher already recorded on `resourcePath`
        // (`Observation.valueQuantity` → `Quantity`) — the deterministic
        // type-annotation that lets `%context.type().name = 'Quantity'` resolve.
        const elementType =
            resolveElementType(matched.element) ?? deriveChoiceTypeFromConcretePath(matched);
        const effectiveExpression = preprocessTypeLiterals(constraint.expression, {
            elementType,
            resourceType,
            rootResourceType: resourceType,
        });

        const choiceCast = resolveChoiceTypeCast(effectiveExpression, matched);
        if (choiceCast.skip) {
            return issues;
        }
        const resolvedExpression = choiceCast.expression;

        try {
            const evaluationContext = this.expressionStartsAtResourceRoot(resolvedExpression, resourceType)
                ? resource
                : matched.data;
            if (appendHtmlChecksConstraintIssues(issues, resolvedExpression, evaluationContext, matched.resourcePath, resourceType, profileUrl)) return issues;

            const memberOfPassed = await evaluateSimpleMemberOfExists(
                resolvedExpression,
                resource,
                resourceType,
                this.memberOfValueSetLoader,
                fhirVersion,
            );
            if (memberOfPassed !== null) {
                if (!memberOfPassed) {
                    issues.push(this.createViolation(constraint, matched.resourcePath, resourceType, profileUrl));
                }
                return issues;
            }
            const trailingMemberOf = evaluateTrailingMemberOf(
                resolvedExpression,
                evaluationContext,
                fhirVersion,
            );
            if (trailingMemberOf !== null) {
                if (!trailingMemberOf) {
                    issues.push(this.createViolation(constraint, matched.resourcePath, resourceType, profileUrl));
                }
                return issues;
            }
            const resolveExists = evaluateResolveExistsConstraint({
                expression: resolvedExpression,
                context: evaluationContext,
                rootResource: resource,
                fhirVersion,
                bundle,
            });
            if (resolveExists !== null) {
                if (!resolveExists) {
                    issues.push(this.createViolation(constraint, matched.resourcePath, resourceType, profileUrl));
                }
                return issues;
            }
            const result = this.evaluateExpression(resolvedExpression, evaluationContext, resource, userInvocationTable, fhirVersion);
            if (!constraintPassed(result)) {
                issues.push(this.createViolation(constraint, matched.resourcePath, resourceType, profileUrl));
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);

            // Silently skip constraints that use unsupported async FHIRPath functions
            // (memberOf, resolve, etc.) — these cannot be evaluated client-side.
            if (
                message.includes('asynchronous function') ||
                message.includes('is not allowed')
            ) {
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
                profile: profileUrl,
                customMessage:
                    `Constraint '${constraint.key}' could not be evaluated: ${message}. ` +
                    `The underlying data was NOT checked against this constraint.`,
                severityOverride: 'information',
                ruleId: constraint.key,
                details: {
                    expression: constraint.expression,
                    constraintKey: constraint.key,
                    evaluationError: message,
                },
            }));
        }

        return issues;
    }

    /**
     * Evaluate a single constraint
     */
    private async evaluateConstraint(
        resource: any,
        resourceType: string,
        collected: CollectedConstraint,
        userInvocationTable: any,
        profileUrl?: string,
        fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
        bundle?: any,
    ): Promise<ValidationIssue[]> {
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
            if (
                isRootConstraint &&
                appendHtmlChecksConstraintIssues(issues, effectiveExpression, resource, elementPath, resourceType, profileUrl)
            ) return issues;

            const memberOfPassed = await evaluateSimpleMemberOfExists(
                effectiveExpression,
                resource,
                resourceType,
                this.memberOfValueSetLoader,
                fhirVersion,
            );
            if (memberOfPassed !== null) {
                if (!memberOfPassed) {
                    issues.push(this.createViolation(constraint, elementPath, resourceType, profileUrl));
                }
                return issues;
            }

            // Use ElementContextResolver for proper array handling
            if (isRootConstraint) {
                const trailingMemberOf = evaluateTrailingMemberOf(effectiveExpression, resource, fhirVersion);
                if (trailingMemberOf !== null) {
                    if (!trailingMemberOf) {
                        issues.push(this.createViolation(constraint, elementPath, resourceType, profileUrl));
                    }
                    return issues;
                }
                const resolveExists = evaluateResolveExistsConstraint({
                    expression: effectiveExpression,
                    context: resource,
                    rootResource: resource,
                    fhirVersion,
                    bundle,
                });
                if (resolveExists !== null) {
                    if (!resolveExists) {
                        issues.push(this.createViolation(constraint, elementPath, resourceType, profileUrl));
                    }
                    return issues;
                }
                // Root constraint - evaluate on entire resource
                const result = this.evaluateExpression(effectiveExpression, resource, resource, userInvocationTable, fhirVersion);
                if (!constraintPassed(result)) {
                    issues.push(this.createViolation(constraint, elementPath, resourceType, profileUrl));
                }
            } else if (this.expressionStartsAtResourceRoot(effectiveExpression, resourceType)) {
                const trailingMemberOf = evaluateTrailingMemberOf(effectiveExpression, resource, fhirVersion);
                if (trailingMemberOf !== null) {
                    if (!trailingMemberOf) {
                        issues.push(this.createViolation(constraint, elementPath, resourceType, profileUrl));
                    }
                    return issues;
                }
                const resolveExists = evaluateResolveExistsConstraint({
                    expression: effectiveExpression,
                    context: resource,
                    rootResource: resource,
                    fhirVersion,
                    bundle,
                });
                if (resolveExists !== null) {
                    if (!resolveExists) {
                        issues.push(this.createViolation(constraint, elementPath, resourceType, profileUrl));
                    }
                    return issues;
                }
                const result = this.evaluateExpression(effectiveExpression, resource, resource, userInvocationTable, fhirVersion);
                if (!constraintPassed(result)) {
                    issues.push(this.createViolation(constraint, elementPath, resourceType, profileUrl));
                }
            } else {
                // Element constraint - resolve all contexts (including array elements)
                const contexts = elementContextResolver.resolveContexts(resource, elementPath, resourceType);

                for (const ctx of contexts) {
                    if (appendHtmlChecksConstraintIssues(issues, effectiveExpression, ctx.value, ctx.fullPath, resourceType, profileUrl)) continue;

                    const trailingMemberOf = evaluateTrailingMemberOf(effectiveExpression, ctx.value, fhirVersion);
                    if (trailingMemberOf !== null) {
                        if (!trailingMemberOf) {
                            issues.push(this.createViolation(constraint, ctx.fullPath, resourceType, profileUrl));
                        }
                        continue;
                    }
                    const resolveExists = evaluateResolveExistsConstraint({
                        expression: effectiveExpression,
                        context: ctx.value,
                        rootResource: resource,
                        fhirVersion,
                        bundle,
                    });
                    if (resolveExists !== null) {
                        if (!resolveExists) {
                            issues.push(this.createViolation(constraint, ctx.fullPath, resourceType, profileUrl));
                        }
                        continue;
                    }
                    const result = this.evaluateExpression(effectiveExpression, ctx.value, resource, userInvocationTable, fhirVersion);
                    if (!constraintPassed(result)) {
                        issues.push(this.createViolation(constraint, ctx.fullPath, resourceType, profileUrl));
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
            issues.push(createValidationIssue({
                code: 'profile-constraint-evaluation-error',
                path: elementPath,
                resourceType,
                profile: profileUrl,
                customMessage:
                    `Constraint '${constraint.key}' could not be evaluated: ${message}. ` +
                    `The underlying data was NOT checked against this constraint.`,
                severityOverride: 'information',
                ruleId: constraint.key,
                details: {
                    expression: constraint.expression,
                    constraintKey: constraint.key,
                    evaluationError: message,
                },
            }));
        }

        return issues;
    }

    /**
     * Evaluate a FHIRPath expression
     */
    private evaluateExpression(expression: string, context: any, rootResource: any, userInvocationTable?: any, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): any {
        const compiled = sdFHIRPathExpressionCache.getOrCompile(expression, fhirVersion);
        if (!compiled) {
            throw new Error(`Failed to compile FHIRPath expression: ${expression}`);
        }

        return this.evaluateCompiled(
            compiled,
            prepareElementContext(context, expression),
            rootResource,
            userInvocationTable,
        );
    }

    private expressionStartsAtResourceRoot(expression: string | undefined, resourceType: string): boolean {
        if (!expression || !resourceType) return false;
        const escapedResourceType = resourceType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^\\s*(?:\\(\\s*)*${escapedResourceType}(?=\\.|\\b)`).test(expression);
    }

    /**
     * Create a violation issue
     */
    private createViolation(
        constraint: Constraint,
        path: string,
        resourceType: string,
        profileUrl?: string,
    ): ValidationIssue {
        return createValidationIssue({
            code: `constraint-violation-${constraint.key}`,
            path,
            resourceType,
            profile: profileUrl,
            customMessage: constraint.human || `Constraint ${constraint.key} failed: ${constraint.expression}`,
            severityOverride: constraint.severity === 'error' ? 'error' : 'warning',
            ruleId: constraint.key,
            details: {
                expression: constraint.expression,
                constraintKey: constraint.key,
                originalSeverity: constraint.severity,
            },
        });
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

}

// Singleton
export const sdFHIRPathExecutor = new SDFHIRPathExecutor();

/** Get cache stats for the SD FHIRPath expression cache */
export function getSDFHIRPathCacheStats() {
    return sdFHIRPathExpressionCache.getStats();
}

/** Clear the SD FHIRPath expression cache */
export function clearSDFHIRPathCache() {
    sdFHIRPathExpressionCache.clear();
}
