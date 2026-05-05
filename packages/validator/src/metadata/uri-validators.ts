/**
 * URI Validation Utilities
 * 
 * Helper functions for validating URIs in different formats:
 * - URLs (http://, https://)
 * - URNs (urn:)
 * - OIDs (oid:)
 * - UUIDs (uuid:, urn:uuid:)
 * - Relative references
 */

export interface UriValidationResult {
  isValid: boolean;
  type: 'url' | 'urn' | 'oid' | 'uuid' | 'relative' | 'unknown';
  reason?: string;
}

/**
 * Validate URI format and determine type
 */
export function validateUriFormat(uri: string): UriValidationResult {
  // Check for URL (http, https, ftp)
  // Check for URL (http, https, ftp)
  if (uri.startsWith('http:') || uri.startsWith('https:') || uri.startsWith('ftp:')) {
    // RFC 3986 allows scheme:path (e.g. http:healthier.sg) even if it's not a standard URL with authority
    // strict URL parsing would fail, but it is a valid URI.
    try {
      new URL(uri);
      return { isValid: true, type: 'url' };
    } catch {
      // If URL parsing fails, it might still be a valid generic URI (scheme:path)
      // We check if it has at least one char after colon
      if (uri.length > uri.indexOf(':') + 1) {
        return { isValid: true, type: 'url', reason: undefined };
      }
      return { isValid: false, type: 'url', reason: 'Invalid URL format' };
    }
  }

  // Check for URN (urn:)
  if (uri.startsWith('urn:')) {
    // URN format: urn:<nid>:<nss>
    const urnPattern = /^urn:[a-z0-9][a-z0-9-]{0,31}:.+$/i;
    if (urnPattern.test(uri)) {
      return { isValid: true, type: 'urn' };
    }
    return { isValid: false, type: 'urn', reason: 'Invalid URN format' };
  }

  // Check for OID (oid:)
  if (uri.startsWith('oid:')) {
    // OID format: oid:digit(dot digit)*
    const oidPattern = /^oid:\d+(\.\d+)*$/;
    if (oidPattern.test(uri)) {
      return { isValid: true, type: 'oid' };
    }
    return { isValid: false, type: 'oid', reason: 'Invalid OID format' };
  }

  // Check for UUID (urn:uuid: or uuid:)
  if (uri.startsWith('urn:uuid:') || uri.startsWith('uuid:')) {
    // Extract UUID part and validate
    const uuidPart = uri.replace(/^(urn:)?uuid:/, '');
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(uuidPart)) {
      return { isValid: true, type: 'uuid' };
    }
    return { isValid: false, type: 'uuid', reason: 'Invalid UUID format (expected: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)' };
  }

  // Check for relative reference (ResourceType/id or relative path)
  if (/^[A-Z][a-zA-Z]+\/[A-Za-z0-9\-\.]+/.test(uri) || uri.startsWith('/') || uri.startsWith('#')) {
    return { isValid: true, type: 'relative' };
  }

  // If it looks like a URL without scheme, it's invalid
  if (uri.includes('.') && uri.includes('/') && !uri.includes(':')) {
    return { isValid: false, type: 'unknown', reason: 'Looks like URL without scheme' };
  }

  // If no scheme (no colon) and didn't match relative patterns above, reject
  if (!uri.includes(':')) {
    return { isValid: false, type: 'unknown', reason: 'Invalid URI format: missing scheme' };
  }

  // Unknown or custom URI scheme (has colon)
  return { isValid: true, type: 'unknown' };
}

/**
 * Check if URI looks like a FHIR reference
 * Matches patterns like: Patient/123, Organization/xyz, etc.
 */
export function looksLikeReference(uri: string): boolean {
  const referencePattern = /^[A-Z][a-zA-Z]+\/[A-Za-z0-9\-\.]+/;
  return referencePattern.test(uri);
}

/**
 * Helper method to validate URLs
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

