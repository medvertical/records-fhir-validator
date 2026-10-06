import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

const URI_IDENTIFIER_SYSTEM = 'urn:ietf:rfc:3986';

/**
 * An identifier in the `urn:ietf:rfc:3986` system is itself a URI, so its
 * value needs a scheme: a bare OID (`2.16.840.1.113883.19.5`) needs its
 * `urn:oid:` prefix. The reference validator rejects such a value, and a
 * `file:` value only counts with a path or authority after the scheme.
 */
export function checkUriIdentifierValue(identifier: Record<string, unknown>, path: string): ValidationIssue | null {
    const { system, value } = identifier;
    if (system !== URI_IDENTIFIER_SYSTEM || typeof value !== 'string' || isAbsoluteUri(value)) return null;
    return createValidationIssue({
        code: 'identifier-uri-value-not-absolute',
        path: `${path}.value`,
        resourceType: path.split('.')[0],
        customMessage: `If identifier.system is '${URI_IDENTIFIER_SYSTEM}', then the identifier.value must be a full URI (e.g. start with a scheme), not '${value}'`,
        severityOverride: 'error',
        details: { fieldPath: `${path}.value`, value },
    });
}

function isAbsoluteUri(value: string): boolean {
    const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/s);
    if (!scheme) return false;
    return scheme[1].toLowerCase() !== 'file' || scheme[2].startsWith('/') || scheme[2].includes(':');
}
