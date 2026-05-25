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
import { validateNarrativeDiv } from './narrative-xhtml-rules';

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
            issues.push(...validateNarrativeDiv(div, basePath, resourceType));

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
                    issues.push(...validateNarrativeDiv(text.div, textPath, 'Composition'));
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

}

// Singleton instance
export const narrativeValidator = new NarrativeValidator();
