/**
 * Custom Rule Executor
 * 
 * Executes user-defined business rules (Custom Rules) against resources.
 * Fetches enabled rules from the embedder-provided custom rule source and
 * evaluates their FHIRPath expressions.
 */

import fhirpath from 'fhirpath';
import { getFhirPathModel } from '../../validators/fhirpath-model-resolver.js';
import { rewriteCollectionTypeOperators } from '../../validators/fhirpath-as-operator-rewrite.js';
import { checkFhirpathSandbox } from '../../validators/fhirpath-sandbox.js';
import { getCustomRulesSource } from '../../persistence/index.js';
import type { EngineCustomRule } from '../../persistence/index.js';
import { createValidationIssue } from '../../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinition } from '../structure-definition-types.js';
import { logger } from '../../logger.js';
import { validationFailureMetadata } from '../../utils/validation-execution-failure.js';
import { resourceTypeOf } from '../fhir-resource.js';

export interface CustomRuleValidationContext {
    resource: unknown;
    structureDef?: StructureDefinition;
    fhirVersion?: 'R4' | 'R5' | 'R6';
    organizationId?: number;
}

export class CustomRuleExecutor {
    // Cold tenant loads traverse an organization-scoped transaction with
    // several database round trips; on hosted infrastructure that regularly
    // exceeds a sub-second budget and used to surface false
    // "custom rules could not be loaded" warnings. The bound only guards
    // against a genuinely unavailable source, so it can be generous.
    private static readonly RULE_LOAD_TIMEOUT_MS = 2000;

    private async loadRules(resourceType: string, organizationId?: number): Promise<EngineCustomRule[]> {
        if (organizationId === undefined) {
            throw new Error('organizationId is required to load tenant custom rules');
        }

        const sourcePromise = getCustomRulesSource().getRulesByResourceType(resourceType, { organizationId });
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
                reject(new Error(
                    `Custom rule source timed out after ${CustomRuleExecutor.RULE_LOAD_TIMEOUT_MS}ms`,
                ));
            }, CustomRuleExecutor.RULE_LOAD_TIMEOUT_MS);
            timeout.unref?.();
        });
        try {
            // Cache ownership belongs to the embedder. A second engine-local
            // cache used to survive host invalidation for five minutes.
            return await Promise.race([sourcePromise, timeoutPromise]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    /**
     * Validate user-defined custom rules
     */
    async validate(
        context: CustomRuleValidationContext
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];
        const { resource } = context;
        const resourceType = resourceTypeOf(resource);

        try {
            // Fetch enabled rules for this resource type. The source is
            // embedder-provided and defaults to a noop (returns []) when
            // no host has wired up a backing store.
            const rules = await this.loadRules(resourceType, context.organizationId);

            if (rules.length === 0) {
                return issues;
            }

            logger.debug(`[CustomRuleExecutor] Validating ${resourceType} against ${rules.length} custom rules`);

            for (const rule of rules) {
                try {
                    // Sandbox pre-flight: reject pathological customer-supplied
                    // expressions before fhirpath.js runs. fhirpath.js is
                    // synchronous — once it's running we cannot interrupt it,
                    // so the only reliable defence is static analysis of the
                    // expression string.
                    const sandbox = checkFhirpathSandbox(rule.expression);
                    if (!sandbox.ok) {
                        issues.push(createValidationIssue({
                            code: 'custom-rule-rejected-by-sandbox',
                            path: resourceType,
                            resourceType,
                            customMessage: `Custom rule '${rule.name}' was not evaluated: ${sandbox.reason}`,
                            severityOverride: 'warning',
                            details: {
                                ruleId: rule.ruleId,
                                ruleName: rule.name,
                                sandboxMetrics: sandbox.metrics,
                            },
                        }));
                        continue;
                    }

                    // Evaluate FHIRPath expression
                    // Rule passes if result is true or non-empty
                    const result = fhirpath.evaluate(
                        resource,
                        rewriteCollectionTypeOperators(rule.expression),
                        {
                            resource,
                            rootResource: resource,
                            context: resource
                        },
                        getFhirPathModel(context.fhirVersion),
                        // Suppress fhirpath.js trace() output (causes TRACE:[unmatched] [] logs)
                        { traceFn: () => { } }
                    );

                    const passed = this.checkResult(result);

                    if (!passed) {
                        issues.push(createValidationIssue({
                            code: 'custom-rule-violation',
                            path: resourceType, // Uses resourceType; per-field paths can be added when rules define them
                            resourceType,
                            customMessage: rule.validationMessage || `Custom rule '${rule.name}' failed`,
                            severityOverride: rule.severity,
                            details: {
                                ruleId: rule.ruleId,
                                ruleName: rule.name,
                                expression: rule.expression,
                                category: rule.category
                            }
                        }));
                    }

                } catch (ruleError) {
                    logger.warn('[CustomRuleExecutor] Error evaluating rule', {
                        ruleId: rule.ruleId,
                        ...validationFailureMetadata(ruleError),
                    });
                    issues.push(createValidationIssue({
                        code: 'custom-rule-evaluation-error',
                        path: resourceType,
                        resourceType,
                        customMessage: `Failed to evaluate custom rule '${rule.name}'`,
                        severityOverride: 'warning', // Don't fail validation for bad rule syntax
                        details: {
                            ruleId: rule.ruleId,
                            ...validationFailureMetadata(ruleError),
                        }
                    }));
                }
            }

            return issues;

        } catch (error) {
            // Failing open would report a resource as clean without executing
            // tenant policy. Surface a warning so the result is explicitly
            // incomplete while keeping an infrastructure outage from becoming
            // a resource-level error.
            logger.warn(
                '[CustomRuleExecutor] Custom rule source unavailable',
                validationFailureMetadata(error),
            );
            return [createValidationIssue({
                code: 'custom-rule-source-unavailable',
                path: resourceType,
                resourceType,
                customMessage: 'Custom rules could not be loaded; this validation result is incomplete',
                severityOverride: 'warning',
                aspectOverride: 'custom_rule',
                details: { sourceStatus: 'unavailable' },
            })];
        }
    }

    /**
     * Check if result implies success (truthy or non-empty)
     */
    private checkResult(result: unknown): boolean {
        if (result === true) return true;
        if (result === false) return false;
        if (Array.isArray(result)) {
            if (result.length === 0) return false;
            // If array contains boolean false, it's failed? FHIRPath semantics:
            // "Non-empty collections are true"
            // BUT: [false] -> usually means result of comparison is false.
            if (result.length === 1 && result[0] === false) return false;
            return true;
        }
        return !!result;
    }
}
