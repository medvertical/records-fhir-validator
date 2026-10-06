import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { deriveBundleBaseUrl, extractAttachmentUrls, extractReferencesWithPaths } from './bundle-reference-utils.js';

export function validateBundleReachability(
    bundle: unknown,
    bundleType: string,
    strictRefs = false,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const bundleRecord = asRecord(bundle);
    const entries = Array.isArray(bundleRecord?.entry) ? bundleRecord.entry : [];
    if (entries.length <= 1) return issues;

    if (!strictRefs && entries.some(entry => !isWellFormedFullUrl(asRecord(entry)?.fullUrl))) {
        return issues;
    }

    const { fullUrlIndex, versionedFullUrlIndex } = buildFullUrlIndexes(entries);
    const forward = buildBundleForwardGraph(entries, fullUrlIndex, versionedFullUrlIndex);
    const reachable = bfsBundleGraph(entries.length, forward);
    issues.push(...reverseLinkedEntryIssues(entries, forward, bundleType, fhirVersion));

    const rootResourceLabel = bundleType === 'document' ? 'Composition' : 'MessageHeader';
    for (let i = 1; i < entries.length; i++) {
        if (reachable.has(i)) continue;
        const entry = asRecord(entries[i]);
        const fullUrl = typeof entry?.fullUrl === 'string' ? entry.fullUrl : undefined;
        const res = asRecord(entry?.resource);
        const label = fullUrl
            ?? (typeof res?.resourceType === 'string' && typeof res.id === 'string'
                ? `${res.resourceType}/${res.id}`
                : `entry[${i}]`);
        issues.push(createValidationIssue({
            code: 'bundle-entry-not-reachable',
            path: `Bundle.entry[${i}]`,
            resourceType: 'Bundle',
            customMessage:
                `Entry '${label}' isn't reachable by traversing links (forward or backward) from the ${rootResourceLabel}`,
            severityOverride: bundleType === 'message' ? 'warning' : 'error',
        }));
    }

    return issues;
}

/**
 * The reference validator walks forward from the Composition or
 * MessageHeader, then admits an entry that points at something already
 * reached. Up to R4B a document may be entered that way only by Provenance;
 * R5 and messages merely note it.
 */
function reverseLinkedEntryIssues(
    entries: unknown[],
    forward: Set<number>[],
    bundleType: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const visited = new Set<number>();
    visitForward(0, forward, visited);
    let admitted = true;
    while (admitted) {
        admitted = false;
        for (let i = 1; i < entries.length; i++) {
            if (visited.has(i) || ![...forward[i]].some(target => visited.has(target))) continue;
            admitted = true;
            visitForward(i, forward, visited);
            const entry = asRecord(entries[i]);
            if (asRecord(entry?.resource)?.resourceType === 'Provenance') continue;
            issues.push(reverseLinkedEntryIssue(i, entry?.fullUrl, bundleType, fhirVersion));
        }
    }
    return issues;
}

function reverseLinkedEntryIssue(
    index: number,
    fullUrl: unknown,
    bundleType: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
): ValidationIssue {
    const label = typeof fullUrl === 'string' ? `'${fullUrl}'` : `entry[${index}]`;
    const document = bundleType === 'document';
    const guidance = !document
        ? 'Check that this is meant to be included (needed to process the message)'
        : fhirVersion === 'R4'
            ? 'Only Provenance is approved to be used this way (R4 section 3.3.1)'
            : "Check whether this should be linked directly from the composition if it's a source of narrative content";
    return createValidationIssue({
        code: 'bundle-entry-reverse-link',
        path: `Bundle.entry[${index}]`,
        resourceType: 'Bundle',
        customMessage: `Entry ${label} isn't reachable by traversing forwards from the `
            + `${document ? 'Composition' : 'MessageHeader'}. ${guidance}`,
        severityOverride: document && fhirVersion === 'R4' ? 'warning' : 'information',
    });
}

function visitForward(start: number, forward: Set<number>[], visited: Set<number>): void {
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
        for (const next of forward[queue.shift()!]) {
            if (visited.has(next)) continue;
            visited.add(next);
            queue.push(next);
        }
    }
}

function isWellFormedFullUrl(value: unknown): boolean {
    return typeof value === 'string' && (value.startsWith('urn:') || /^https?:\/\//.test(value));
}

function buildFullUrlIndexes(entries: unknown[]): {
    fullUrlIndex: Map<string, number[]>;
    versionedFullUrlIndex: Map<string, number[]>;
} {
    const fullUrlIndex = new Map<string, number[]>();
    const versionedFullUrlIndex = new Map<string, number[]>();

    for (let i = 0; i < entries.length; i++) {
        const entry = asRecord(entries[i]);
        if (typeof entry?.fullUrl !== 'string') continue;
        const indexes = fullUrlIndex.get(entry.fullUrl) || [];
        indexes.push(i);
        fullUrlIndex.set(entry.fullUrl, indexes);

        const resource = asRecord(entry.resource);
        const meta = asRecord(resource?.meta);
        const versionId = typeof meta?.versionId === 'string' ? meta.versionId : undefined;
        if (versionId) {
            const versionedFullUrl = `${entry.fullUrl}/_history/${versionId}`;
            const versionedIndexes = versionedFullUrlIndex.get(versionedFullUrl) || [];
            versionedIndexes.push(i);
            versionedFullUrlIndex.set(versionedFullUrl, versionedIndexes);
        }
    }

    return { fullUrlIndex, versionedFullUrlIndex };
}

function resolveLiteralRefToEntryIndex(
    ref: string,
    sourceFullUrl: string | undefined,
    fullUrlIndex: Map<string, number[]>,
    versionedFullUrlIndex: Map<string, number[]>,
): number | null {
    if (!ref || ref.startsWith('#') || ref.includes('?')) return null;
    const pickSingle = (indexes: number[] | undefined): number | null =>
        indexes && indexes.length === 1 ? indexes[0] : null;
    const refIsVersioned = /\/_history\/[^/]+$/.test(ref);

    if (ref.startsWith('urn:')) {
        return pickSingle(fullUrlIndex.get(ref));
    }
    if (/^https?:\/\//.test(ref)) {
        return refIsVersioned
            ? pickSingle(versionedFullUrlIndex.get(ref))
            : pickSingle(fullUrlIndex.get(ref));
    }
    if (!sourceFullUrl || sourceFullUrl.startsWith('urn:')) return null;
    const base = deriveBundleBaseUrl(sourceFullUrl);
    if (!base) return null;
    const target = `${base}${ref}`;
    return refIsVersioned
        ? pickSingle(versionedFullUrlIndex.get(target))
        : pickSingle(fullUrlIndex.get(target));
}

function buildBundleForwardGraph(
    entries: unknown[],
    fullUrlIndex: Map<string, number[]>,
    versionedFullUrlIndex: Map<string, number[]>,
): Set<number>[] {
    const forward: Set<number>[] = entries.map(() => new Set<number>());
    for (let i = 0; i < entries.length; i++) {
        const entry = asRecord(entries[i]);
        const resource = entry?.resource;
        if (!resource) continue;
        if (!sourceFullUrlMatchesResource(entry.fullUrl, resource)) continue;
        const refs: { reference: string; path: string }[] = [];
        extractReferencesWithPaths(resource, '', refs);
        // Attachment URLs (presentedForm, content.attachment, …) link to
        // in-bundle Binaries the same way Reference.reference does.
        const links = refs.map(ref => ref.reference).concat(extractAttachmentUrls(resource));
        for (const reference of links) {
            const target = resolveLiteralRefToEntryIndex(
                reference,
                typeof entry.fullUrl === 'string' ? entry.fullUrl : undefined,
                fullUrlIndex,
                versionedFullUrlIndex,
            );
            if (target !== null && target !== i) forward[i].add(target);
        }
    }
    return forward;
}

function sourceFullUrlMatchesResource(fullUrl: unknown, resource: unknown): boolean {
    if (typeof fullUrl !== 'string' || !/^https?:\/\//.test(fullUrl)) return true;
    const resourceRecord = asRecord(resource);
    if (typeof resourceRecord?.resourceType !== 'string' || typeof resourceRecord.id !== 'string') return true;
    try {
        const segments = new URL(fullUrl).pathname.split('/').filter(Boolean);
        return segments.length < 2 ||
            (segments.at(-2) === resourceRecord.resourceType && segments.at(-1) === resourceRecord.id);
    } catch {
        return true;
    }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function bfsBundleGraph(size: number, forward: Set<number>[]): Set<number> {
    const reachable = new Set<number>([0]);
    const queue: number[] = [0];
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of forward[current]) {
            if (!reachable.has(next)) {
                reachable.add(next);
                queue.push(next);
            }
        }
        for (let index = 0; index < size; index++) {
            if (forward[index].has(current) && !reachable.has(index)) {
                reachable.add(index);
                queue.push(index);
            }
        }
    }
    return reachable;
}
