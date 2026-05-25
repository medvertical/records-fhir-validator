/**
 * Tree Shaker
 *
 * Starting from a set of root canonical URLs (the profiles the user
 * actually references), walk the transitive closure of all outgoing
 * canonical references. Any pinned canonical NOT in the closure is
 * dropped.
 *
 * This dramatically reduces the working set — e.g. hl7.terminology.r4
 * goes from 4158 canonicals to ~7 when only US Core is installed.
 */

import type { PinnedCanonical } from './types';

export interface CanonicalGraph {
  outgoingRefs: Map<string, Set<string>>;
}

export function treeShake(
  pinned: Map<string, PinnedCanonical>,
  roots: string[],
  graph: CanonicalGraph,
): Map<string, PinnedCanonical> {
  if (roots.length === 0) return pinned;

  const retained = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const url = queue.pop()!;

    // Find all pinned entries matching this URL (any version)
    for (const [key, entry] of pinned) {
      if (entry.url === url && !retained.has(key)) {
        retained.add(key);

        // Walk outgoing references from this canonical
        const refs = graph.outgoingRefs.get(url);
        if (refs) {
          for (const ref of refs) {
            queue.push(ref);
          }
        }
      }
    }
  }

  const result = new Map<string, PinnedCanonical>();
  for (const [key, entry] of pinned) {
    if (retained.has(key)) {
      result.set(key, entry);
    }
  }

  return result;
}

/**
 * Extract outgoing canonical references from a FHIR resource JSON.
 * Checks fields that contain canonical references per the FHIR spec:
 * - StructureDefinition: baseDefinition, type, targetProfile, profile
 * - ValueSet: compose.include[].system, compose.include[].valueSet
 * - CodeSystem: valueSet
 * - SearchParameter: base, expression
 */
export function extractOutgoingRefs(resource: Record<string, unknown>): string[] {
  const refs: string[] = [];

  function collectCanonicals(obj: unknown, depth: number): void {
    if (depth > 10) return;
    if (obj === null || obj === undefined) return;

    if (typeof obj === 'string') {
      // Canonical URLs look like http(s)://... — skip plain strings
      if (obj.startsWith('http://') || obj.startsWith('https://')) {
        // Strip version suffix for the reference (pinning adds it back)
        const bare = obj.split('|')[0];
        refs.push(bare);
      }
      return;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) collectCanonicals(item, depth + 1);
      return;
    }

    if (typeof obj === 'object') {
      const record = obj as Record<string, unknown>;
      // Only walk fields known to contain canonical references
      const canonicalFields = [
        'baseDefinition', 'targetProfile', 'profile', 'valueSet',
        'system', 'reference', 'url', 'canonical',
      ];
      for (const field of canonicalFields) {
        if (field in record) collectCanonicals(record[field], depth + 1);
      }
      // Walk nested structures
      if (record.type && Array.isArray(record.type)) collectCanonicals(record.type, depth + 1);
      if (record.element && Array.isArray(record.element)) {
        for (const el of record.element as Record<string, unknown>[]) {
          if (el.type) collectCanonicals(el.type, depth + 1);
          if (el.binding) collectCanonicals(el.binding, depth + 1);
        }
      }
      if (record.compose) collectCanonicals(record.compose, depth + 1);
      if (record.include && Array.isArray(record.include)) collectCanonicals(record.include, depth + 1);
      if (record.differential) collectCanonicals(record.differential, depth + 1);
      if (record.snapshot) collectCanonicals(record.snapshot, depth + 1);
    }
  }

  collectCanonicals(resource, 0);

  // Deduplicate
  return [...new Set(refs)];
}
