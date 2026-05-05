/**
 * Universal Constraints Validator
 * 
 * Validates universal FHIR constraints that apply to all resources:
 * 
 * - ele-1: All FHIR elements must have a @value or children
 * - ref-1: If reference has a reference, it SHALL be a literal URL or fragment
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger } from '../logger';

// ============================================================================
// Universal Constraints Validator
// ============================================================================

export class UniversalConstraintsValidator {

    /**
     * Validate universal constraints on any resource
     */
    validate(resource: any): ValidationIssue[] {
        if (!resource?.resourceType) return [];

        const issues: ValidationIssue[] = [];
        const resourceType = resource.resourceType;

        logger.debug(`[UniversalConstraints] Validating ${resourceType}`);

        // ele-1: All FHIR elements must have a @value or children
        issues.push(...this.validateEle1(resource, resourceType, resourceType));

        // ref-1: References must be valid
        issues.push(...this.validateRef1(resource, resourceType, resourceType));

        return issues;
    }

    /**
     * ele-1: All FHIR elements must have a @value or children
     * 
     * Expression: hasValue() or (children().count() > id.count()) or $this is Parameters
     * Human: All FHIR elements must have a @value or children
     */
    private validateEle1(obj: any, resourceType: string, path: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!obj || typeof obj !== 'object') return issues;

        // Skip arrays, process items individually
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                issues.push(...this.validateEle1(obj[i], resourceType, `${path}[${i}]`));
            }
            return issues;
        }

        // Check for empty objects (no value and no children)
        // Exclude primitive extensions (_field) and certain exceptions
        const keys = Object.keys(obj).filter(k => !k.startsWith('_'));

        // Empty object check
        if (keys.length === 0 && !path.endsWith(']')) {
            // Allow empty at root level or in certain contexts
            if (path !== resourceType && !path.includes('.extension')) {
                issues.push(createValidationIssue({
                    code: 'ele-1-violation',
                    path,
                    resourceType,
                    customMessage: 'ele-1: All FHIR elements must have a @value or children',
                    severityOverride: 'error',
                }));
            }
        }

        // Recurse into children
        for (const key of keys) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                issues.push(...this.validateEle1(obj[key], resourceType, `${path}.${key}`));
            }
        }

        return issues;
    }

    /**
     * ref-1: If reference has a reference, SHALL have a literal URL or fragment
     * 
     * Expression: reference.exists() implies (reference.startsWith('#') or reference.contains('/'))
     * Human: SHALL have a contained resource if a local reference is provided
     */
    private validateRef1(obj: any, resourceType: string, path: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!obj || typeof obj !== 'object') return issues;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                issues.push(...this.validateRef1(obj[i], resourceType, `${path}[${i}]`));
            }
            return issues;
        }

        // Check for reference field
        if (obj.reference !== undefined) {
            const ref = obj.reference;

            if (typeof ref === 'string' && ref.length > 0) {
                // ref-1: reference must start with # (contained) or contain / (resource reference)
                const isFragment = ref.startsWith('#');
                const isLiteralUrl = ref.includes('/');
                const isUrn = ref.startsWith('urn:');

                if (!isFragment && !isLiteralUrl && !isUrn) {
                    issues.push(createValidationIssue({
                        code: 'ref-1-violation',
                        path: `${path}.reference`,
                        resourceType,
                        customMessage: 'ref-1: Reference must be a fragment (#id), literal URL (Type/id), or URN',
                        severityOverride: 'error',
                    }));
                }
            }
        }

        // Recurse into children
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'object' && obj[key] !== null && key !== 'reference') {
                issues.push(...this.validateRef1(obj[key], resourceType, `${path}.${key}`));
            }
        }

        return issues;
    }
}

// Singleton
export const universalConstraintsValidator = new UniversalConstraintsValidator();
