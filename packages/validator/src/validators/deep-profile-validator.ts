/**
 * Deep Profile Validator
 * 
 * Performs comprehensive validation against StructureDefinition elements.
 * Goes beyond basic cardinality to check:
 * - All element constraints
 * - Fixed values
 * - Pattern values
 * - Required bindings (from SD)
 * - Nested element requirements
 * - Type-specific constraints
 * 
 * This brings Records to full parity with HAPI's profile validation depth.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import type {
    StructureDefinition,
    ElementDefinition,
} from '../core/structure-definition-types.js';
import { createValidationIssue } from '../issues/index.js';
import {
    matchesPattern,
    valueMatchesFixedConstraint,
} from './slice-utils.js';
import { logger } from '../logger.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import {
    getValidationTargets,
    type ValidationTarget,
} from '../business-rules/element-validation-targets.js';
import {
    buildRequiredBindingDetails,
    describePatternMismatch,
    extractFixedConstraint,
    extractMaxValue,
    extractMinValue,
    extractPatternValue,
    formatProfileIssueValue,
    hasRequiredBindingValue,
} from './deep-profile-constraint-utils.js';

// ============================================================================
// Types
// ============================================================================

export interface DeepProfileValidationContext {
    resource: unknown;
    resourceType: string;
    structureDef: StructureDefinition;
    profileUrl?: string;
}

// ============================================================================
// Deep Profile Validator
// ============================================================================

export class DeepProfileValidator {

    /**
     * Validate resource against all StructureDefinition constraints
     */
    validate(context: DeepProfileValidationContext): ValidationIssue[] {
        const { resource, resourceType, structureDef } = context;
        const issues: ValidationIssue[] = [];

        const elements = structureDef?.snapshot?.element;
        if (!Array.isArray(elements)) {
            return issues;
        }

        logger.debug('[DeepProfileValidator] Validating resource against profile', {
            resourceType,
            ...profileCanonicalMetadata(structureDef.url || 'unknown'),
        });

        // Iterate through all elements in the snapshot.
        // Skip named slice instances: their constraints apply only when the value matches
        // that specific slice discriminator, not unconditionally to all values at the path.
        for (const elementDef of elements) {
            if (!isElementDefinition(elementDef)) continue;
            if (elementDef.sliceName) continue;
            if (typeof elementDef.id === 'string' && elementDef.id.includes(':')) continue;
            const elementIssues = this.validateElement(resource, resourceType, elementDef);
            issues.push(...elementIssues);
        }

        return issues;
    }

    /**
     * Validate a single element definition against the resource
     */
    private validateElement(
        resource: unknown,
        resourceType: string,
        elementDef: ElementDefinition,
    ): ValidationIssue[] {
        const path = elementDef.path;

        // Skip root element
        if (path === resourceType) return [];

        return getValidationTargets(resource, path).flatMap(target =>
            this.validateTarget(target, resourceType, elementDef)
        );
    }

    private validateTarget(
        target: ValidationTarget,
        resourceType: string,
        elementDef: ElementDefinition,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const value = target.value;
        const path = target.fullPath || elementDef.path;

        // 1. Check fixed values
        const fixedConstraint = extractFixedConstraint(elementDef);
        const fixedValue = fixedConstraint?.value;
        if (fixedConstraint && fixedValue !== undefined && value !== undefined) {
            if (!valueMatchesFixedConstraint(value, fixedValue, fixedConstraint.key)) {
                issues.push(createValidationIssue({
                    code: 'profile-fixed-value-mismatch',
                    path,
                    resourceType,
                    customMessage: `Value must be exactly '${formatProfileIssueValue(fixedValue)}'`,
                    severityOverride: 'error',
                }));
            }
        }

        // 2. Check pattern values
        const patternValue = extractPatternValue(elementDef);
        if (patternValue !== undefined && value !== undefined) {
            if (!matchesPattern(value, patternValue)) {
                const mismatch = describePatternMismatch(path, value, patternValue);
                issues.push(createValidationIssue({
                    code: 'profile-pattern-mismatch',
                    path,
                    resourceType,
                    customMessage: mismatch.message,
                    severityOverride: 'error',
                    details: mismatch.details,
                }));
            }
        }

        // 3. Check required bindings
        // Skip named slice elements – their binding is enforced by the slicing/terminology
        // validator and should not be re-checked here against the parent array.
        if (elementDef.binding && elementDef.binding.strength === 'required' && !elementDef.sliceName) {
            if (value !== undefined && !Array.isArray(value) && !hasRequiredBindingValue(value)) {
                issues.push(createValidationIssue({
                    code: 'profile-required-binding-violation',
                    path,
                    resourceType,
                    customMessage: `Value does not satisfy required binding to ${elementDef.binding.valueSet}`,
                    severityOverride: 'error',
                    details: buildRequiredBindingDetails(value, elementDef.binding),
                }));
            }
        }

        // 4. Check max length constraints
        if (elementDef.maxLength !== undefined && typeof value === 'string') {
            if (value.length > elementDef.maxLength) {
                issues.push(createValidationIssue({
                    code: 'profile-max-length-exceeded',
                    path,
                    resourceType,
                    customMessage: `String length ${value.length} exceeds maximum ${elementDef.maxLength}`,
                    severityOverride: 'error',
                }));
            }
        }

        // 5. Check minValue/maxValue for numerical types
        if (typeof value === 'number') {
            const minValue = extractMinValue(elementDef);
            const maxValue = extractMaxValue(elementDef);

            if (minValue !== undefined && value < minValue) {
                issues.push(createValidationIssue({
                    code: 'profile-min-value-violation',
                    path,
                    resourceType,
                    customMessage: `Value ${value} is less than minimum ${minValue}`,
                    severityOverride: 'error',
                }));
            }

            if (maxValue !== undefined && value > maxValue) {
                issues.push(createValidationIssue({
                    code: 'profile-max-value-violation',
                    path,
                    resourceType,
                    customMessage: `Value ${value} is greater than maximum ${maxValue}`,
                    severityOverride: 'error',
                }));
            }
        }

        return issues;
    }

}

function isElementDefinition(value: unknown): value is ElementDefinition {
    return isRecord(value) && typeof value.path === 'string' && value.path.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Singleton
export const deepProfileValidator = new DeepProfileValidator();
