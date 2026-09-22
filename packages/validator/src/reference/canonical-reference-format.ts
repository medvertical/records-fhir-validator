import {
  CANONICAL_RESOURCE_TYPES,
  CANONICAL_URN_PATTERN,
  type CanonicalResourceType,
} from './canonical-reference-definitions.js';

export interface CanonicalReferenceInfo {
  canonical: string;
  baseUrl: string;
  version?: string;
  expectedResourceType?: CanonicalResourceType;
  isValidFormat: boolean;
  isConformanceResource: boolean;
}

export function parseCanonicalReference(canonical: string): CanonicalReferenceInfo {
  const trimmed = canonical.trim();
  const separator = trimmed.indexOf('|');
  const hasMultipleSeparators = separator >= 0 && trimmed.indexOf('|', separator + 1) >= 0;
  const baseUrl = separator >= 0 ? trimmed.slice(0, separator) : trimmed;
  const version = separator >= 0 ? trimmed.slice(separator + 1) : undefined;
  const hasValidVersion = separator < 0 || Boolean(version && !/\s/.test(version));

  return {
    canonical: trimmed,
    baseUrl,
    version: version || undefined,
    isValidFormat:
      !hasMultipleSeparators && hasValidVersion && isValidCanonicalFormat(baseUrl),
    isConformanceResource: isConformanceResourceUrl(baseUrl),
  };
}

export function extractCanonicalResourceType(url: string): CanonicalResourceType | null {
  for (const resourceType of CANONICAL_RESOURCE_TYPES) {
    if (url.includes(`/${resourceType}/`)) return resourceType;
  }
  return null;
}

export function matchesCanonicalPattern(canonicalBase: string, pattern: string): boolean {
  if (!pattern.includes('*')) return canonicalBase.includes(pattern);

  const segments = pattern.split('*');
  const first = segments[0];
  if (first && !canonicalBase.startsWith(first)) return false;

  let cursor = first.length;
  for (let index = 1; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!segment) continue;
    const matchIndex = canonicalBase.indexOf(segment, cursor);
    if (matchIndex < 0) return false;
    cursor = matchIndex + segment.length;
  }

  const last = segments.at(-1) ?? '';
  return !last || (
    canonicalBase.endsWith(last)
    && canonicalBase.length - last.length >= cursor
  );
}

function isValidCanonicalFormat(url: string): boolean {
  if (!url || /\s/.test(url)) return false;
  if (CANONICAL_URN_PATTERN.test(url)) return true;

  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

function isConformanceResourceUrl(url: string): boolean {
  if (extractCanonicalResourceType(url)) return true;
  const normalized = url.toLowerCase();
  return normalized.includes('/fhir/') && (
    normalized.includes('profile')
    || normalized.includes('extension')
    || normalized.includes('valueset')
    || normalized.includes('codesystem')
  );
}
