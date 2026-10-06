import type { BundleReferenceIndexes, ResolvedReference } from './bundle-cross-entry-reference-resolution.js';

/** A reference inside a document or message Bundle, with how it resolved. */
export interface ClosedBundleReference {
    entryIndex: number;
    resource: Record<string, unknown>;
    ref: string;
    refPath: string;
    resolved: ResolvedReference;
}

const DOCUMENT_ANCHOR_REFERENCE = /^(?:subject|author(?:\[\d+\])?|encounter|custodian|attester\[\d+\]\.party|event\[\d+\]\.detail(?:\[\d+\])?|(?:section\[\d+\]\.)+(?:author(?:\[\d+\])?|focus|entry(?:\[\d+\])?))$/;
const MESSAGE_ANCHOR_REFERENCE = /^focus(?:\[\d+\])?$/;
const RESTFUL_BASE = /^(?:https?:\/\/(?:[A-Za-z0-9\\.:%$_-]*\/)*)?$/;
const RESTFUL_ID = /^[A-Za-z0-9.-]{1,64}$/;

export function isRelativeReference(reference: string): boolean {
    return /^[A-Z][A-Za-z]+\/[^/?#]+(?:\/_history\/[^/?#]+)?$/.test(reference);
}

/**
 * The reference validator links the entries of a document or message only
 * through a fullUrl of the RESTful form `[base/]Type/id` that names the
 * entry's own resource: the relative reference then stands for exactly the
 * entry whose fullUrl is that base plus the reference. Any other fullUrl
 * anchors nothing, even where an entry has the referenced type and id.
 */
export function resolvesAgainstOwnRestfulFullUrl(
    ref: string,
    sourceFullUrl: string,
    resource: Record<string, unknown>,
    indexes: BundleReferenceIndexes,
): boolean {
    const { resourceType, id } = resource;
    if (typeof resourceType !== 'string' || typeof id !== 'string' || !RESTFUL_ID.test(id)) return false;
    const ownPath = `${resourceType}/${id}`;
    if (!sourceFullUrl.endsWith(ownPath)) return false;
    const base = sourceFullUrl.slice(0, -ownPath.length);
    if (!RESTFUL_BASE.test(base)) return false;
    const target = `${base}${ref}`;
    return ref.includes('/_history/')
        ? indexes.versionedIndex.has(target)
        : indexes.fullUrlToEntryIndexes.get(target)?.length === 1;
}

/**
 * A document or message must carry what its Composition or MessageHeader
 * points at: Composition subject, author, encounter, custodian, attesters,
 * event details and section content, or MessageHeader.focus. Any other entry
 * may still point at a resource on a server by absolute URL, as the reference
 * validator accepts; relative references keep the closed-bundle rules
 * because they only resolve through the entries' fullUrls.
 */
export function mustResolveInClosedBundle(reference: ClosedBundleReference): boolean {
    if (!/^https?:\/\//.test(reference.ref) || reference.resolved.hasTypeIdMatch) {
        return !isUrnReference(reference.ref) || isAnchorReference(reference);
    }
    return isAnchorReference(reference);
}

/**
 * The reference validator fails a document or message when what its
 * Composition or MessageHeader points at is missing, when a reference matches
 * several entries, or when a relative reference misses the entry of that type
 * and id through the fullUrl rules. Another entry's reference to a resource
 * the bundle does not hold is only noted.
 */
export function closedBundleReferenceSeverity(reference: ClosedBundleReference): 'error' | 'information' {
    if (isAnchorReference(reference) || reference.resolved.multipleMatches) return 'error';
    return isRelativeReference(reference.ref) && reference.resolved.hasTypeIdMatch ? 'error' : 'information';
}

function isAnchorReference(reference: ClosedBundleReference): boolean {
    if (reference.entryIndex !== 0) return false;
    if (reference.resource.resourceType === 'Composition') return DOCUMENT_ANCHOR_REFERENCE.test(reference.refPath);
    if (reference.resource.resourceType === 'MessageHeader') return MESSAGE_ANCHOR_REFERENCE.test(reference.refPath);
    return false;
}

function isUrnReference(reference: string): boolean {
    return reference.startsWith('urn:uuid:') || reference.startsWith('urn:oid:');
}
