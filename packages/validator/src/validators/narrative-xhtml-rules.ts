import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

/**
 * Elements allowed in FHIR Narrative (per FHIR spec)
 * @see https://www.hl7.org/fhir/narrative.html#xhtml
 */
const ALLOWED_ELEMENTS = new Set([
    'div', 'p', 'br', 'span',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'b', 'i', 'u', 'em', 'strong', 'small', 'big', 'sub', 'sup', 'tt', 'code', 'pre',
    'blockquote', 'q', 'dfn', 'abbr', 'acronym', 'cite', 'samp', 'kbd', 'var', 'ins', 'del',
    'a', 'img',
    'hr',
]);

const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
    '*': new Set(['id', 'class', 'style', 'title', 'lang', 'xml:lang', 'dir', 'xmlns']),
    a: new Set(['href', 'name', 'rel', 'rev', 'target']),
    img: new Set(['src', 'alt', 'height', 'width', 'longdesc', 'usemap']),
    table: new Set(['border', 'cellpadding', 'cellspacing', 'summary', 'width']),
    th: new Set(['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'axis', 'align', 'valign']),
    td: new Set(['colspan', 'rowspan', 'headers', 'abbr', 'axis', 'align', 'valign']),
    col: new Set(['span', 'width', 'align', 'valign']),
    colgroup: new Set(['span', 'width', 'align', 'valign']),
    ol: new Set(['start', 'type']),
    ul: new Set(['type']),
    li: new Set(['value']),
    blockquote: new Set(['cite']),
    q: new Set(['cite']),
    ins: new Set(['cite', 'datetime']),
    del: new Set(['cite', 'datetime']),
};

const FORBIDDEN_PATTERNS = [
    /<script[\s>]/i,
    /javascript:/i,
];

const VOID_ELEMENTS = new Set([
    'br', 'hr', 'img', 'area', 'base', 'col', 'embed',
    'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export function validateNarrativeDiv(div: string, basePath: string, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const xxeIssues = checkXxeDeclarations(div, basePath, resourceType);
    issues.push(...xxeIssues);

    if (!isWellformed(div)) {
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

    if (!hasValidRootElement(div)) {
        issues.push(createValidationIssue({
            code: 'narrative-invalid-root',
            path: `${basePath}.div`,
            resourceType,
            severityOverride: 'error',
            customMessage: 'Narrative div must be <div xmlns="http://www.w3.org/1999/xhtml">',
        }));
    }

    const forbiddenPatterns = checkForbiddenPatterns(div);
    for (const pattern of forbiddenPatterns) {
        issues.push(createValidationIssue({
            code: 'narrative-forbidden-content',
            path: `${basePath}.div`,
            resourceType,
            customMessage: `Narrative contains forbidden content: ${pattern}`,
            details: { pattern },
        }));
    }

    const disallowedElements = findDisallowedElements(div);
    for (const element of disallowedElements) {
        issues.push(createValidationIssue({
            code: 'narrative-invalid-element',
            path: `${basePath}.div`,
            resourceType,
            customMessage: `Narrative contains disallowed element: <${element}>`,
            details: { element },
        }));
    }

    const invalidAttributes = findInvalidAttributes(div);
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
    basePath: string,
    resourceType: string,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const scannable = div
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '');

    if (/<!DOCTYPE\b/i.test(scannable)) {
        issues.push(createValidationIssue({
            code: 'narrative-malformed-xhtml',
            path: `${basePath}.div`,
            resourceType,
            severityOverride: 'error',
            customMessage:
                'Malformed XHTML: Found a DocType declaration, and these are not allowed (XXE security vulnerability protection)',
            details: { violation: 'doctype-declaration' },
        }));
        issues.push(createValidationIssue({
            code: 'narrative-content-xxe-doctype',
            path: `${basePath}.div`,
            resourceType,
            severityOverride: 'error',
            customMessage:
                'Narrative content invalid: DocType declarations are not allowed in FHIR XHTML (XXE security).',
            details: { violation: 'doctype-declaration' },
        }));
    }

    if (/<!ENTITY\b/i.test(scannable)) {
        issues.push(createValidationIssue({
            code: 'narrative-malformed-xhtml',
            path: `${basePath}.div`,
            resourceType,
            severityOverride: 'error',
            customMessage:
                'Malformed XHTML: Found an Entity declaration, and these are not allowed (XXE security vulnerability protection)',
            details: { violation: 'entity-declaration' },
        }));
        issues.push(createValidationIssue({
            code: 'narrative-content-xxe-entity',
            path: `${basePath}.div`,
            resourceType,
            severityOverride: 'error',
            customMessage:
                'Narrative content invalid: Entity declarations are not allowed in FHIR XHTML (XXE security).',
            details: { violation: 'entity-declaration' },
        }));
    }

    return issues;
}

function isWellformed(div: string): boolean {
    try {
        const scannable = div
            .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
            .replace(/<!--[\s\S]*?-->/g, '');

        const bareAmpersand = /&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[0-9a-fA-F]+);)/;
        if (bareAmpersand.test(scannable)) {
            return false;
        }

        const openTags: string[] = [];
        const tagRegex = /<\/?((?:[a-zA-Z][a-zA-Z0-9]*:)?[a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;
        let match;

        while ((match = tagRegex.exec(scannable)) !== null) {
            const fullMatch = match[0];
            const tagName = match[1].toLowerCase();
            const localName = tagName.includes(':') ? tagName.split(':')[1] : tagName;
            if (fullMatch.endsWith('/>') || VOID_ELEMENTS.has(localName)) {
                continue;
            }

            if (fullMatch.startsWith('</')) {
                if (openTags.length === 0 || openTags.pop() !== tagName) {
                    return false;
                }
            } else {
                openTags.push(tagName);
            }
        }

        return openTags.length === 0;
    } catch {
        return false;
    }
}

function hasValidRootElement(div: string): boolean {
    const trimmed = div
        .replace(/^<\?xml[^?]*\?>/, '')
        .replace(/^\s+/, '');

    const divMatch = trimmed.match(/^<([a-zA-Z][a-zA-Z0-9]*:)?div\b[^>]*>/);
    if (!divMatch) return false;

    const rootTag = divMatch[0];
    const prefix = divMatch[1];

    if (prefix) {
        const nsPrefix = prefix.slice(0, -1);
        const xmlnsMatch = rootTag.match(
            new RegExp(`\\bxmlns:${nsPrefix}\\s*=\\s*(["'])([^"']*)\\1`)
        );
        if (!xmlnsMatch) return false;
        return xmlnsMatch[2] === 'http://www.w3.org/1999/xhtml';
    }

    const xmlnsMatch = rootTag.match(/\bxmlns\s*=\s*(["'])([^"']*)\1/);
    if (!xmlnsMatch) return false;
    return xmlnsMatch[2] === 'http://www.w3.org/1999/xhtml';
}

function checkForbiddenPatterns(div: string): string[] {
    const found: string[] = [];
    for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(div)) {
            found.push(pattern.source);
        }
    }
    return found;
}

function findDisallowedElements(div: string): string[] {
    const disallowed: string[] = [];
    const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*:)?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
    let match;

    while ((match = tagRegex.exec(div)) !== null) {
        const tagName = match[2].toLowerCase();
        if (!ALLOWED_ELEMENTS.has(tagName) && !disallowed.includes(tagName)) {
            disallowed.push(tagName);
        }
    }

    return disallowed;
}

function findInvalidAttributes(div: string): Array<{ element: string; attribute: string }> {
    const invalid: Array<{ element: string; attribute: string }> = [];
    const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*:)?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
    let match;

    while ((match = tagRegex.exec(div)) !== null) {
        const tagName = match[2].toLowerCase();
        const attrString = match[3];
        const attrRegex = /([a-zA-Z][a-zA-Z0-9-_:]*)\s*=/g;
        let attrMatch;

        while ((attrMatch = attrRegex.exec(attrString)) !== null) {
            const attrName = attrMatch[1].toLowerCase();
            if (attrName.startsWith('xmlns')) continue;

            const globalAllowed = ALLOWED_ATTRIBUTES['*'];
            const elementAllowed = ALLOWED_ATTRIBUTES[tagName] || new Set();

            if (!globalAllowed.has(attrName) && !elementAllowed.has(attrName)) {
                invalid.push({ element: tagName, attribute: attrName });
            }
        }
    }

    return invalid;
}
