/**
 * String Security Validator
 *
 * Detects embedded HTML tags in non-narrative string fields. FHIR requires
 * that plain string / text / markdown values remain free of HTML / script
 * content for security reasons; only `Narrative.div` (which is typed as
 * `xhtml`) is allowed to carry HTML content, and that is handled by the
 * dedicated narrative-validator.
 *
 * The Java reference validator emits this as:
 *   severity: error
 *   code: invalid
 *   text: "The string value contains text that looks like embedded HTML
 *          tags, which are not allowed for security reasons in this context"
 *
 * See `pat-security-bad-string` baseline in fhir-test-cases.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

const HTML_TAG_NAMES = new Set([
    'a', 'abbr', 'acronym', 'address', 'area', 'article', 'aside', 'audio',
    'b', 'base', 'bdi', 'bdo', 'big', 'blockquote', 'body', 'br', 'button',
    'canvas', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'data',
    'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'dir', 'div', 'dl',
    'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'font', 'footer',
    'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head',
    'header', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd',
    'label', 'legend', 'li', 'link', 'main', 'map', 'mark', 'meta', 'meter',
    'nav', 'noframes', 'noscript', 'object', 'ol', 'optgroup', 'option',
    'output', 'p', 'param', 'picture', 'pre', 'progress', 'q', 'rp', 'rt',
    'ruby', 's', 'samp', 'script', 'section', 'select', 'small', 'source',
    'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup', 'svg',
    'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead',
    'time', 'title', 'tr', 'track', 'tt', 'u', 'ul', 'var', 'video', 'wbr',
]);

const TAG_LIKE_REGEX = /<\/?([A-Za-z][A-Za-z0-9]*)(?=\s|\/?>)/g;

function containsHtmlTag(value: string): boolean {
    for (const match of value.matchAll(TAG_LIKE_REGEX)) {
        if (HTML_TAG_NAMES.has(match[1].toLowerCase())) return true;
    }
    return false;
}

export class StringSecurityValidator {
    /**
     * Walk a resource and flag any non-narrative string field that
     * contains HTML-tag-like content.
     */
    validate(resource: unknown): ValidationIssue[] {
        if (!resource || typeof resource !== 'object') return [];
        const issues: ValidationIssue[] = [];
        const record = Array.isArray(resource) ? null : resource as Record<string, unknown>;
        const rt = typeof record?.resourceType === 'string' ? record.resourceType : 'Resource';
        this.walk(resource, rt, issues, new WeakSet<object>());
        return issues;
    }

    private walk(
        obj: unknown,
        path: string,
        issues: ValidationIssue[],
        visited: WeakSet<object>,
    ): void {
        if (!obj || typeof obj !== 'object') return;
        if (visited.has(obj)) return;
        visited.add(obj);

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                this.walk(obj[i], `${path}[${i}]`, issues, visited);
            }
            return;
        }
        const record = obj as Record<string, unknown>;

        for (const [key, value] of Object.entries(record)) {
            const childPath = `${path}.${key}`;

            if (typeof value === 'string') {
                // Skip Narrative.div — xhtml is legitimate there, the
                // narrative-validator handles its own XHTML whitelist.
                if (this.isInsideNarrative(childPath)) continue;
                if (this.isConformanceDefinitionDocumentation(childPath)) continue;
                if (this.isRenderingXhtmlExtensionValue(record, key)) continue;

                if (containsHtmlTag(value)) {
                    issues.push(createValidationIssue({
                        code: 'string-security-html',
                        path: childPath,
                        resourceType: path.split('.')[0],
                        customMessage:
                            'The string value contains text that looks like embedded ' +
                            'HTML tags, which are not allowed for security reasons in this context',
                        // Warning, not error: the FHIR spec does not
                        // explicitly forbid HTML in string fields (only
                        // recommends plain text). This is a Records
                        // security best-practice check — valuable for
                        // customers but not a conformance violation that
                        // should fail a resource.
                        severityOverride: 'warning',
                    }));
                }
            } else if (value && typeof value === 'object') {
                this.walk(value, childPath, issues, visited);
            }
        }
    }

    private isRenderingXhtmlExtensionValue(
        parent: Record<string, unknown>,
        key: string,
    ): boolean {
        return key === 'valueString' &&
            parent.url === 'http://hl7.org/fhir/StructureDefinition/rendering-xhtml';
    }

    /**
     * Check if a given path points inside a narrative payload where
     * XHTML is the expected content type. Narrative shows up as
     * `<Resource>.text.div` (R4) and within `contained[n].text.div`,
     * `Composition.section.text.div`, etc. We treat any `.text.div`
     * suffix as a narrative slot and skip the HTML check there.
     */
    private isInsideNarrative(path: string): boolean {
        return path.endsWith('.text.div') || /\.text\.div\b/.test(path);
    }

    /**
     * StructureDefinitions often carry formal prose, XPath/FHIRPath, and mapping
     * expressions that mention XHTML/XML tokens like `<a>` as literal grammar.
     * Those are not patient-facing narrative strings and should not be treated
     * as embedded HTML content.
     */
    private isConformanceDefinitionDocumentation(path: string): boolean {
        if (!/^StructureDefinition\.(snapshot|differential)\.element\[\d+\]\./.test(path)) {
            return false;
        }

        return (
            /\.(comment|definition|requirements|meaningWhenMissing)$/.test(path) ||
            /\.constraint\[\d+\]\.(human|expression|xpath)$/.test(path) ||
            /\.mapping\[\d+\]\.map$/.test(path)
        );
    }
}
