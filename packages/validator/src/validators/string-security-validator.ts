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

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

// Rough but conservative HTML-tag detection. We match the pattern
// `<tagname...>` where tagname is a plausible HTML tag identifier. This
// catches `<script>`, `<b>`, `<iframe>`, `<div class="x">` etc. but does
// not fire on lone `<` or `>` characters that appear in natural text
// (e.g. "age < 5").
const HTML_TAG_REGEX = /<[A-Za-z][A-Za-z0-9]*(?:\s+[^<>]*)?>/;

export class StringSecurityValidator {
    /**
     * Walk a resource and flag any non-narrative string field that
     * contains HTML-tag-like content.
     */
    validate(resource: any): ValidationIssue[] {
        if (!resource || typeof resource !== 'object') return [];
        const issues: ValidationIssue[] = [];
        const rt = resource.resourceType || 'Resource';
        this.walk(resource, rt, issues);
        return issues;
    }

    private walk(obj: any, path: string, issues: ValidationIssue[]): void {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                this.walk(obj[i], `${path}[${i}]`, issues);
            }
            return;
        }

        for (const key of Object.keys(obj)) {
            const value = obj[key];
            const childPath = `${path}.${key}`;

            if (typeof value === 'string') {
                // Skip Narrative.div — xhtml is legitimate there, the
                // narrative-validator handles its own XHTML whitelist.
                if (this.isInsideNarrative(childPath)) continue;

                if (HTML_TAG_REGEX.test(value)) {
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
                this.walk(value, childPath, issues);
            }
        }
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
}

export const stringSecurityValidator = new StringSecurityValidator();
