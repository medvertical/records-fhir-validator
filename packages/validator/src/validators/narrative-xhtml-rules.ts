import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import {
    findDisallowedNarrativeElements,
    findForbiddenNarrativePatterns,
    findInvalidNarrativeAttributes,
    findXxeDeclarations,
    hasNonWhitespaceNarrativeContent,
    hasValidNarrativeRoot,
    isNarrativeXhtmlWellformed,
} from './narrative-xhtml-scanner.js';

/**
 * htmlChecks() on non-narrative xhtml (e.g. the rendering-xhtml extension's
 * valueString, constrained by xhtml-ext-1) validates an XHTML *fragment*:
 * well-formedness and the content policy apply, but the Narrative-only
 * root-div and txt-2 rules do not — `<img src="..."/>` alone is legal there.
 */
export function validateXhtmlFragment(
    fragment: string,
    path: string,
    resourceType: string,
): ValidationIssue[] {
    const issues = checkXxeDeclarations(fragment, path, resourceType);

    if (!isNarrativeXhtmlWellformed(fragment)) {
        issues.push(createValidationIssue({
            code: 'narrative-malformed-xhtml',
            path,
            resourceType,
            severityOverride: 'error',
            customMessage: 'Error parsing XHTML: Malformed XHTML content',
        }));
        return issues;
    }

    for (const pattern of findForbiddenNarrativePatterns(fragment)) {
        issues.push(createValidationIssue({
            code: 'narrative-forbidden-content',
            path,
            resourceType,
            customMessage: `XHTML contains forbidden content: ${pattern}`,
            details: { pattern },
        }));
    }
    for (const element of findDisallowedNarrativeElements(fragment)) {
        issues.push(createValidationIssue({
            code: 'narrative-invalid-element',
            path,
            resourceType,
            customMessage: `XHTML contains disallowed element: <${element}>`,
            details: { element },
        }));
    }
    for (const { element, attribute } of findInvalidNarrativeAttributes(fragment)) {
        issues.push(createValidationIssue({
            code: 'narrative-invalid-attribute',
            path,
            resourceType,
            customMessage: `XHTML contains disallowed attribute '${attribute}' on <${element}>`,
            details: { element, attribute },
        }));
    }
    return issues;
}

export function validateNarrativeDiv(div: unknown, basePath: string, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (typeof div !== 'string') {
        return [createValidationIssue({
            code: 'structural-primitive-type-mismatch',
            path: `${basePath}.div`,
            resourceType,
            customMessage: `Element ${basePath}.div has invalid type: expected xhtml, found ${Array.isArray(div) ? 'array' : typeof div}`,
            severityOverride: 'error',
            details: {
                expectedType: 'xhtml',
                actualType: Array.isArray(div) ? 'array' : typeof div,
            },
        })];
    }

    const xxeIssues = checkXxeDeclarations(div, `${basePath}.div`, resourceType);
    issues.push(...xxeIssues);

    if (!isNarrativeXhtmlWellformed(div)) {
        issues.push(createValidationIssue({
            code: 'narrative-malformed-xhtml',
            path: `${basePath}.div`,
            resourceType,
            severityOverride: 'error',
            customMessage: 'Error parsing XHTML: Malformed XHTML content in narrative div',
        }));
        issues.push(createValidationIssue({
            code: 'narrative-content-syntax-error',
            path: `${basePath}.div`,
            resourceType,
            severityOverride: 'error',
            customMessage:
                'Narrative content invalid: XHTML parse error — the div is not well-formed XML and cannot be validated further.',
        }));
        return issues;
    }

    if (!hasValidNarrativeRoot(div)) {
        issues.push(createValidationIssue({
            code: 'narrative-invalid-root',
            path: `${basePath}.div`,
            resourceType,
            severityOverride: 'error',
            customMessage: 'Narrative div must be <div xmlns="http://www.w3.org/1999/xhtml">',
        }));
    }

    if (!hasNonWhitespaceNarrativeContent(div)) {
        issues.push(createValidationIssue({
            code: 'narrative-txt2-violation',
            path: `${basePath}.div`,
            resourceType,
            severityOverride: 'error',
            customMessage:
                `Constraint failed: txt-2: 'The narrative SHALL have some non-whitespace content' ` +
                `(defined in http://hl7.org/fhir/StructureDefinition/Narrative)`,
        }));
    }

    const forbiddenPatterns = findForbiddenNarrativePatterns(div);
    for (const pattern of forbiddenPatterns) {
        issues.push(createValidationIssue({
            code: 'narrative-forbidden-content',
            path: `${basePath}.div`,
            resourceType,
            customMessage: `Narrative contains forbidden content: ${pattern}`,
            details: { pattern },
        }));
    }

    const disallowedElements = findDisallowedNarrativeElements(div);
    for (const element of disallowedElements) {
        issues.push(createValidationIssue({
            code: 'narrative-invalid-element',
            path: `${basePath}.div`,
            resourceType,
            customMessage: `Narrative contains disallowed element: <${element}>`,
            details: { element },
        }));
    }

    const invalidAttributes = findInvalidNarrativeAttributes(div);
    for (const { element, attribute } of invalidAttributes) {
        issues.push(createValidationIssue({
            code: 'narrative-invalid-attribute',
            path: `${basePath}.div`,
            resourceType,
            customMessage: `Narrative contains disallowed attribute '${attribute}' on <${element}>`,
            details: { element, attribute },
        }));
    }

    if (disallowedElements.length > 0 || invalidAttributes.length > 0) {
        issues.push(createValidationIssue({
            code: 'narrative-txt1-violation',
            path: `${basePath}.div`,
            resourceType,
            customMessage:
                `Constraint failed: txt-1: 'The narrative SHALL contain only the basic html ` +
                `formatting elements and attributes described in chapters 7-11 (except section 4 of chapter 9) ` +
                `and 15 of the HTML 4.0 standard, <a> elements (either name or href), images and internally ` +
                `contained style attributes' (defined in http://hl7.org/fhir/StructureDefinition/Narrative)`,
            severityOverride: 'error',
        }));
    }

    return issues;
}

function checkXxeDeclarations(
    div: string,
    issuePath: string,
    resourceType: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const declarations = findXxeDeclarations(div);
    if (declarations.includes('doctype')) {
        issues.push(createValidationIssue({
            code: 'narrative-malformed-xhtml',
            path: issuePath,
            resourceType,
            severityOverride: 'error',
            customMessage:
                'Malformed XHTML: Found a DocType declaration, and these are not allowed (XXE security vulnerability protection)',
            details: { violation: 'doctype-declaration' },
        }));
        issues.push(createValidationIssue({
            code: 'narrative-content-xxe-doctype',
            path: issuePath,
            resourceType,
            severityOverride: 'error',
            customMessage:
                'Narrative content invalid: DocType declarations are not allowed in FHIR XHTML (XXE security).',
            details: { violation: 'doctype-declaration' },
        }));
    }

    if (declarations.includes('entity')) {
        issues.push(createValidationIssue({
            code: 'narrative-malformed-xhtml',
            path: issuePath,
            resourceType,
            severityOverride: 'error',
            customMessage:
                'Malformed XHTML: Found an Entity declaration, and these are not allowed (XXE security vulnerability protection)',
            details: { violation: 'entity-declaration' },
        }));
        issues.push(createValidationIssue({
            code: 'narrative-content-xxe-entity',
            path: issuePath,
            resourceType,
            severityOverride: 'error',
            customMessage:
                'Narrative content invalid: Entity declarations are not allowed in FHIR XHTML (XXE security).',
            details: { violation: 'entity-declaration' },
        }));
    }

    return issues;
}
