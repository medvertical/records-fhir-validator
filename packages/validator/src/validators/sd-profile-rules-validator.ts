import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

export function validateProfileRules(matched: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { element, data, resourcePath } = matched;

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
    if (element.fixedUri !== undefined) {
        addFixedUriIssue(issues, element, data, resourcePath, resourceType);
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

function addFixedUriIssue(
    issues: ValidationIssue[],
    element: any,
    data: any,
    resourcePath: string,
    resourceType: string
): void {
    const fixed = element.fixedUri;
    if (data === fixed) return;

    issues.push(createValidationIssue({
        code: 'profile-fixed-value-mismatch',
        path: resourcePath,
        resourceType,
        customMessage: `URI must be exactly '${fixed}'`,
        severityOverride: 'error'
    }));
}
