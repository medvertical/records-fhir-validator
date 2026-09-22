import { FHIR_TYPE_TABLES, type FhirTypeTable } from './fhir-type-table.generated.js';

export const PRIMITIVE_TYPE_NAMES = new Set([
  'base64Binary', 'boolean', 'canonical', 'code', 'date', 'dateTime', 'decimal',
  'id', 'instant', 'integer', 'integer64', 'markdown', 'oid', 'positiveInt',
  'string', 'time', 'unsignedInt', 'uri', 'url', 'uuid', 'xhtml',
]);

/**
 * Position inside the FHIR definitions: which type we are in, and how deep.
 * `undefined` means the definitions do not describe this subtree — a logical
 * model, a custom resource, or a version whose table is not bundled — and the
 * converter falls back to the element-name heuristics below.
 */
export interface SchemaCursor {
  table: FhirTypeTable;
  type: string;
  path: string;
}

export interface ResolvedChild {
  type: string;
  isArray: boolean;
  next: SchemaCursor | undefined;
}

export function createSchemaCursor(
  resourceType: string,
  fhirVersion: string | undefined,
): SchemaCursor | undefined {
  const table = FHIR_TYPE_TABLES[fhirVersion ?? 'R4'] ?? FHIR_TYPE_TABLES.R4;
  if (!table?.[resourceType]) return undefined;
  return { table, type: resourceType, path: '' };
}

/**
 * Look a child element up in the current type. Handles choice elements, which
 * XML spells out as `valueQuantity` where the definition declares `value[x]`.
 */
export function resolveChild(cursor: SchemaCursor | undefined, child: string): ResolvedChild | undefined {
  if (!cursor) return undefined;
  const root = cursor.table[cursor.type];
  if (!root) return undefined;

  const key = cursor.path ? `${cursor.path}.${child}` : child;
  let entry = root[key];
  let type = entry?.[0];
  let isArray = entry?.[1];
  let nestedPath = key;

  if (!entry) {
    for (let index = 1; index < child.length; index += 1) {
      const character = child[index];
      if (character < 'A' || character > 'Z') continue;
      const baseKey = cursor.path ? `${cursor.path}.${child.slice(0, index)}` : child.slice(0, index);
      const candidate = root[baseKey];
      if (candidate?.[0] !== '[x]') continue;
      const suffix = child.slice(index);
      const lowered = suffix[0].toLowerCase() + suffix.slice(1);
      entry = candidate;
      type = PRIMITIVE_TYPE_NAMES.has(lowered) ? lowered : suffix;
      isArray = candidate[1];
      nestedPath = baseKey;
      break;
    }
  }
  if (!entry || type === undefined) return undefined;

  // Backbone and unnamed element types stay inside the current definition;
  // a named complex type restarts the walk in its own definition.
  const next: SchemaCursor | undefined =
    type === '' || type === 'BackboneElement' || type === 'Element'
      ? { table: cursor.table, type: cursor.type, path: nestedPath }
      : cursor.table[type]
        ? { table: cursor.table, type, path: '' }
        : undefined;

  return { type, isArray: Boolean(isArray), next };
}

export function cursorVersion(cursor: SchemaCursor | undefined): string | undefined {
  if (!cursor) return undefined;
  return Object.keys(FHIR_TYPE_TABLES).find((key) => FHIR_TYPE_TABLES[key] === cursor.table);
}
