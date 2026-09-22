import { CANONICAL_FIELDS } from './canonical-reference-definitions.js';

interface CanonicalReferenceInfoLike {
  isValidFormat: boolean;
}

export function extractCanonicalUrlsFromResource<T extends CanonicalReferenceInfoLike>(
  resource: unknown,
  parseCanonicalUrl: (canonical: string) => T,
): T[] {
  const canonicals: T[] = [];
  extractFromObject(resource, parseCanonicalUrl, canonicals);
  return canonicals;
}

function extractFromObject<T extends CanonicalReferenceInfoLike>(
  obj: unknown,
  parseCanonicalUrl: (canonical: string) => T,
  canonicals: T[],
): void {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return;
  }
  const record = obj as Record<string, unknown>;

  for (const field of CANONICAL_FIELDS) {
    const value = record[field];

    if (value && typeof value === 'string') {
      addCanonicalIfValid(value, parseCanonicalUrl, canonicals);
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === 'string') {
          addCanonicalIfValid(item, parseCanonicalUrl, canonicals);
        }
      });
    }
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      value.forEach((item) => extractFromObject(item, parseCanonicalUrl, canonicals));
    } else if (value && typeof value === 'object') {
      extractFromObject(value, parseCanonicalUrl, canonicals);
    }
  }
}

function addCanonicalIfValid<T extends CanonicalReferenceInfoLike>(
  value: string,
  parseCanonicalUrl: (canonical: string) => T,
  canonicals: T[],
): void {
  const canonicalInfo = parseCanonicalUrl(value);
  if (canonicalInfo.isValidFormat) {
    canonicals.push(canonicalInfo);
  }
}
