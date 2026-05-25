import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { deriveBundleBaseUrl, extractReferencesWithPaths } from './bundle-reference-utils';

interface BundleReferenceIndexes {
    fullUrlIndex: Set<string>;
    fullUrlToEntryIndexes: Map<string, number[]>;
    typeIdToFullUrls: Map<string, string[]>;
    versionedIndex: Set<string>;
}

interface ResolvedReference {
    resolvable: boolean;
    hasTypeIdMatch: boolean;
    multipleMatches?: boolean;
    matchCount?: number;
}

interface ReferenceContext {
    entries: any[];
    entryIndex: number;
    resource: any;
    sourceFullUrl: string | undefined;
    ref: string;
    refPath: string;
    unversioned: string;
    resolved: ResolvedReference;
    isClosedBundle: boolean;
}

export function validateBundleCrossEntryReferences(
    bundle: any,
    bundleType: string | null,
    strictRefs = false,
): ValidationIssue[] {
    const entries: any[] = bundle?.entry ?? [];
    if (entries.length === 0) return [];

    const indexes = buildReferenceIndexes(entries);
    const isClosedBundle = bundleType === 'document' || bundleType === 'message';
    const issues: ValidationIssue[] = [];

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const resource = entries[entryIndex]?.resource;
        if (!resource) continue;
        issues.push(...validateEntryReferences(
            entries,
            entryIndex,
            resource,
            indexes,
            isClosedBundle,
            strictRefs,
        ));
    }

    return issues;
}

function buildReferenceIndexes(entries: any[]): BundleReferenceIndexes {
    const fullUrlIndex = new Set<string>();
    const fullUrlToEntryIndexes = new Map<string, number[]>();
    const typeIdToFullUrls = new Map<string, string[]>();
    const versionedIndex = new Set<string>();

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const entry = entries[entryIndex];
        if (entry.fullUrl) {
            fullUrlIndex.add(entry.fullUrl);
            const indexes = fullUrlToEntryIndexes.get(entry.fullUrl) || [];
            indexes.push(entryIndex);
            fullUrlToEntryIndexes.set(entry.fullUrl, indexes);
        }
        const resource = entry.resource;
        if (resource?.resourceType && resource?.id) {
            const resourceRef = `${resource.resourceType}/${resource.id}`;
            const urls = typeIdToFullUrls.get(resourceRef) || [];
            urls.push(entry.fullUrl || '');
            typeIdToFullUrls.set(resourceRef, urls);
            const versionId = resource.meta?.versionId;
            if (versionId) {
                versionedIndex.add(`${resourceRef}/_history/${versionId}`);
                if (entry.fullUrl) {
                    versionedIndex.add(`${entry.fullUrl}/_history/${versionId}`);
                }
            }
        }
    }

    return { fullUrlIndex, fullUrlToEntryIndexes, typeIdToFullUrls, versionedIndex };
}

function validateEntryReferences(
    entries: any[],
    entryIndex: number,
    resource: any,
    indexes: BundleReferenceIndexes,
    isClosedBundle: boolean,
    strictRefs: boolean,
): ValidationIssue[] {
    const sourceFullUrl: string | undefined = entries[entryIndex]?.fullUrl;
    const refsWithPaths: { reference: string; path: string }[] = [];
    extractReferencesWithPaths(resource, '', refsWithPaths);

    const issues: ValidationIssue[] = [];
    for (const { reference: ref, path: refPath } of refsWithPaths) {
        if (ref.startsWith('#') || ref.includes('?')) continue;
        const historyMatch = ref.match(/^(.*)\/_history\/[^/]+$/);
        const unversioned = historyMatch ? historyMatch[1] : ref;
        const resolved = resolveReferenceInBundle(ref, unversioned, sourceFullUrl, indexes, strictRefs);
        if (resolved.resolvable) continue;

        issues.push(...createUnresolvedReferenceIssues({
            entries,
            entryIndex,
            resource,
            sourceFullUrl,
            ref,
            refPath,
            unversioned,
            resolved,
            isClosedBundle,
        }, indexes));
    }

    return issues;
}

function createUnresolvedReferenceIssues(
    context: ReferenceContext,
    indexes: BundleReferenceIndexes,
): ValidationIssue[] {
    if (context.isClosedBundle) {
        return createClosedBundleReferenceIssues(context);
    }
    return createOpenBundleReferenceIssues(context, indexes);
}

function createClosedBundleReferenceIssues(context: ReferenceContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const issuePath = getReferenceIssuePath(context);

    if (context.ref.includes('/_history/') && context.resolved.hasTypeIdMatch) {
        issues.push(...createVersionedTypeIdWarnings(context, issuePath));
    }

    const detail = context.resolved.hasTypeIdMatch
        ? ' Note that there is a resource in the bundle with the same type and id, ' +
          'but it does not match because of the fullUrl based rules around matching relative references.'
        : '';

    issues.push(createValidationIssue({
        code: 'bundle-cross-entry-reference-missing',
        path: issuePath,
        resourceType: 'Bundle',
        customMessage: context.resolved.multipleMatches
            ? `Found ${context.resolved.matchCount} matches for '${context.ref}' in the bundle`
            : `Can't find '${context.ref}' in the bundle ` +
                `(${context.resource.resourceType ?? 'entry'}[${context.entryIndex}]).${detail}`,
        severityOverride: 'error',
    }));

    return issues;
}

function createVersionedTypeIdWarnings(context: ReferenceContext, issuePath: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const matches = findEntryFullUrlsByLogicalRef(context.entries, context.unversioned);
    const fullTarget = composeFullTarget(context.ref, context.sourceFullUrl);

    issues.push(createValidationIssue({
        code: 'required',
        path: issuePath,
        resourceType: 'Bundle',
        customMessage:
            `The bundle contains no match for ${fullTarget} ` +
            'by the rules of Bundle reference resolution, but it has multiple resources ' +
            `that match ${context.ref} by resource type and id`,
        severityOverride: 'warning',
    }));

    const matchCount = Math.max(matches.length, context.resolved.matchCount || 0);
    for (let matchIndex = 0; matchIndex < matchCount; matchIndex++) {
        const matchedFullUrl = matches[matchIndex] || composeFullTarget(context.unversioned, context.sourceFullUrl);
        issues.push(createValidationIssue({
            code: 'required',
            path: issuePath,
            resourceType: 'Bundle',
            customMessage:
                `Entry ${matchIndex + 1} matches the reference ${context.ref} by type and id ` +
                `but its fullUrl ${matchedFullUrl} does not match the full target URL ` +
                `${fullTarget} by Bundle resolution rules`,
            severityOverride: 'warning',
        }));
    }

    return issues;
}

function createOpenBundleReferenceIssues(
    context: ReferenceContext,
    indexes: BundleReferenceIndexes,
): ValidationIssue[] {
    if (!context.resolved.hasTypeIdMatch || !context.sourceFullUrl || context.sourceFullUrl.startsWith('urn:')) {
        return [];
    }

    const issuePath = getReferenceIssuePath(context);
    const matches = indexes.typeIdToFullUrls.get(context.unversioned) || [];

    return matches.map((matchedFullUrl, matchIndex) => {
        const matchedEntryIndex = context.entries.findIndex((entry: any) => entry?.fullUrl === matches[matchIndex]);
        const entryLabel = matchedEntryIndex >= 0 ? matchedEntryIndex + 1 : '?';
        return createValidationIssue({
            code: 'bundle-cross-entry-fullurl-mismatch',
            path: issuePath,
            resourceType: 'Bundle',
            customMessage:
                `Entry ${entryLabel} matches the reference ${context.ref} by type and id ` +
                `but its fullUrl ${matchedFullUrl || '(no fullUrl)'} does not match by Bundle resolution rules`,
            severityOverride: 'warning',
        });
    });
}

function getReferenceIssuePath(context: ReferenceContext): string {
    return (!context.sourceFullUrl || !context.refPath)
        ? `Bundle.entry[${context.entryIndex}].resource`
        : `Bundle.entry[${context.entryIndex}].resource.${context.refPath}`;
}

function resolveReferenceInBundle(
    ref: string,
    unversioned: string,
    sourceFullUrl: string | undefined,
    indexes: BundleReferenceIndexes,
    strictRefs = false,
): ResolvedReference {
    const refIsVersioned = /^(.*)\/_history\/([^/]+)$/.test(ref);

    if (ref.startsWith('urn:uuid:') || ref.startsWith('urn:oid:')) {
        return { resolvable: indexes.fullUrlIndex.has(ref), hasTypeIdMatch: false };
    }
    if (/^https?:\/\//.test(ref)) {
        return resolveAbsoluteReference(ref, unversioned, refIsVersioned, indexes);
    }

    const hasTypeIdMatch = indexes.typeIdToFullUrls.has(unversioned);
    const typeIdMatchCount = indexes.typeIdToFullUrls.get(unversioned)?.length || 0;

    if (!sourceFullUrl) {
        return resolveWithoutSourceFullUrl(ref, refIsVersioned, hasTypeIdMatch, typeIdMatchCount, indexes);
    }
    if (sourceFullUrl.startsWith('urn:')) {
        return { resolvable: false, hasTypeIdMatch };
    }

    const base = deriveBundleBaseUrl(sourceFullUrl);
    if (base) {
        return resolveRelativeWithBase(
            ref,
            unversioned,
            refIsVersioned,
            hasTypeIdMatch,
            typeIdMatchCount,
            indexes,
            base,
        );
    }

    if (strictRefs && !refIsVersioned) {
        return { resolvable: false, hasTypeIdMatch, matchCount: typeIdMatchCount };
    }
    return resolveByTypeIdFallback(ref, refIsVersioned, hasTypeIdMatch, typeIdMatchCount, indexes);
}

function resolveAbsoluteReference(
    ref: string,
    unversioned: string,
    refIsVersioned: boolean,
    indexes: BundleReferenceIndexes,
): ResolvedReference {
    const directMatch = refIsVersioned
        ? indexes.versionedIndex.has(ref)
        : indexes.fullUrlIndex.has(ref) || indexes.fullUrlIndex.has(unversioned);
    const matchCount = indexes.fullUrlToEntryIndexes.get(ref)?.length
        || indexes.fullUrlToEntryIndexes.get(unversioned)?.length
        || 0;
    return {
        resolvable: directMatch && matchCount <= 1,
        hasTypeIdMatch: false,
        multipleMatches: !refIsVersioned && matchCount > 1,
        matchCount,
    };
}

function resolveWithoutSourceFullUrl(
    ref: string,
    refIsVersioned: boolean,
    hasTypeIdMatch: boolean,
    typeIdMatchCount: number,
    indexes: BundleReferenceIndexes,
): ResolvedReference {
    const resolvable = refIsVersioned
        ? indexes.versionedIndex.has(ref)
        : hasTypeIdMatch || indexes.versionedIndex.has(ref);
    return {
        resolvable: resolvable && (!hasTypeIdMatch || typeIdMatchCount <= 1 || refIsVersioned),
        hasTypeIdMatch: false,
        multipleMatches: !refIsVersioned && typeIdMatchCount > 1,
        matchCount: typeIdMatchCount,
    };
}

function resolveRelativeWithBase(
    ref: string,
    unversioned: string,
    refIsVersioned: boolean,
    hasTypeIdMatch: boolean,
    typeIdMatchCount: number,
    indexes: BundleReferenceIndexes,
    base: string,
): ResolvedReference {
    const targetUrl = `${base}${refIsVersioned ? ref : unversioned}`;
    if (refIsVersioned) {
        return {
            resolvable: indexes.versionedIndex.has(targetUrl),
            hasTypeIdMatch,
            matchCount: typeIdMatchCount,
        };
    }
    if (indexes.fullUrlIndex.has(targetUrl)) {
        const matchCount = indexes.fullUrlToEntryIndexes.get(targetUrl)?.length || 0;
        return {
            resolvable: matchCount <= 1,
            hasTypeIdMatch: false,
            multipleMatches: matchCount > 1,
            matchCount,
        };
    }
    return { resolvable: false, hasTypeIdMatch };
}

function resolveByTypeIdFallback(
    ref: string,
    refIsVersioned: boolean,
    hasTypeIdMatch: boolean,
    typeIdMatchCount: number,
    indexes: BundleReferenceIndexes,
): ResolvedReference {
    const resolvable = refIsVersioned
        ? indexes.versionedIndex.has(ref)
        : hasTypeIdMatch || indexes.versionedIndex.has(ref);
    return {
        resolvable: resolvable && (!hasTypeIdMatch || typeIdMatchCount <= 1 || refIsVersioned),
        hasTypeIdMatch: false,
        multipleMatches: !refIsVersioned && typeIdMatchCount > 1,
        matchCount: typeIdMatchCount,
    };
}

function composeFullTarget(ref: string, sourceFullUrl: string | undefined): string {
    if (!sourceFullUrl || sourceFullUrl.startsWith('urn:') || /^https?:\/\//.test(ref)) {
        return ref;
    }
    const base = deriveBundleBaseUrl(sourceFullUrl);
    return base ? `${base}${ref}` : ref;
}

function findEntryFullUrlsByLogicalRef(entries: any[], logicalRef: string): string[] {
    const [resourceType, id] = logicalRef.split('/');
    if (!resourceType || !id) return [];

    return entries
        .filter((entry: any) =>
            entry?.resource?.resourceType === resourceType &&
            entry?.resource?.id === id)
        .map((entry: any) => entry?.fullUrl || '');
}
