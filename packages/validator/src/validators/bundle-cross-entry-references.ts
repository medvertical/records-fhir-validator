import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { deriveBundleBaseUrl, extractReferencesWithPaths } from './bundle-reference-utils.js';
import {
    buildReferenceIndexes,
    extractLogicalReference,
    resolveReferenceInBundle,
    type BundleReferenceIndexes,
    type ResolvedReference,
} from './bundle-cross-entry-reference-resolution.js';

interface ReferenceContext {
    entries: unknown[];
    entryIndex: number;
    resource: Record<string, unknown>;
    sourceFullUrl: string | undefined;
    ref: string;
    refPath: string;
    unversioned: string;
    resolved: ResolvedReference;
    isClosedBundle: boolean;
}

export function validateBundleCrossEntryReferences(
    bundle: unknown,
    bundleType: string | null,
    strictRefs = false,
): ValidationIssue[] {
    if (!isRecord(bundle)) return [];
    const entries: unknown[] = Array.isArray(bundle.entry) ? bundle.entry : [];
    if (entries.length === 0) return [];

    const indexes = buildReferenceIndexes(entries);
    const isClosedBundle = bundleType === 'document' || bundleType === 'message';
    const issues: ValidationIssue[] = [];

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const entry = entries[entryIndex];
        const resource = isRecord(entry) && isRecord(entry.resource)
            ? entry.resource
            : undefined;
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

function validateEntryReferences(
    entries: unknown[],
    entryIndex: number,
    resource: Record<string, unknown>,
    indexes: BundleReferenceIndexes,
    isClosedBundle: boolean,
    strictRefs: boolean,
): ValidationIssue[] {
    const sourceEntry = entries[entryIndex];
    const sourceFullUrl = isRecord(sourceEntry) && typeof sourceEntry.fullUrl === 'string'
        ? sourceEntry.fullUrl
        : undefined;
    const refsWithPaths: { reference: string; path: string }[] = [];
    extractReferencesWithPaths(resource, '', refsWithPaths);

    const issues: ValidationIssue[] = [];
    for (const { reference: ref, path: refPath } of refsWithPaths) {
        if (ref.startsWith('#') || ref.includes('?')) continue;
        const historyMatch = ref.match(/^(.*)\/_history\/[^/]+$/);
        const unversioned = historyMatch ? historyMatch[1] : ref;
        const resolved = resolveReferenceInBundle(ref, unversioned, sourceFullUrl, indexes, strictRefs);
        if (
            isRelativeReference(ref) &&
            sourceFullUrl &&
            !sourceFullUrlMatchesResource(sourceFullUrl, resource)
        ) {
            resolved.resolvable = false;
        }
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

function isRelativeReference(reference: string): boolean {
    return /^[A-Z][A-Za-z]+\/[^/?#]+(?:\/_history\/[^/?#]+)?$/.test(reference);
}

function sourceFullUrlMatchesResource(
    fullUrl: string,
    resource: Record<string, unknown>,
): boolean {
    if (!/^https?:\/\//.test(fullUrl)) return true;
    if (typeof resource.resourceType !== 'string' || typeof resource.id !== 'string') return true;
    try {
        const segments = new URL(fullUrl).pathname.split('/').filter(Boolean);
        return segments.length < 2 ||
            (segments.at(-2) === resource.resourceType && segments.at(-1) === resource.id);
    } catch {
        return true;
    }
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

    const detail = buildTypeIdMismatchDetail(context);

    issues.push(createValidationIssue({
        code: 'bundle-cross-entry-reference-missing',
        path: issuePath,
        resourceType: 'Bundle',
        customMessage: context.resolved.multipleMatches
            ? `Found ${context.resolved.matchCount} matches for '${context.ref}' in the bundle`
            : `Can't find '${context.ref}' in the bundle ` +
                `(${getResourceLabel(context.resource)}[${context.entryIndex}]).${detail}`,
        severityOverride: 'error',
        details: buildReferenceMismatchDetails(context),
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
    if (context.ref.startsWith('urn:uuid:') || context.ref.startsWith('urn:oid:')) {
        return [createValidationIssue({
            code: 'bundle-cross-entry-reference-missing',
            path: getReferenceIssuePath(context),
            resourceType: 'Bundle',
            customMessage:
                `Can't find '${context.ref}' in the bundle ` +
                `(${getResourceLabel(context.resource)}[${context.entryIndex}]).`,
            severityOverride: 'warning',
            details: buildReferenceMismatchDetails(context),
        })];
    }

    if (!context.resolved.hasTypeIdMatch || !context.sourceFullUrl || context.sourceFullUrl.startsWith('urn:')) {
        return [];
    }

    const issuePath = getReferenceIssuePath(context);
    const matches = indexes.typeIdToFullUrls.get(context.unversioned) || [];

    return matches.map((matchedFullUrl, matchIndex) => {
        const matchedEntryIndex = context.entries.findIndex(entry =>
            isRecord(entry) && entry.fullUrl === matches[matchIndex]
        );
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
    return !context.refPath
        ? `Bundle.entry[${context.entryIndex}].resource`
        : `Bundle.entry[${context.entryIndex}].resource.${context.refPath}`;
}

function composeFullTarget(ref: string, sourceFullUrl: string | undefined): string {
    if (!sourceFullUrl || sourceFullUrl.startsWith('urn:') || /^https?:\/\//.test(ref)) {
        return ref;
    }
    const base = deriveBundleBaseUrl(sourceFullUrl);
    return base ? `${base}${ref}` : ref;
}

function findEntryFullUrlsByLogicalRef(entries: unknown[], logicalRef: string): string[] {
    const [resourceType, id] = logicalRef.split('/');
    if (!resourceType || !id) return [];

    return entries
        .filter(entry =>
            isRecord(entry) &&
            isRecord(entry.resource) &&
            entry.resource.resourceType === resourceType &&
            entry.resource.id === id
        )
        .map(entry => isRecord(entry) && typeof entry.fullUrl === 'string'
            ? entry.fullUrl
            : '');
}

function buildTypeIdMismatchDetail(context: ReferenceContext): string {
    if (!context.resolved.hasTypeIdMatch) {
        if (context.resolved.hasRequestUrlMatch) {
            return ' Note that an entry.request.url matches this reference, but request.url is not used ' +
                'for document/message Bundle reference resolution.';
        }
        return '';
    }
    if (/^https?:\/\//.test(context.ref)) {
        return ' Note that there is a resource in the bundle with the same type and id, ' +
            'but its fullUrl uses a different absolute URL, so it does not match by Bundle resolution rules.';
    }
    return ' Note that there is a resource in the bundle with the same type and id, ' +
        'but it does not match because of the fullUrl based rules around matching relative references.';
}

function buildReferenceMismatchDetails(context: ReferenceContext): Record<string, unknown> {
    const logicalReference = context.resolved.logicalReference ?? extractLogicalReference(context.unversioned);
    const matchedFullUrls = context.resolved.matchedFullUrls
        ?? (logicalReference ? findEntryFullUrlsByLogicalRef(context.entries, logicalReference) : []);

    const details: Record<string, unknown> = {
        reference: context.ref,
        unversionedReference: context.unversioned,
        sourceFullUrl: context.sourceFullUrl,
        sourceEntryIndex: context.entryIndex,
        hasTypeIdMatch: context.resolved.hasTypeIdMatch,
    };

    if (logicalReference) {
        details.logicalReference = logicalReference;
    }
    if (matchedFullUrls.length > 0) {
        details.matchedFullUrls = matchedFullUrls;
        details.fixHint = /^https?:\/\//.test(context.ref)
            ? 'Use a reference that exactly matches the target entry fullUrl, or align the target entry fullUrl with the absolute reference.'
            : 'Use a reference that resolves relative to the source entry fullUrl, or align the target entry fullUrl with that relative target.';
    }
    if (context.resolved.matchedRequestUrls?.length) {
        details.matchedRequestUrls = context.resolved.matchedRequestUrls;
        details.fixHint = 'For document/message bundles, use references that match entry.fullUrl exactly, or use absolute fullUrls with a common base. Do not rely on entry.request.url for internal reference resolution.';
    }

    return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getResourceLabel(resource: Record<string, unknown>): string {
    return typeof resource.resourceType === 'string' && resource.resourceType.length > 0
        ? resource.resourceType
        : 'entry';
}
