import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { KNOWN_FHIR_RESOURCE_TYPES } from '../reference/reference-resource-types.js';

export function validateBundleFullUrls(
    bundle: unknown,
    bundleType: string | null,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const entries = getEntries(bundle);
    const seen = new Map<string, number>();

    for (let index = 0; index < entries.length; index++) {
        const entry = toRecord(entries[index]);
        const fullUrl = entry?.fullUrl;
        if (fullUrl === undefined || fullUrl === null) continue;

        const path = `Bundle.entry[${index}].fullUrl`;
        if (typeof fullUrl !== 'string' || fullUrl.length === 0) {
            issues.push(createValidationIssue({
                code: 'structural-bundle-fullurl-invalid',
                path,
                resourceType: 'Bundle',
                customMessage: `${path} must be a non-empty string`,
                severityOverride: 'error',
            }));
            if (fullUrl === '') {
                issues.push(createValidationIssue({
                    code: 'ele-1-violation',
                    path,
                    resourceType: 'Bundle',
                    customMessage: "Constraint failed: ele-1: 'All FHIR elements must have a @value or children'",
                    severityOverride: 'error',
                }));
            }
            continue;
        }

        if (!hasAbsoluteUriScheme(fullUrl)) {
            issues.push(createValidationIssue({
                code: 'structural-bundle-fullurl-not-absolute',
                path,
                resourceType: 'Bundle',
                customMessage: `The fullUrl must be an absolute URL (not '${fullUrl}')`,
                severityOverride: 'error',
            }));
            continue;
        }

        if (fullUrl.includes('/_history/')) {
            issues.push(createValidationIssue({
                code: 'bdl-8-violation',
                path,
                resourceType: 'Bundle',
                customMessage: `bdl-8: fullUrl cannot be a version-specific reference (${fullUrl})`,
                severityOverride: 'error',
            }));
        }

        if (bundleType === 'history') continue;

        const resource = toRecord(entry?.resource);
        const meta = toRecord(resource?.meta);
        const versionId = getNonEmptyString(meta?.versionId);
        const key = JSON.stringify([fullUrl, versionId ?? null]);
        const firstIndex = seen.get(key);
        if (firstIndex !== undefined) {
            issues.push(createValidationIssue({
                code: 'structural-bundle-fullurl-duplicate',
                path,
                resourceType: 'Bundle',
                customMessage:
                    `Duplicate fullUrl "${fullUrl}" — also appears at ` +
                    `Bundle.entry[${firstIndex}].fullUrl. ` +
                    'fullUrl values must be unique within a Bundle.',
                severityOverride: 'error',
            }));
        } else {
            seen.set(key, index);
        }
    }

    return issues;
}

export function validateBundleEntryIdConsistency(bundle: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const entries = getEntries(bundle);

    for (let index = 0; index < entries.length; index++) {
        const entry = toRecord(entries[index]);
        const fullUrl = getNonEmptyString(entry?.fullUrl);
        const resource = toRecord(entry?.resource);
        const resourceType = getNonEmptyString(resource?.resourceType);
        const resourceId = getNonEmptyString(resource?.id);
        if (!fullUrl || !resourceType || !resourceId) continue;

        const identity = parseRestfulFullUrlIdentity(fullUrl);
        if (!identity) continue;
        if (identity.resourceType === resourceType && identity.id === resourceId) continue;

        issues.push(createValidationIssue({
            code: 'bundle-entry-fullurl-id-mismatch',
            path: `Bundle.entry[${index}].fullUrl`,
            resourceType: 'Bundle',
            customMessage:
                `The fullUrl '${fullUrl}' looks like a RESTful server URL, ` +
                'so it must end with the correct type and id ' +
                `(/${resourceType}/${resourceId})`,
            severityOverride: 'error',
        }));
    }

    return issues;
}

// Paging relations describe a position in a result set, so they only mean
// anything where there is one. `searchset` and `history` are paged; every other
// bundle type is a single self-contained payload, and the reference validator
// rejects a paging link there.
const PAGING_LINK_RELATIONS = new Set(['first', 'previous', 'prev', 'next', 'last']);
const PAGED_BUNDLE_TYPES = new Set(['searchset', 'history']);

export function validateBundleLinkRelations(bundle: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const links = getArrayProperty(bundle, 'link');
    const seen = new Map<string, number>();
    const bundleType = getNonEmptyString(toRecord(bundle)?.type);
    // With no declared type there is nothing to judge the relation against, and
    // the missing required element is reported on its own. Stay quiet rather
    // than guess.
    const checkPaging = bundleType !== undefined && !PAGED_BUNDLE_TYPES.has(bundleType);

    for (let index = 0; index < links.length; index++) {
        const relation = getNonEmptyString(toRecord(links[index])?.relation);
        if (!relation) continue;

        if (checkPaging && PAGING_LINK_RELATIONS.has(relation)) {
            issues.push(createValidationIssue({
                code: 'bundle-link-relation-prohibited',
                path: `Bundle.link[${index}].relation`,
                resourceType: 'Bundle',
                customMessage:
                    `The link relationship type '${relation}' used in search sets ` +
                    'is prohibited in this context',
                severityOverride: 'error',
            }));
        }

        const firstIndex = seen.get(relation);
        if (firstIndex !== undefined) {
            issues.push(createValidationIssue({
                code: 'bundle-link-relation-duplicate',
                path: `Bundle.link[${index}].relation`,
                resourceType: 'Bundle',
                customMessage:
                    `The link relationship type '${relation}' can only occur once ` +
                    `(first used at Bundle.link[${firstIndex}].relation)`,
                severityOverride: 'error',
            }));
        } else {
            seen.set(relation, index);
        }
    }

    return issues;
}

export function bundleHasDuplicateEntryIds(bundle: unknown): boolean {
    const seen = new Set<string>();
    for (const value of getEntries(bundle)) {
        const id = getNonEmptyString(toRecord(value)?.id);
        if (!id) continue;
        if (seen.has(id)) return true;
        seen.add(id);
    }
    return false;
}

export function detectDuplicateBundleEntries(bundle: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const entries = getEntries(bundle);
    const seen = new Map<string, number>();

    for (let index = 0; index < entries.length; index++) {
        const resource = toRecord(toRecord(entries[index])?.resource);
        const resourceType = getNonEmptyString(resource?.resourceType);
        const resourceId = getNonEmptyString(resource?.id);
        if (!resourceType || !resourceId) continue;

        const versionId = getNonEmptyString(toRecord(resource?.meta)?.versionId);
        const logical = `${resourceType}/${resourceId}`;
        const key = JSON.stringify([logical, versionId ?? null]);
        const firstIndex = seen.get(key);
        if (firstIndex !== undefined) {
            issues.push(createValidationIssue({
                code: 'bundle-duplicate-entry',
                path: `Bundle.entry[${index}]`,
                resourceType: 'Bundle',
                customMessage:
                    `Duplicate entry: ${logical} appears at entry[${firstIndex}] ` +
                    `and entry[${index}].`,
                severityOverride: 'error',
            }));
        } else {
            seen.set(key, index);
        }
    }

    return issues;
}

function getEntries(bundle: unknown): unknown[] {
    return getArrayProperty(bundle, 'entry');
}

function getArrayProperty(value: unknown, key: string): unknown[] {
    const property = toRecord(value)?.[key];
    return Array.isArray(property) ? property : [];
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function getNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function hasAbsoluteUriScheme(value: string): boolean {
    return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

// Java parity (BUNDLE_ENTRY_URL_MATCHES_TYPE_ID): a fullUrl only "looks
// RESTful" when its final segments are a known resource type followed by a
// syntactically valid FHIR id. Anything else — IG page links such as
// https://profiles.ihe.net/ITI/PDQm/Patient-ex-patient.html, or ids with
// characters outside the FHIR id grammar — is out of scope for the check.
const FHIR_ID_SEGMENT_PATTERN = /^[A-Za-z0-9\-.]{1,64}$/;

function parseRestfulFullUrlIdentity(
    fullUrl: string,
): { resourceType: string; id: string } | null {
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
        return null;
    }

    const match = fullUrl.match(/\/([A-Z][a-zA-Z]+)\/([^/?#]+)$/);
    if (!match) return null;
    if (!KNOWN_FHIR_RESOURCE_TYPES.has(match[1])) return null;
    if (!FHIR_ID_SEGMENT_PATTERN.test(match[2])) return null;

    return {
        resourceType: match[1],
        id: match[2],
    };
}
