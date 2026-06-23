import { normalizeCanonicalPath } from './dtos';

/**
 * Portable validation issue identity helpers.
 *
 * These helpers intentionally avoid Node-only crypto APIs because the
 * validation-types package is shared by server, validator package, and client
 * code. The hash is not cryptographic; it is a stable compact identifier for
 * deterministic issue IDs.
 */

export interface ValidationIssueIdentityInput {
  aspect: string;
  severity?: string;
  code?: string;
  path?: string;
  resourceType?: string;
  message?: string;
  profile?: string;
  ruleId?: string;
  details?: unknown;
}

export function computeValidationIssueId(input: ValidationIssueIdentityInput): string {
  const aspect = sanitizeIssueIdSegment(input.aspect || 'validation');
  const code = sanitizeIssueIdSegment(input.code || 'issue');
  const hash = stableHash({
    aspect: normalizeIdentityText(input.aspect),
    severity: normalizeIdentityText(input.severity),
    code: normalizeIdentityText(input.code),
    path: normalizeIdentityPath(input.path),
    resourceType: normalizeIdentityText(input.resourceType),
    message: normalizeIdentityText(input.message),
    profile: normalizeIdentityText(input.profile),
    ruleId: normalizeIdentityText(input.ruleId),
    details: input.details,
  });

  return `${aspect}-${code}-${hash}`;
}

export function stableStringify(value: unknown): string {
  return stableStringifyValue(value, new WeakSet<object>());
}

function stableStringifyValue(value: unknown, seen: WeakSet<object>): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (seen.has(value)) return '"__cycle__"';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = `[${value.map(item => stableStringifyValue(item, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }

  const source = value as Record<string, unknown>;
  const result = `{${Object.keys(source)
    .sort()
    .filter(key => source[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${stableStringifyValue(source[key], seen)}`)
    .join(',')}}`;

  seen.delete(value);
  return result;
}

function normalizeIdentityText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value).trim().replace(/\s+/g, ' ');
}

function normalizeIdentityPath(value: unknown): string | undefined {
  const text = normalizeIdentityText(value);
  if (!text) return undefined;
  return normalizeCanonicalPath(text, 512).normalized || undefined;
}

function stableHash(value: unknown): string {
  return cyrb53(stableStringify(value)).toString(36).padStart(11, '0');
}

function sanitizeIssueIdSegment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || 'issue';
}

function cyrb53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
