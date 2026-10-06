import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { assertFhirObjectTraversalCapacity } from '../utils/object-traversal-limit.js';

const INCLUDE_SYSTEM = /\.compose\.(?:include|exclude)(?:\[\d+\])?\.system$/;
const NARRATIVE_TARGET = /\s(?:id|name)\s*=\s*(["'])([^"']+)\1/g;

/**
 * A system uri that points into the resource (`#migrated-from`) names an
 * element id or narrative anchor of that resource. The reference validator
 * warns when nothing carries it, and rejects it outright in a ValueSet
 * include or exclude, whose system has to resolve.
 */
export function unresolvedInternalSystemIssues(resource: unknown): ValidationIssue[] {
  if (!isRecord(resource) || typeof resource.resourceType !== 'string') return [];
  const resourceType = resource.resourceType;
  const targets = new Set<string>();
  const candidates: Array<{ path: string; fragment: string }> = [];
  const pending: Array<{ value: unknown; path: string }> = [{ value: resource, path: resourceType }];
  const visited = new WeakSet<object>();
  let processed = 0;
  while (pending.length > 0) {
    const { value, path } = pending.pop()!;
    if (typeof value !== 'object' || value === null || visited.has(value)) continue;
    assertFhirObjectTraversalCapacity(processed++, 'contained-resource');
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => pending.push({ value: item, path: `${path}[${index}]` }));
      continue;
    }
    if (!isRecord(value)) continue;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'id' && typeof child === 'string') targets.add(child);
      else if (key === 'div' && typeof child === 'string') {
        for (const match of child.matchAll(NARRATIVE_TARGET)) targets.add(match[2]);
      } else if (key === 'system' && typeof child === 'string' && child.startsWith('#') && child.length > 1) {
        candidates.push({ path: `${path}.system`, fragment: child.slice(1) });
      } else if (typeof child === 'object' && child !== null) {
        pending.push({ value: child, path: `${path}.${key}` });
      }
    }
  }
  return candidates.filter(({ fragment }) => !targets.has(fragment)).map(({ path, fragment }) => {
    const resolvingRequired = INCLUDE_SYSTEM.test(path);
    return createValidationIssue({
      code: 'structural-internal-uri-unresolved',
      path,
      resourceType,
      severityOverride: resolvingRequired ? 'error' : 'warning',
      customMessage: resolvingRequired
        ? `The URL value '#${fragment}' is invalid because there is no matching target`
        : `The URL value '#${fragment}' might be wrong because it appears to point to an internal target, but there is no matching target`,
      details: { value: `#${fragment}` },
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
