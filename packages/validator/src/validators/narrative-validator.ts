/* eslint-disable max-lines -- xhtml schema enforcement (allowed elements/attrs, forbidden patterns, language tags) and the textLink extension family naturally cluster in one file; splitting fragments cohesive narrative rules */
/**
 * Narrative Validator
 *
 * Validates FHIR Narrative (text.div) XHTML content according to FHIR specification.
 *
 * FHIR Narrative Rules:
 * 1. Must be valid XHTML (well-formed XML)
 * 2. Root element must be <div xmlns="http://www.w3.org/1999/xhtml">
 * 3. Only allowed XHTML elements and attributes
 * 4. No scripts, no forms, no external references
 * 5. No <!DOCTYPE> or <!ENTITY> declarations (XXE attack protection)
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { logger as _logger } from '../logger';

// ============================================================================
// FHIR Allowed XHTML Elements
// ============================================================================

/**
 * Elements allowed in FHIR Narrative (per FHIR spec)
 * @see https://www.hl7.org/fhir/narrative.html#xhtml
 */
const ALLOWED_ELEMENTS = new Set([
    // Structure
    'div', 'p', 'br', 'span',
    // Headers
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // Lists
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    // Text formatting
    'b', 'i', 'u', 'em', 'strong', 'small', 'big', 'sub', 'sup', 'tt', 'code', 'pre',
    'blockquote', 'q', 'dfn', 'abbr', 'acronym', 'cite', 'samp', 'kbd', 'var', 'ins', 'del',
    // Links and images
    'a', 'img',
    // Misc
    'hr'
]);

/**
 * Allowed attributes per element
 */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
    '*': new Set(['id', 'class', 'style', 'title', 'lang', 'xml:lang', 'dir', 'xmlns']),
    'a': new Set(['href', 'name', 'rel', 'rev', 'target']),
    'img': new Set(['src', 'alt', 'height', 'width', 'longdesc', 'usemap']),
    'table': new Set(['border', 'cellpadding', 'cellspacing', 'summary', 'width']),
    'th': new Set(['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'axis', 'align', 'valign']),
    'td': new Set(['colspan', 'rowspan', 'headers', 'abbr', 'axis', 'align', 'valign']),
    'col': new Set(['span', 'width', 'align', 'valign']),
    'colgroup': new Set(['span', 'width', 'align', 'valign']),
    'ol': new Set(['start', 'type']),
    'ul': new Set(['type']),
    'li': new Set(['value']),
    'blockquote': new Set(['cite']),
    'q': new Set(['cite']),
    'ins': new Set(['cite', 'datetime']),
    'del': new Set(['cite', 'datetime']),
};

/**
 * Forbidden patterns in XHTML
 */
const FORBIDDEN_PATTERNS = [
    // Script injection — these are not catchable by the
    // disallowed-element / disallowed-attribute passes (the regex spans
    // an attribute *value*, e.g. `href="javascript:..."`), so they need
    // their own pattern.
    /<script[\s>]/i,
    /javascript:/i,
    // Other forbidden elements (form, input, iframe, object, embed,
    // applet, base, link, meta, …) and event handlers (`onclick=`)
    // overlap perfectly with the disallowed-element / disallowed-
    // attribute passes downstream, so we don't pattern-match them here
    // — emitting both `narrative-forbidden-content` AND the specific
    // diagnostic doubles the count without adding signal and diverges
    // from Java's single-emission baselines (list-xhtml-element,
    // list-xhtml-attribute).
];

/**
 * Extract every `id="…"` attribute value from an xhtml fragment. Used by
 * the textLink-extension check to verify that a `htmlid` sub-extension
 * actually points at an anchor in the rendered narrative.
 */
function extractHtmlIds(div: string): Set<string> {
    const ids = new Set<string>();
    if (typeof div !== 'string' || div.length === 0) return ids;
    // Match `id="..."` and `id='...'` (case-insensitive). Conservatively
    // ignore any id attribute whose value is empty.
    const re = /\bid\s*=\s*(["'])([^"']*)\1/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(div)) !== null) {
        const value = match[2];
        if (value.length > 0) ids.add(value);
    }
    return ids;
}

// ============================================================================
// Narrative Validator
// ============================================================================

export class NarrativeValidator {
    /**
     * Validate narrative content of a resource
     */
    // eslint-disable-next-line max-lines-per-function -- this method is the entry point that orchestrates status / div / language / textLink / Composition.section recursion; splitting the steps would scatter the narrative pipeline.
    validateNarrative(resource: any, resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!resource.text) {
            return issues; // No narrative to validate (existence is checked elsewhere)
        }

        const { status, div } = resource.text;
        const basePath = `${resourceType}.text`;

        // Validate status
        if (status && !['generated', 'extensions', 'additional', 'empty'].includes(status)) {
            issues.push(createValidationIssue({
                code: 'narrative-invalid-status',
                path: `${basePath}.status`,
                resourceType,
                customMessage: `Invalid narrative status '${status}'. Must be one of: generated, extensions, additional, empty`,
            }));
        }

        // Validate div
        if (div) {
            issues.push(...this.validateDiv(div, basePath, resourceType));

            // Language tag check: if the resource has .language, the div
            // should have matching lang AND xml:lang attributes (FHIR rule,
            // see https://www.w3.org/TR/i18n-html-tech-lang/#langvalues)
            if (resource.language && typeof div === 'string') {
                const langMatch = div.match(/\blang\s*=\s*["']([^"']*)["']/);
                const xmlLangMatch = div.match(/\bxml:lang\s*=\s*["']([^"']*)["']/);
                const hasLang = !!langMatch;
                const hasXmlLang = !!xmlLangMatch;

                if (!hasLang && !hasXmlLang) {
                    // Neither lang nor xml:lang present
                    issues.push(createValidationIssue({
                        code: 'narrative-missing-lang',
                        path: resourceType,
                        resourceType,
                        customMessage: `Resource has a language, but the XHTML does not have an lang or an xml:lang tag (needs both - see https://www.w3.org/TR/i18n-html-tech-lang/#langvalues)`,
                        severityOverride: 'warning',
                    }));
                } else {
                    // Check that both lang and xml:lang are present
                    if (!hasXmlLang) {
                        issues.push(createValidationIssue({
                            code: 'narrative-missing-xmllang',
                            path: resourceType,
                            resourceType,
                            customMessage: `Resource has a language, but the XHTML does not have an xml:lang tag (needs both lang and xml:lang - see https://www.w3.org/TR/i18n-html-tech-lang/#langvalues)`,
                            severityOverride: 'warning',
                        }));
                    }
                    if (!hasLang) {
                        issues.push(createValidationIssue({
                            code: 'narrative-missing-htmllang',
                            path: resourceType,
                            resourceType,
                            customMessage: `Resource has a language, but the XHTML does not have a lang tag (needs both lang and xml:lang - see https://www.w3.org/TR/i18n-html-tech-lang/#langvalues)`,
                            severityOverride: 'warning',
                        }));
                    }
                    // Check language mismatch
                    if (hasLang && langMatch[1] && langMatch[1] !== resource.language) {
                        issues.push(createValidationIssue({
                            code: 'narrative-lang-mismatch',
                            path: resourceType,
                            resourceType,
                            customMessage: `Resource has a language (${resource.language}), and the XHTML has a language (${langMatch[1]}), but they differ `,
                            severityOverride: 'warning',
                        }));
                    }
                }
            }
        } else if (status !== 'empty') {
            // div is required unless status is 'empty'
            issues.push(createValidationIssue({
                code: 'narrative-missing-div',
                path: basePath,
                resourceType,
                customMessage: 'Narrative text must have a div element when status is not empty',
            }));
        }

        // textLink extensions on Narrative pin a Reference field's `data`
        // URI to an `id`-attribute target inside the rendered xhtml. Java
        // emits three diagnostics per broken textLink — one each for the
        // missing html anchor, the unresolved data target, and the bad
        // URL value. See ips-link baseline.
        const textExtensions: any[] = Array.isArray(resource.text?.extension)
            ? resource.text.extension
            : [];
        if (textExtensions.length > 0) {
            issues.push(...this.validateTextLinkExtensions(
                resource, basePath, resourceType, textExtensions, typeof div === 'string' ? div : '',
            ));
        }

        // Composition.section is itself BackboneElement-with-Narrative —
        // each `section.text` (and recursively each `section.section.text`,
        // …) must be validated with the same xhtml + textLink rules. The
        // Java reference validator emits the same diagnostics on these
        // nested narratives (see ips-htmlrefs-forwards baseline, which
        // flags `idref` on `tr` inside both Composition.text.div AND
        // Composition.section[0].text.div).
        if (resourceType === 'Composition' && Array.isArray(resource.section)) {
            issues.push(...this.validateCompositionSectionNarratives(
                resource, resource.section, `${resourceType}.section`,
            ));
        }

        return issues;
    }

    /**
     * Recursively validate Composition.section[].text narratives. Each
     * section may carry its own `text` Narrative, and may contain nested
     * `section` BackboneElements.
     */
    private validateCompositionSectionNarratives(
        rootResource: any,
        sections: any[],
        basePath: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            if (!section || typeof section !== 'object') continue;

            const sectionPath = `${basePath}[${i}]`;
            const text = section.text;
            if (text && typeof text === 'object') {
                const textPath = `${sectionPath}.text`;
                if (typeof text.div === 'string') {
                    issues.push(...this.validateDiv(text.div, textPath, 'Composition'));
                }
                const sectionTextExt: any[] = Array.isArray(text.extension) ? text.extension : [];
                if (sectionTextExt.length > 0) {
                    issues.push(...this.validateTextLinkExtensions(
                        rootResource,
                        textPath,
                        'Composition',
                        sectionTextExt,
                        typeof text.div === 'string' ? text.div : '',
                    ));
                }
            }

            if (Array.isArray(section.section)) {
                issues.push(...this.validateCompositionSectionNarratives(
                    rootResource, section.section, `${sectionPath}.section`,
                ));
            }
        }
        return issues;
    }

    /**
     * Validate `Narrative.extension` entries with the HL7-defined
     * `textLink` URL. Each instance must carry sub-extensions `htmlid`
     * (string) and `data` (uri); the htmlid value should appear as an
     * `id="…"` attribute in the rendered xhtml, and the data uri (when it
     * starts with `#`) should resolve to a contained resource id.
     */
    private validateTextLinkExtensions(
        resource: any,
        basePath: string,
        resourceType: string,
        textExtensions: any[],
        div: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const htmlIds = extractHtmlIds(div);
        const containedIds = new Set<string>();
        if (Array.isArray(resource.contained)) {
            for (const c of resource.contained) {
                if (c && typeof c.id === 'string') containedIds.add(c.id);
            }
        }
        const TEXTLINK_URL = 'http://hl7.org/fhir/StructureDefinition/textLink';

        for (let i = 0; i < textExtensions.length; i++) {
            const ext = textExtensions[i];
            if (ext?.url !== TEXTLINK_URL) continue;
            const subs: any[] = Array.isArray(ext.extension) ? ext.extension : [];
            const htmlid = subs.find((s: any) => s?.url === 'htmlid')?.valueString;
            const dataIdx = subs.findIndex((s: any) => s?.url === 'data');
            const dataUri = dataIdx >= 0 ? subs[dataIdx]?.valueUri : undefined;

            if (typeof htmlid === 'string' && htmlid.length > 0 && !htmlIds.has(htmlid)) {
                issues.push(createValidationIssue({
                    code: 'narrative-textlink-htmlid-not-found',
                    path: basePath,
                    resourceType,
                    customMessage: `The html id '${htmlid}' was not found in the xhtml`,
                    severityOverride: 'error',
                }));
            }

            if (typeof dataUri === 'string' && dataUri.startsWith('#')) {
                const targetId = dataUri.substring(1);
                if (targetId.length > 0 && !containedIds.has(targetId)) {
                    issues.push(createValidationIssue({
                        code: 'narrative-textlink-target-not-found',
                        path: basePath,
                        resourceType,
                        customMessage:
                            `The target of the textLink data reference '${dataUri}' was not found in the resource`,
                        severityOverride: 'error',
                    }));
                    issues.push(createValidationIssue({
                        code: 'narrative-textlink-uri-no-target',
                        path: `${basePath}.extension[${i}].extension[${dataIdx}].value.ofType(uri)`,
                        resourceType,
                        customMessage:
                            `The URL value '${dataUri}' is invalid because there is no matching target`,
                        severityOverride: 'error',
                    }));
                }
            }
        }

        return issues;
    }

    /**
     * Validate the div element content
     */
    private validateDiv(div: string, basePath: string, resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // 1. XXE protection: reject DOCTYPE / ENTITY declarations before
        // anything else. Java's validator flags these even when the
        // surrounding markup is otherwise well-formed, so we must check
        // before the well-formedness short-circuit below.
        const xxeIssues = this.checkXxeDeclarations(div, basePath, resourceType);
        issues.push(...xxeIssues);

        // 2. Check for wellformed-ness (basic XML structure)
        if (!this.isWellformed(div)) {
            issues.push(createValidationIssue({
                code: 'narrative-malformed-xhtml',
                path: `${basePath}.div`,
                resourceType,
                severityOverride: 'error',
                customMessage: 'Error parsing XHTML: Malformed XHTML content in narrative div',
            }));
            // Companion emission with category `invalid` (via the `narrative-`
            // prefix fallback). Mirrors Java's two-error shape for malformed
            // XHTML (structural txt-1 + invalid parse-level detail).
            issues.push(createValidationIssue({
                code: 'narrative-content-syntax-error',
                path: `${basePath}.div`,
                resourceType,
                severityOverride: 'error',
                customMessage:
                    'Narrative content invalid: XHTML parse error — the div is not well-formed XML and cannot be validated further.',
            }));
            return issues; // Can't do further validation if malformed
        }

        // 3. Check root element is div with correct namespace
        if (!this.hasValidRootElement(div)) {
            issues.push(createValidationIssue({
                code: 'narrative-invalid-root',
                path: `${basePath}.div`,
                resourceType,
                severityOverride: 'error',
                customMessage: 'Narrative div must be <div xmlns="http://www.w3.org/1999/xhtml">',
            }));
        }

        // 4. Check for forbidden patterns
        const forbiddenPatterns = this.checkForbiddenPatterns(div);
        for (const pattern of forbiddenPatterns) {
            issues.push(createValidationIssue({
                code: 'narrative-forbidden-content',
                path: `${basePath}.div`,
                resourceType,
                customMessage: `Narrative contains forbidden content: ${pattern}`,
                details: { pattern },
            }));
        }

        // 5. Check for disallowed elements
        const disallowedElements = this.findDisallowedElements(div);
        for (const element of disallowedElements) {
            issues.push(createValidationIssue({
                code: 'narrative-invalid-element',
                path: `${basePath}.div`,
                resourceType,
                customMessage: `Narrative contains disallowed element: <${element}>`,
                details: { element },
            }));
        }

        // 6. Check for invalid attributes
        const invalidAttributes = this.findInvalidAttributes(div);
        for (const { element, attribute } of invalidAttributes) {
            issues.push(createValidationIssue({
                code: 'narrative-invalid-attribute',
                path: `${basePath}.div`,
                resourceType,
                customMessage: `Narrative contains disallowed attribute '${attribute}' on <${element}>`,
                details: { element, attribute },
            }));
        }

        // 7. Companion `txt-1` invariant. Java emits BOTH the specific
        //    diagnostic ("Invalid attribute name in the XHTML …",
        //    "Narrative contains disallowed element …") AND the generic
        //    txt-1 invariant violation per Narrative div, so we mirror
        //    that here whenever any structural narrative defect was
        //    detected.
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

    /**
     * XXE (XML External Entity) protection.
     *
     * FHIR XHTML narrative MUST NOT contain DOCTYPE or ENTITY declarations —
     * these are the attack vector for XXE. We reject any such declaration
     * regardless of whether it references external resources, matching the
     * HL7 Java validator's blanket policy.
     */
    private checkXxeDeclarations(
        div: string,
        basePath: string,
        resourceType: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Strip CDATA sections and comments before scanning — a conformant
        // narrative will not contain a DOCTYPE inside a CDATA block, but we
        // still avoid false positives if a legitimate narrative happens to
        // mention the literal text <!DOCTYPE in quoted documentation.
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
            // Companion `narrative-` issue maps to category `invalid` (via
            // the prefix fallback in operation-outcome-converter). The
            // reference validator emits both an `invariant` summary (covered
            // by the structural emission above) and a per-violation
            // `invalid` detail, so we mirror that shape here — without it,
            // list-xhtml-xxe matches only one of Java's two expected errors.
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

    /**
     * Void (self-closing by definition in HTML) elements that do not need
     * an explicit closing tag. Used by both the well-formedness balance
     * check and the disallowed-element scan.
     */
    private static readonly VOID_ELEMENTS = new Set([
        'br', 'hr', 'img', 'area', 'base', 'col', 'embed',
        'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
    ]);

    /**
     * Basic well-formedness check.
     *
     * Intentionally hand-rolled so we do not pull in an XML parser on the
     * validation hot path. We balance tags and additionally reject bare
     * ampersands that are not part of a recognised character or numeric
     * reference — a common corruption that a strict XML parser would catch.
     */
    private isWellformed(div: string): boolean {
        try {
            // Strip comments and CDATA so `<` inside them does not confuse
            // the tag scanner.
            const scannable = div
                .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
                .replace(/<!--[\s\S]*?-->/g, '');

            // Reject bare `&` that is not the start of a valid reference.
            // Valid: &amp; &#123; &#x1A; &lt; etc.
            const bareAmpersand = /&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[0-9a-fA-F]+);)/;
            if (bareAmpersand.test(scannable)) {
                return false;
            }

            const openTags: string[] = [];
            // Handle both plain and namespace-prefixed tags (e.g. <div>, <n:div>)
            const tagRegex = /<\/?((?:[a-zA-Z][a-zA-Z0-9]*:)?[a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;
            let match;

            while ((match = tagRegex.exec(scannable)) !== null) {
                const fullMatch = match[0];
                const tagName = match[1].toLowerCase();

                // Self-closing tags (strip namespace prefix for void element check)
                const localName = tagName.includes(':') ? tagName.split(':')[1] : tagName;
                if (fullMatch.endsWith('/>') || NarrativeValidator.VOID_ELEMENTS.has(localName)) {
                    continue;
                }

                // Closing tag
                if (fullMatch.startsWith('</')) {
                    if (openTags.length === 0 || openTags.pop() !== tagName) {
                        return false;
                    }
                } else {
                    // Opening tag
                    openTags.push(tagName);
                }
            }

            return openTags.length === 0;
        } catch {
            return false;
        }
    }

    /**
     * Check root element is valid XHTML div.
     *
     * Per FHIR narrative spec, the wrapper element must be `<div>` and
     * declare the XHTML namespace — `xmlns="http://www.w3.org/1999/xhtml"`.
     * Either single or double quotes are acceptable; any other namespace
     * (or an omitted xmlns) is rejected.
     */
    private hasValidRootElement(div: string): boolean {
        // Must start with <div> or <prefix:div> (case-sensitive per XML)
        // — skip any leading XML declaration or processing instruction first.
        const trimmed = div
            .replace(/^<\?xml[^?]*\?>/, '')
            .replace(/^\s+/, '');

        // Accept both <div ...> and <prefix:div ...>
        const divMatch = trimmed.match(/^<([a-zA-Z][a-zA-Z0-9]*:)?div\b[^>]*>/);
        if (!divMatch) return false;

        const rootTag = divMatch[0];
        const prefix = divMatch[1]; // e.g. "n:" or undefined

        if (prefix) {
            // Prefixed form: <n:div xmlns:n="http://www.w3.org/1999/xhtml">
            const nsPrefix = prefix.slice(0, -1); // remove trailing ':'
            const xmlnsMatch = rootTag.match(
                new RegExp(`\\bxmlns:${nsPrefix}\\s*=\\s*(["'])([^"']*)\\1`)
            );
            if (!xmlnsMatch) return false;
            return xmlnsMatch[2] === 'http://www.w3.org/1999/xhtml';
        } else {
            // Default namespace form: <div xmlns="http://www.w3.org/1999/xhtml">
            const xmlnsMatch = rootTag.match(/\bxmlns\s*=\s*(["'])([^"']*)\1/);
            if (!xmlnsMatch) return false;
            return xmlnsMatch[2] === 'http://www.w3.org/1999/xhtml';
        }
    }

    /**
     * Check for forbidden patterns
     */
    private checkForbiddenPatterns(div: string): string[] {
        const found: string[] = [];
        for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.test(div)) {
                found.push(pattern.source);
            }
        }
        return found;
    }

    /**
     * Find elements not in the allowed list
     */
    private findDisallowedElements(div: string): string[] {
        const disallowed: string[] = [];
        // Match elements with optional namespace prefix (e.g. <n:div> or <div>)
        const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*:)?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
        let match;

        while ((match = tagRegex.exec(div)) !== null) {
            const tagName = match[2].toLowerCase();
            if (!ALLOWED_ELEMENTS.has(tagName)) {
                if (!disallowed.includes(tagName)) {
                    disallowed.push(tagName);
                }
            }
        }

        return disallowed;
    }

    /**
     * Find attributes not allowed for their elements
     */
    private findInvalidAttributes(div: string): Array<{ element: string; attribute: string }> {
        const invalid: Array<{ element: string; attribute: string }> = [];

        // Match opening tags with optional namespace prefix and attributes
        const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*:)?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
        let match;

        while ((match = tagRegex.exec(div)) !== null) {
            const tagName = match[2].toLowerCase();
            const attrString = match[3];

            // Extract attributes
            const attrRegex = /([a-zA-Z][a-zA-Z0-9-_:]*)\s*=/g;
            let attrMatch;

            while ((attrMatch = attrRegex.exec(attrString)) !== null) {
                const attrName = attrMatch[1].toLowerCase();

                // Namespace declarations (xmlns:*) are always valid in XML
                if (attrName.startsWith('xmlns')) continue;

                // Check if attribute is allowed
                const globalAllowed = ALLOWED_ATTRIBUTES['*'];
                const elementAllowed = ALLOWED_ATTRIBUTES[tagName] || new Set();

                if (!globalAllowed.has(attrName) && !elementAllowed.has(attrName)) {
                    invalid.push({ element: tagName, attribute: attrName });
                }
            }
        }

        return invalid;
    }
}

// Singleton instance
export const narrativeValidator = new NarrativeValidator();
