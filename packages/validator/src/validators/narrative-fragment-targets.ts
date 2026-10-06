import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

/**
 * Extract every fragment-link target from an xhtml fragment: `id="…"`
 * attribute values plus legacy `<a name="…">` anchors. The IG-publisher's
 * generated narratives anchor contained resources and questionnaire options
 * with `<a name>` (e.g. `hc<resourceId>/<containedId>`, `opt-item.<linkId>`),
 * and the HL7 validator resolves local hyperlinks against both anchor forms.
 * textLink separately requires an XHTML id; a legacy name is not that witness.
 */
export function extractAnchorTargets(div: string): Set<string> {
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

/**
 * An image drawn from inside the resource (`<img src="#diagram">`) names an
 * id the resource carries: a contained resource, an element, or an element of
 * one of its narratives.
 */
export function validateNarrativeImageSources(
    div: string,
    resource: Record<string, unknown>,
    path: string,
    resourceType: string,
): ValidationIssue[] {
    const scannable = div
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const sources = [...scannable.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])#([^"']+)\1/gi)].map(match => match[2]);
    if (sources.length === 0) return [];
    const targets = fragmentTargets(resource, new Set());
    return sources.filter(targetId => !targets.has(targetId)).map(targetId => createValidationIssue({
        code: 'narrative-image-target-not-found',
        path,
        resourceType,
        customMessage: `Image source '#${targetId}' does not resolve`,
        severityOverride: 'error',
        details: { targetId },
    }));
}

/** textLink names an XHTML id and a structured data element independently. */
export function validateNarrativeTextLinks(
    resource: Record<string, unknown>,
    div: string,
    textExtensions: unknown[],
    path: string,
    resourceType: string,
    enclosingBundle?: Record<string, unknown>,
): ValidationIssue[] {
    const htmlIds = xhtmlIds(div);
    const issues: ValidationIssue[] = [];
    for (const extension of textExtensions) {
        if (!isRecord(extension) || extension.url !== 'http://hl7.org/fhir/StructureDefinition/textLink') continue;
        const children = Array.isArray(extension.extension) ? extension.extension.filter(isRecord) : [];
        const hasSelector = children.some(child => child.url === 'selector');
        for (const child of children) {
            if (child.url === 'htmlid' && typeof child.valueString === 'string'
                && child.valueString.length > 0 && !htmlIds.has(child.valueString)) {
                issues.push(createValidationIssue({
                    code: 'narrative-textlink-htmlid-not-found', path, resourceType,
                    customMessage: `The html id '${child.valueString}' was not found in the xhtml`,
                    severityOverride: 'error',
                }));
            }
            if (child.url !== 'data' || typeof child.valueUri !== 'string' || child.valueUri.length === 0) continue;
            const result = hasSelector ? 'unknown' : resolveTextLinkData(resource, child.valueUri, enclosingBundle);
            if (result !== 'present') issues.push(textLinkDataIssue(result, child.valueUri, path, resourceType, hasSelector));
        }
    }
    return issues;
}

function textLinkDataIssue(
    result: 'missing' | 'unknown', uri: string, path: string, resourceType: string, hasSelector: boolean,
): ValidationIssue {
    return createValidationIssue({
        code: result === 'missing' ? 'narrative-textlink-target-not-found' : 'narrative-textlink-target-unverified',
        path, resourceType, severityOverride: result === 'missing' ? 'error' : 'information',
        customMessage: result === 'missing'
            ? `The target of the textLink data reference '${uri}' was not found in the resource`
            : `The textLink data reference '${uri}' could not be verified with the available resource context and selection`,
        details: result === 'unknown' ? {
            validationComplete: false, validationStatus: 'incomplete',
            reason: hasSelector ? 'textlink-selector-unverified' : 'textlink-target-context-unavailable',
        } : undefined,
    });
}

function xhtmlIds(div: string): Set<string> {
    const targets = new Set<string>();
    const scannable = div.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    // Read complete quoted attributes so their text and lookalike names cannot supply an id.
    const tags = /<(?!\/|!|\?)[A-Za-z][A-Za-z0-9:.-]*(?:"[^"]*"|'[^']*'|[^'">])*?>/g;
    const attributes = /(?:^|\s)([A-Za-z_:][\w.:-]*)\s*=\s*(["'])(.*?)\2/gs;
    for (const tag of scannable.match(tags) ?? []) {
        for (const attribute of tag.matchAll(attributes)) {
            if (attribute[1] === 'id' && attribute[3]) targets.add(attribute[3]);
        }
    }
    return targets;
}

function resolveTextLinkData(
    resource: Record<string, unknown>,
    uri: string,
    enclosingBundle?: Record<string, unknown>,
): 'present' | 'missing' | 'unknown' {
    const entries = boundBundleEntries(resource, enclosingBundle);
    if (uri.startsWith('#')) {
        const fragment = uri.slice(1);
        if (elementIds(resource).has(fragment)) return 'present';
        // A Bundle fragment may name a sibling resource, never an arbitrary sibling element.
        if (entries?.some(entry => isResource(entry.resource) && entry.resource.id === fragment)) return 'present';
        return enclosingBundle && !entries ? 'unknown' : 'missing';
    }
    const fragmentAt = uri.indexOf('#');
    const resourceUri = fragmentAt < 0 ? uri : uri.slice(0, fragmentAt);
    const selectedEntries = entries?.filter(entry => isResource(entry.resource)
        && (entry.fullUrl === resourceUri || (typeof entry.resource.id === 'string' && entry.resource.id.length > 0
            && resourceUri === `${entry.resource.resourceType}/${entry.resource.id}`)));
    const selected = selectedEntries?.length === 1 ? selectedEntries[0].resource : undefined;
    // No base URL, network fetch, or suffix match can attest an unavailable resource.
    if (!isRecord(selected)) return 'unknown';
    return fragmentAt < 0 || elementIds(selected).has(uri.slice(fragmentAt + 1)) ? 'present' : 'missing';
}

function boundBundleEntries(
    resource: Record<string, unknown>,
    bundle: Record<string, unknown> | undefined,
): Record<string, unknown>[] | undefined {
    if (bundle?.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) return undefined;
    const entries = bundle.entry.filter(isRecord).filter(entry => isResource(entry.resource));
    return entries.some(entry => entry.resource === resource) ? entries : undefined;
}

function isResource(value: unknown): value is Record<string, unknown> {
    return isRecord(value) && typeof value.resourceType === 'string' && value.resourceType.length > 0;
}

function elementIds(value: unknown, targets = new Set<string>(), seen = new WeakSet<object>()): Set<string> {
    if (typeof value !== 'object' || value === null || seen.has(value)) return targets;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const child of value) elementIds(child, targets, seen);
    } else if (isRecord(value)) {
        if (typeof value.id === 'string' && value.id.length > 0) targets.add(value.id);
        for (const child of Object.values(value)) elementIds(child, targets, seen);
    }
    return targets;
}

function fragmentTargets(value: unknown, targets: Set<string>): Set<string> {
    if (Array.isArray(value)) {
        for (const item of value) fragmentTargets(item, targets);
    } else if (isRecord(value)) {
        if (typeof value.id === 'string') targets.add(value.id);
        for (const [key, child] of Object.entries(value)) {
            if (key === 'div' && typeof child === 'string') extractAnchorTargets(child).forEach(id => targets.add(id));
            else fragmentTargets(child, targets);
        }
    }
    return targets;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
