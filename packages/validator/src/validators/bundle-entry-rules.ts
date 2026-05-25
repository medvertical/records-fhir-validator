import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

export function validateBundleFullUrls(bundle: any, bundleType: string | null): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const entries: any[] = bundle?.entry ?? [];
    if (entries.length === 0) return issues;

    const seen = new Map<string, number>();

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const fullUrl = entry?.fullUrl;
        if (fullUrl === undefined || fullUrl === null) continue;

        if (typeof fullUrl !== 'string' || fullUrl.length === 0) {
            issues.push(createValidationIssue({
                code: 'structural-bundle-fullurl-invalid',
                path: `Bundle.entry[${i}].fullUrl`,
                resourceType: 'Bundle',
                customMessage: `Bundle.entry[${i}].fullUrl must be a non-empty string`,
                severityOverride: 'error',
            }));
            continue;
        }

        const isAbsolute =
            /^[a-z][a-z0-9+.-]*:/i.test(fullUrl) && !/^[A-Za-z]+\/[A-Za-z0-9\-.]+$/.test(fullUrl);
        if (!isAbsolute) {
            issues.push(createValidationIssue({
                code: 'structural-bundle-fullurl-not-absolute',
                path: `Bundle.entry[${i}].fullUrl`,
                resourceType: 'Bundle',
                customMessage: `The fullUrl must be an absolute URL (not '${fullUrl}')`,
                severityOverride: 'error',
            }));
            continue;
        }

        if (fullUrl.includes('/_history/')) {
            issues.push(createValidationIssue({
                code: 'bdl-8-violation',
                path: `Bundle.entry[${i}].fullUrl`,
                resourceType: 'Bundle',
                customMessage: `bdl-8: fullUrl cannot be a version-specific reference (${fullUrl})`,
                severityOverride: 'error',
            }));
        }

        if (bundleType === 'history') continue;

        const versionId = entry?.resource?.meta?.versionId;
        const key = versionId ? `${fullUrl}|${versionId}` : fullUrl;
        if (seen.has(key)) {
            issues.push(createValidationIssue({
                code: 'structural-bundle-fullurl-duplicate',
                path: `Bundle.entry[${i}].fullUrl`,
                resourceType: 'Bundle',
                customMessage:
                    `Duplicate fullUrl "${fullUrl}" — also appears at ` +
                    `Bundle.entry[${seen.get(key)}].fullUrl. ` +
                    'fullUrl values must be unique within a Bundle.',
                severityOverride: 'error',
            }));
        } else {
            seen.set(key, i);
        }
    }

    return issues;
}

export function validateBundleEntryIdConsistency(bundle: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const entries: any[] = bundle?.entry ?? [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const fullUrl: string | undefined = entry?.fullUrl;
        const res = entry?.resource;
        if (!fullUrl || !res?.resourceType || !res?.id) continue;
        if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) continue;
        if (fullUrl.startsWith('urn:')) continue;

        const match = fullUrl.match(/\/([A-Z][a-zA-Z]+)\/([^/]+)$/);
        if (!match) continue;

        const fullUrlType = match[1];
        const fullUrlId = match[2];
        const expectedSuffix = `${res.resourceType}/${res.id}`;

        if (fullUrlType !== res.resourceType || fullUrlId !== res.id) {
            issues.push(createValidationIssue({
                code: 'bundle-entry-fullurl-id-mismatch',
                path: `Bundle.entry[${i}]`,
                resourceType: 'Bundle',
                customMessage:
                    `The fullUrl '${fullUrl}' looks like a RESTful server URL, ` +
                    'so it must end with the correct type and id ' +
                    `(/${expectedSuffix})`,
                severityOverride: 'error',
            }));
        }
    }

    return issues;
}

export function validateBundleLinkRelations(bundle: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const links: any[] = bundle?.link ?? [];
    if (links.length === 0) return issues;

    const seen = new Map<string, number>();
    for (let i = 0; i < links.length; i++) {
        const relation = links[i]?.relation;
        if (!relation) continue;
        if (seen.has(relation)) {
            issues.push(createValidationIssue({
                code: 'invalid',
                path: `Bundle.link[${i}]`,
                resourceType: 'Bundle',
                customMessage: `The link relationship type '${relation}' can only occur once`,
                severityOverride: 'error',
            }));
        } else {
            seen.set(relation, i);
        }
    }

    return issues;
}

export function bundleHasDuplicateEntryIds(bundle: any): boolean {
    const entries: any[] = bundle?.entry ?? [];
    const seen = new Set<string>();
    for (const entry of entries) {
        const id = typeof entry?.id === 'string' ? entry.id : null;
        if (!id) continue;
        if (seen.has(id)) return true;
        seen.add(id);
    }
    return false;
}

export function detectDuplicateBundleEntries(bundle: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const entries: any[] = bundle?.entry ?? [];
    const seen = new Map<string, number>();

    for (let i = 0; i < entries.length; i++) {
        const res = entries[i]?.resource;
        if (!res?.resourceType || !res?.id) continue;
        const versionId = res.meta?.versionId;
        const logical = `${res.resourceType}/${res.id}`;
        const key = versionId ? `${logical}|${versionId}` : logical;
        if (seen.has(key)) {
            issues.push(createValidationIssue({
                code: 'bundle-duplicate-entry',
                path: `Bundle.entry[${i}]`,
                resourceType: 'Bundle',
                customMessage:
                    `Duplicate entry: ${logical} appears at entry[${seen.get(key)}] and entry[${i}].`,
                severityOverride: 'error',
            }));
        } else {
            seen.set(key, i);
        }
    }

    return issues;
}
