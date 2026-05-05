
import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

/**
 * Paths where the FHIR spec explicitly allows relative URIs.
 * These use `uri` type in the SD but are not required to be absolute.
 */
const RELATIVE_URI_PATHS = new Set([
    'request.url',   // Bundle.entry.request.url — relative request target
    'response.location', // Bundle.entry.response.location
]);

/**
 * Check if a path ends with a segment that allows relative URIs.
 * Uses the last two path segments (e.g. "request.url" from "Bundle.entry[0].request.url").
 */
function allowsRelativeUri(path: string): boolean {
    // Strip array indices for matching
    const stripped = path.replace(/\[\d+\]/g, '');
    const segments = stripped.split('.');
    if (segments.length >= 2) {
        const tail = segments.slice(-2).join('.');
        if (RELATIVE_URI_PATHS.has(tail)) return true;
    }
    return false;
}

/**
 * Validates that a string is a valid absolute URI
 * HAPI rule: "URI must be absolute"
 *
 * Skips the absolute check for paths where FHIR explicitly allows relative URIs
 * (e.g. Bundle.entry.request.url).
 */
export function validateUriFormat(value: string, path: string, resourceType: string, profileUrl?: string): ValidationIssue | null {
    if (!value || typeof value !== 'string') {
        return null;
    }

    // Some FHIR uri fields explicitly allow relative URIs
    if (allowsRelativeUri(path)) {
        return null;
    }

    // Fragment references (#id) are valid in canonical fields when
    // referring to contained resources. FHIR explicitly allows this.
    if (value.startsWith('#')) {
        return null;
    }

    // Reference.type holds a resource type name (e.g. "Patient") which
    // is typed as `uri` in the SD but is NOT an actual URI. Skip the
    // absolute-URI check for these short alphanumeric tokens.
    if (path.endsWith('.type') && /^[A-Z][A-Za-z]+$/.test(value)) {
        return null;
    }

    // Bundle.entry.fullUrl and Bundle.link.url are validated by
    // BundleValidator with more specific messages. Skip here.
    if (path.includes('.fullUrl') || path.endsWith('.fullUrl') ||
        path.includes('Bundle.link')) {
        return null;
    }

    // Regex for absolute URI (must start with scheme)
    // Simple check: scheme starts with alpha, followed by alpha/digit/+/-/., then colon
    const absoluteUriRegex = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

    if (!absoluteUriRegex.test(value)) {
        return createValidationIssue({
            code: 'structural-invalid-uri',
            path,
            resourceType,
            profile: profileUrl,
            severityOverride: 'error',
            customMessage: `URI '${value}' is not a valid absolute URI`,
            details: {
                value
            }
        });
    }

    return null;
}
