import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { deriveBundleBaseUrl, extractReferencesWithPaths } from './bundle-reference-utils';

export function validateBundleReachability(
    bundle: any,
    bundleType: string,
    strictRefs = false,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const entries: any[] = bundle?.entry ?? [];
    if (entries.length <= 1) return issues;

    if (!strictRefs && entries.some(entry => !isWellFormedFullUrl(entry?.fullUrl))) {
        return issues;
    }

    const { fullUrlIndex, versionedFullUrlIndex } = buildFullUrlIndexes(entries);
    const forward = buildBundleForwardGraph(entries, fullUrlIndex, versionedFullUrlIndex);
    const reachable = bfsBundleGraph(entries.length, forward);

    const rootResourceLabel = bundleType === 'document' ? 'Composition' : 'MessageHeader';
    for (let i = 1; i < entries.length; i++) {
        if (reachable.has(i)) continue;
        const fullUrl = entries[i]?.fullUrl;
        const res = entries[i]?.resource;
        const label = fullUrl
            ? fullUrl
            : (res?.resourceType && res?.id ? `${res.resourceType}/${res.id}` : `entry[${i}]`);
        issues.push(createValidationIssue({
            code: 'bundle-entry-not-reachable',
            path: `Bundle.entry[${i}]`,
            resourceType: 'Bundle',
            customMessage:
                `Entry '${label}' isn't reachable by traversing links (forward or backward) from the ${rootResourceLabel}`,
            severityOverride: 'error',
        }));
    }

    return issues;
}

function isWellFormedFullUrl(value: unknown): boolean {
    return typeof value === 'string' && (value.startsWith('urn:') || /^https?:\/\//.test(value));
}

function buildFullUrlIndexes(entries: any[]): {
    fullUrlIndex: Map<string, number[]>;
    versionedFullUrlIndex: Map<string, number[]>;
} {
    const fullUrlIndex = new Map<string, number[]>();
    const versionedFullUrlIndex = new Map<string, number[]>();

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (typeof entry?.fullUrl !== 'string') continue;
        const indexes = fullUrlIndex.get(entry.fullUrl) || [];
        indexes.push(i);
        fullUrlIndex.set(entry.fullUrl, indexes);

        const versionId = entry?.resource?.meta?.versionId;
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
    entries: any[],
    fullUrlIndex: Map<string, number[]>,
    versionedFullUrlIndex: Map<string, number[]>,
): Set<number>[] {
    const forward: Set<number>[] = entries.map(() => new Set<number>());
    for (let i = 0; i < entries.length; i++) {
        const resource = entries[i]?.resource;
        if (!resource) continue;
        const refs: { reference: string; path: string }[] = [];
        extractReferencesWithPaths(resource, '', refs);
        for (const { reference } of refs) {
            const target = resolveLiteralRefToEntryIndex(
                reference,
                entries[i]?.fullUrl,
                fullUrlIndex,
                versionedFullUrlIndex,
            );
            if (target !== null && target !== i) forward[i].add(target);
        }
    }
    return forward;
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
