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

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { validateNarrativeDiv } from './narrative-xhtml-rules.js';

/**
 * Extract every fragment-link target from an xhtml fragment: `id="…"`
 * attribute values plus legacy `<a name="…">` anchors. The IG-publisher's
 * generated narratives anchor contained resources and questionnaire options
 * with `<a name>` (e.g. `hc<resourceId>/<containedId>`, `opt-item.<linkId>`),
 * and the HL7 validator resolves local hyperlinks against both anchor forms.
 * Also used by the textLink-extension check to verify that a `htmlid`
 * sub-extension actually points at an anchor in the rendered narrative.
 */
function extractAnchorTargets(div: string): Set<string> {
    const targets = new Set<string>();
    if (typeof div !== 'string' || div.length === 0) return targets;
    const scannable = div
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const tagPattern = /<(?!\/|!|\?)[A-Za-z][A-Za-z0-9:.-]*\b[^>]*>/g;
    for (const tag of scannable.match(tagPattern) ?? []) {
        const idMatch = tag.match(/\bid\s*=\s*(["'])([^"']+)\1/i);
        if (idMatch?.[2]) targets.add(idMatch[2]);
        if (!/^<a\b/i.test(tag)) continue;
        // `[^\w-]` guard keeps attribute lookalikes such as data-name out.
        const nameMatch = tag.match(/[^\w-]name\s*=\s*(["'])([^"']+)\1/i);
        if (nameMatch?.[2]) targets.add(nameMatch[2]);
    }
    return targets;
}

// ============================================================================
// Narrative Validator
// ============================================================================

export class NarrativeValidator {
    /**
     * Validate narrative content of a resource
     */
    validateNarrative(resource: unknown, resourceType: string): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (!isRecord(resource) || !isRecord(resource.text)) {
            return issues; // No narrative to validate (existence is checked elsewhere)
        }

        const { status, div } = resource.text;
        const basePath = `${resourceType}.text`;

        // Validate status
        if (
            typeof status === 'string' &&
            status.length > 0 &&
            !['generated', 'extensions', 'additional', 'empty'].includes(status)
        ) {
            issues.push(createValidationIssue({
                code: 'narrative-invalid-status',
                path: `${basePath}.status`,
                resourceType,
                customMessage: `Invalid narrative status '${status}'. Must be one of: generated, extensions, additional, empty`,
            }));
        }

        // Validate div
        if (typeof div === 'string' && div.length > 0) {
            issues.push(...validateNarrativeDiv(div, basePath, resourceType));
            issues.push(...validateLocalNarrativeHyperlinks(div, `${basePath}.div`, resourceType));

            // Language tag check: if the resource has .language, the div
            // should have matching lang AND xml:lang attributes (FHIR rule,
            // see https://www.w3.org/TR/i18n-html-tech-lang/#langvalues)
            if (typeof resource.language === 'string' && resource.language.length > 0) {
                const resourceLanguage = resource.language;
                // `\blang` also matches the `lang` suffix in `xml:lang`.
                // Require an actual attribute boundary so xml:lang alone does
                // not incorrectly satisfy the separate HTML lang requirement.
                const langMatch = div.match(/(?:^|[\s<])lang\s*=\s*["']([^"']*)["']/);
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
                    const languages = [langMatch?.[1], xmlLangMatch?.[1]]
                        .filter((language): language is string => typeof language === 'string');
                    const hasMismatch = languages.some(language =>
                        language.toLocaleLowerCase() !== resourceLanguage.toLocaleLowerCase()
                    );
                    if (hasMismatch) {
                        issues.push(createValidationIssue({
                            code: 'narrative-lang-mismatch',
                            path: resourceType,
                            resourceType,
                            customMessage:
                                `Resource has language '${resourceLanguage}', but the XHTML language ` +
                                `attributes (${languages.join(', ')}) differ`,
                            severityOverride: 'warning',
                        }));
                    }
                }
            }
        } else if (div !== undefined && div !== null && typeof div !== 'string') {
            issues.push(...validateNarrativeDiv(div, basePath, resourceType));
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
        const textExtensions: unknown[] = Array.isArray(resource.text.extension)
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
                resource,
                resource.section,
                `${resourceType}.section`,
                new WeakSet<object>(),
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
        rootResource: Record<string, unknown>,
        sections: unknown[],
        basePath: string,
        ancestors: WeakSet<object>,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            if (!isRecord(section) || ancestors.has(section)) continue;
            ancestors.add(section);

            try {
                const sectionPath = `${basePath}[${i}]`;
                const text = section.text;
                if (isRecord(text)) {
                    const textPath = `${sectionPath}.text`;
                    if (text.div !== undefined && text.div !== null) {
                        issues.push(...validateNarrativeDiv(text.div, textPath, 'Composition'));
                    }
                    const sectionTextExt: unknown[] = Array.isArray(text.extension) ? text.extension : [];
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
                        rootResource,
                        section.section,
                        `${sectionPath}.section`,
                        ancestors,
                    ));
                }
            } finally {
                ancestors.delete(section);
            }
        }
        return issues;
    }

    /**
     * Validate `Narrative.extension` entries with the HL7-defined
     * `textLink` URL. Each instance must carry sub-extensions `htmlid`
     * (string) and `data` (uri); the htmlid value should appear as an
     * `id="…"` attribute in the rendered xhtml, and the data uri (when it
     * starts with `#`) should resolve to an id in that same xhtml.
     */
    private validateTextLinkExtensions(
        resource: Record<string, unknown>,
        basePath: string,
        resourceType: string,
        textExtensions: unknown[],
        div: string,
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const htmlIds = extractAnchorTargets(div);
        const TEXTLINK_URL = 'http://hl7.org/fhir/StructureDefinition/textLink';

        for (let i = 0; i < textExtensions.length; i++) {
            const ext = textExtensions[i];
            if (!isRecord(ext) || ext.url !== TEXTLINK_URL) continue;
            const subs: unknown[] = Array.isArray(ext.extension) ? ext.extension : [];
            const htmlidExtension = subs.find(sub =>
                isRecord(sub) && sub.url === 'htmlid'
            );
            const htmlid = isRecord(htmlidExtension)
                ? htmlidExtension.valueString
                : undefined;
            const dataIdx = subs.findIndex(sub =>
                isRecord(sub) && sub.url === 'data'
            );
            const dataExtension = dataIdx >= 0 ? subs[dataIdx] : undefined;
            const dataUri = isRecord(dataExtension)
                ? dataExtension.valueUri
                : undefined;

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
                if (targetId.length > 0 && !htmlIds.has(targetId)) {
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

function validateLocalNarrativeHyperlinks(
    div: string,
    path: string,
    resourceType: string,
): ValidationIssue[] {
    const anchorTargets = extractAnchorTargets(div);
    const issues: ValidationIssue[] = [];
    const scannable = div
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])#([^"']+)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;

    for (const match of scannable.matchAll(anchorPattern)) {
        const targetId = match[2];
        if (!targetId || anchorTargets.has(targetId)) continue;
        const label = match[3].replace(/<[^>]*>/g, '').trim();
        issues.push(createValidationIssue({
            code: 'narrative-hyperlink-target-not-found',
            path,
            resourceType,
            customMessage:
                `Hyperlink '#${targetId}'${label ? ` for '${label}'` : ''} does not resolve`,
            severityOverride: 'error',
            details: { targetId, label },
        }));
    }

    return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
