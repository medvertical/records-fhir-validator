/**
 * Fix Patch Applier (D-1 phase 1)
 *
 * Takes a resolved `FixPatch` (one that has already been run through
 * `resolvePatch()` so the `{{key}}` templates are expanded) and applies
 * it to a deep-cloned copy of a FHIR resource.
 *
 * Supported path syntax:
 *   - dot paths:           `Patient.gender`
 *   - array indexing:      `Patient.identifier[0].system`
 *   - resource-type prefix optional: `Patient.gender` and `gender` both work
 *
 * Not supported (intentionally — these need full FHIRPath, which is
 * what the validator engine itself uses):
 *   - choice-type collapsing (`Observation.value` instead of
 *     `valueQuantity`)
 *   - filters (`Patient.identifier.where(use='official').system`)
 *   - traversal across references
 *
 * The applier is a *patch executor*, not a fixer that infers the right
 * value. Callers are expected to supply a concrete `value` in the patch.
 * Patches whose `value` still contains `{{...}}` placeholders are
 * rejected (they came out of `resolvePatch()` unresolved).
 */

import type { FixPatch } from '@records-fhir/validation-types/fix-suggestions';

export interface FixApplyResult {
  /** True when the patch was applied successfully. */
  applied: boolean;
  /** The mutated resource (deep clone of input) on success, or the unchanged original on failure. */
  resource: Record<string, unknown>;
  /** Human-readable reason for failure when `applied` is false. */
  reason?: string;
}

interface PathSegment {
  /** Property name. */
  key: string;
  /** Array index, when the segment ends with `[<n>]`. */
  index?: number;
}

const SEGMENT_RE = /^([A-Za-z_][\w-]*)(?:\[(\d+)\])?$/;

/**
 * Parse a dot path into segments. Returns null when any segment is
 * malformed so the caller can reject the patch with a clear reason.
 *
 * The first segment is treated as the resource-type prefix and dropped
 * if it matches the resource's `resourceType`. This lets patches use
 * either `Patient.gender` or `gender` and behave the same.
 */
function parsePath(path: string, resourceType?: string): PathSegment[] | null {
  if (!path) return null;
  const raw = path.split('.').map(s => s.trim()).filter(Boolean);
  if (raw.length === 0) return null;

  // Drop a leading resource-type segment if it matches.
  if (resourceType && raw[0] === resourceType) raw.shift();

  const segments: PathSegment[] = [];
  for (const part of raw) {
    const match = SEGMENT_RE.exec(part);
    if (!match) return null;
    const segment: PathSegment = { key: match[1] };
    if (match[2] !== undefined) segment.index = Number(match[2]);
    segments.push(segment);
  }
  return segments;
}

function deepClone<T>(value: T): T {
  // Resources are JSON-serialisable; structuredClone (Node 18+) is
  // available everywhere we run.
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Walk to the parent of the final segment, creating missing
 * intermediate objects/arrays for `add` operations. Returns the
 * parent + the final segment, or null when the walk failed (e.g.
 * tried to index past an array bound for `replace`/`remove`).
 */
function walkToParent(
  resource: Record<string, unknown>,
  segments: PathSegment[],
  createMissing: boolean,
): { parent: Record<string, unknown> | unknown[]; finalSeg: PathSegment } | null {
  if (segments.length === 0) return null;
  let cursor: Record<string, unknown> | unknown[] = resource;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (Array.isArray(cursor)) {
      // Array indexing on an array cursor — not supported; the previous
      // segment should have specified `[index]`.
      return null;
    }
    let next = (cursor as Record<string, unknown>)[seg.key];

    if (next === undefined) {
      if (!createMissing) return null;
      next = seg.index !== undefined ? [] : {};
      (cursor as Record<string, unknown>)[seg.key] = next;
    }

    if (seg.index !== undefined) {
      if (!Array.isArray(next)) return null;
      let entry = next[seg.index];
      if (entry === undefined) {
        if (!createMissing) return null;
        entry = {};
        next[seg.index] = entry;
      }
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
      cursor = entry as Record<string, unknown>;
    } else {
      if (typeof next !== 'object' || next === null) return null;
      cursor = next as Record<string, unknown>;
    }
  }

  return { parent: cursor, finalSeg: segments[segments.length - 1] };
}

/**
 * Coerce a string patch value into a parsed JSON value when it looks
 * like one (object/array/number/boolean/null). Otherwise treat it as
 * a string. This means a `value: '{ "system": "..." }'` template is
 * applied as an object, not as a string literal.
 */
function coerceValue(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

export function applyFixPatch(
  resource: Record<string, unknown>,
  patch: FixPatch,
): FixApplyResult {
  if (!resource || typeof resource !== 'object') {
    return { applied: false, resource, reason: 'Resource must be an object' };
  }
  if (typeof patch?.path !== 'string') {
    return { applied: false, resource, reason: 'Patch is missing path' };
  }
  if (/\{\{\w+\}\}/.test(patch.path)) {
    return { applied: false, resource, reason: 'Patch path still contains unresolved {{templates}}' };
  }
  if (patch.action !== 'add' && patch.action !== 'replace' && patch.action !== 'remove') {
    return { applied: false, resource, reason: `Unknown patch action: ${patch.action}` };
  }
  if ((patch.action === 'add' || patch.action === 'replace') && patch.value === undefined) {
    return { applied: false, resource, reason: `Action '${patch.action}' requires a value` };
  }
  if (patch.value !== undefined && /\{\{\w+\}\}/.test(patch.value)) {
    return { applied: false, resource, reason: 'Patch value still contains unresolved {{templates}}' };
  }

  const resourceType = typeof resource.resourceType === 'string' ? resource.resourceType : undefined;
  const segments = parsePath(patch.path, resourceType);
  if (!segments || segments.length === 0) {
    return { applied: false, resource, reason: `Could not parse patch path: ${patch.path}` };
  }

  const cloned = deepClone(resource);
  const walk = walkToParent(cloned, segments, patch.action === 'add');
  if (!walk) {
    return { applied: false, resource, reason: `Patch path does not exist on resource: ${patch.path}` };
  }

  const { parent, finalSeg } = walk;
  const value = coerceValue(patch.value);

  if (Array.isArray(parent)) {
    return { applied: false, resource, reason: 'Patch parent is an array — index the parent path explicitly' };
  }

  switch (patch.action) {
    case 'add': {
      // For add we accept "create the field if missing" semantics; if
      // the field already exists with the same value, treat as a no-op.
      if (finalSeg.index !== undefined) {
        const arr = (parent[finalSeg.key] as unknown[] | undefined) ?? [];
        if (!Array.isArray(arr)) {
          return { applied: false, resource, reason: `Path target is not an array: ${patch.path}` };
        }
        arr[finalSeg.index] = value;
        parent[finalSeg.key] = arr;
      } else {
        parent[finalSeg.key] = value;
      }
      return { applied: true, resource: cloned };
    }
    case 'replace': {
      if (finalSeg.index !== undefined) {
        const arr = parent[finalSeg.key];
        if (!Array.isArray(arr)) {
          return { applied: false, resource, reason: `Path target is not an array: ${patch.path}` };
        }
        if (finalSeg.index >= arr.length) {
          return { applied: false, resource, reason: `Array index out of bounds: ${patch.path}` };
        }
        arr[finalSeg.index] = value;
      } else {
        if (!(finalSeg.key in parent)) {
          return { applied: false, resource, reason: `Cannot replace missing field: ${patch.path}` };
        }
        parent[finalSeg.key] = value;
      }
      return { applied: true, resource: cloned };
    }
    case 'remove': {
      if (finalSeg.index !== undefined) {
        const arr = parent[finalSeg.key];
        if (!Array.isArray(arr)) {
          return { applied: false, resource, reason: `Path target is not an array: ${patch.path}` };
        }
        if (finalSeg.index >= arr.length) {
          return { applied: false, resource, reason: `Array index out of bounds: ${patch.path}` };
        }
        arr.splice(finalSeg.index, 1);
      } else {
        delete parent[finalSeg.key];
      }
      return { applied: true, resource: cloned };
    }
  }

  return { applied: false, resource, reason: `Unknown patch action: ${String(patch.action)}` };
}
