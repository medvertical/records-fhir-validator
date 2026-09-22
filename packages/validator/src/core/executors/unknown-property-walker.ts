/**
 * Recursive unknown-property walker for `detectUnknownElements`.
 *
 * The structural executor has long emitted `structural-unknown-element`
 * for top-level resource keys that aren't in the SD snapshot. Real-world
 * typos almost always sit deeper (Patient.contact[0].relationshp,
 * Bundle.entry[0].requst, …), so this walker descends through the
 * snapshot's BackboneElement paths and flags unknown keys at any depth.
 *
 * Phase 2 (this revision): also loads complex datatype SDs on demand
 * (HumanName, Address, CodeableConcept, ContactPoint, …) so typos
 * inside those types — `name[0].familly` — are caught too.
 *
 * Scope:
 *   - Walks BackboneElement children directly enumerated in the
 *     snapshot.
 *   - Walks complex-datatype children by loading the type's SD via
 *     `SDLoader` and building a sub-index. Sub-indices are cached per
 *     type code so multiple resources sharing HumanName don't pay the
 *     load cost twice in the same validation run.
 *   - Skips primitive types (string, code, uri, …) and Resource /
 *     DomainResource children. Resources nested inside Bundles or
 *     `contained[]` are validated independently by the engine
 *     recursion against their own resourceType's SD.
 *   - Choice-type properties expand `value[x]` to the concrete suffixed
 *     form (`valueString`, `valueQuantity`, …).
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import type { StructureDefinitionLoader } from '../structure-definition-loader.js';
import { createValidationIssue } from '../../issues/index.js';
import { buildSnapshotIndex, type SnapshotIndex } from './unknown-property-snapshot-index.js';
import { createProfileUnreadable } from '../../issues/profile-completeness-issues.js';

export { buildSnapshotIndex, type SnapshotIndex } from './unknown-property-snapshot-index.js';

const SPECIAL_RESOURCE_KEYS = new Set([
  'resourceType', 'id', 'meta', 'implicitRules', 'language',
  'text', 'contained', 'extension', 'modifierExtension',
]);

const SPECIAL_BACKBONE_KEYS = new Set([
  'id', 'extension', 'modifierExtension',
]);

const PRIMITIVE_SIDECAR_KEYS = new Set(['id', 'extension']);

const PRIMITIVE_TYPES = new Set([
  'boolean', 'integer', 'string', 'decimal', 'uri', 'url', 'canonical',
  'base64Binary', 'instant', 'date', 'dateTime', 'time', 'code', 'oid',
  'id', 'markdown', 'unsignedInt', 'positiveInt', 'uuid', 'xhtml', 'integer64',
]);

const RESOURCE_LIKE_TYPES = new Set([
  'Resource', 'DomainResource', 'CanonicalResource', 'MetadataResource',
]);

const BACKBONE_LIKE_TYPES = new Set([
  'BackboneElement', 'Element', 'BackboneType',
]);

const FHIR_DATATYPE_BASE_URL = 'http://hl7.org/fhir/StructureDefinition/';
type ObjectRecord = Record<string, unknown>;

export interface SnapshotIndexCache {
  has(key: string): boolean;
  get(key: string): SnapshotIndex | null | undefined;
  set(key: string, value: SnapshotIndex | null): void;
}

export interface WalkerDeps {
  sdLoader: StructureDefinitionLoader;
  fhirVersion: 'R4' | 'R5' | 'R6';
  typeIndexCache: SnapshotIndexCache;
}

export function makeWalkerDeps(
  sdLoader: StructureDefinitionLoader,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  typeIndexCache: SnapshotIndexCache = new Map(),
): WalkerDeps {
  return { sdLoader, fhirVersion, typeIndexCache };
}

/**
 * Walk `resource` recursively against `index` and return one issue per
 * unrecognised key, descending through BackboneElement children and —
 * when a `WalkerDeps` is provided — into complex datatype children too.
 */
export async function detectUnknownProperties(
  resource: unknown,
  index: SnapshotIndex,
  resourceType: string,
  sdUrl: string | undefined,
  deps?: WalkerDeps,
): Promise<ValidationIssue[]> {
  if (index.knownPaths.size <= 1 && index.knownPaths.has(resourceType)) {
    return [];
  }
  if (hasSparseTopLevelSnapshot(resource, index, resourceType)) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  await walk(resource, resourceType, index, sdUrl, issues, true, deps, new WeakSet());
  return issues;
}

function hasSparseTopLevelSnapshot(resource: unknown, index: SnapshotIndex, resourceType: string): boolean {
  if (!isObjectRecord(resource)) return false;

  let knownNonSpecialKeys = 0;
  let missingNonSpecialKeys = 0;

  for (const key of Object.keys(resource)) {
    if (SPECIAL_RESOURCE_KEYS.has(key) || key.startsWith('_')) continue;
    const path = `${resourceType}.${key}`;
    if (index.knownPaths.has(path)) {
      knownNonSpecialKeys += 1;
    } else {
      missingNonSpecialKeys += 1;
    }
  }

  return missingNonSpecialKeys >= 3 && knownNonSpecialKeys <= 1;
}

async function walk(
  value: unknown,
  pathPrefix: string,
  index: SnapshotIndex,
  sdUrl: string | undefined,
  issues: ValidationIssue[],
  isRoot: boolean,
  deps: WalkerDeps | undefined,
  visited: WeakSet<object>,
  schemaPathPrefix = pathPrefix,
): Promise<void> {
  if (typeof value !== 'object' || value === null || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      await walk(item, pathPrefix, index, sdUrl, issues, false, deps, visited, schemaPathPrefix);
    }
    return;
  }
  if (!isObjectRecord(value)) return;

  const allowedSpecial = isRoot ? SPECIAL_RESOURCE_KEYS : SPECIAL_BACKBONE_KEYS;

  for (const key of Object.keys(value)) {
    if (allowedSpecial.has(key)) continue;
    if (key.startsWith('_')) {
      // The structural sanity pass already emits the canonical invalid
      // property diagnostic for an orphan primitive sidecar. Avoid adding a
      // second nested unknown-field error for the same malformed property.
      if (!Object.prototype.hasOwnProperty.call(value, key.slice(1))) continue;
      validatePrimitiveSidecarProperties(
        value[key],
        `${pathPrefix}.${key.slice(1)}`,
        sdUrl,
        issues,
      );
      continue;
    }

    const childPath = `${pathPrefix}.${key}`;
    const schemaPath = `${schemaPathPrefix}.${key}`;

    if (!index.knownPaths.has(schemaPath)) {
      if (isRoot && deps) {
        const knowledge = await classifyBaseResourcePath(childPath, pathPrefix, deps);
        if (knowledge === 'known') continue;
        if (knowledge === 'undetermined') {
          reportUndeterminedBaseDefinition(pathPrefix, issues);
          continue;
        }
      }

      issues.push(createValidationIssue({
        code: 'structural-unknown-element',
        path: childPath,
        resourceType: pathPrefix.split('.')[0],
        customMessage:
          `Unknown element '${key}' - not defined in ${sdUrl || 'StructureDefinition'}`,
        severityOverride: isRoot ? undefined : 'warning',
      }));
      continue;
    }

    const info = index.byPath.get(schemaPath);
    const childValue = value[key];

    if (!info?.type) continue;
    if (isPrimitiveTypeInfo(info.type)) continue;
    if (RESOURCE_LIKE_TYPES.has(info.type)) continue;

    if (BACKBONE_LIKE_TYPES.has(info.type)) {
      await walk(childValue, childPath, index, sdUrl, issues, false, deps, visited, schemaPath);
      continue;
    }

    // Complex datatype — try to load the type's SD and descend with that
    // sub-index. Without `deps`, complex types remain opaque (phase-1
    // behaviour).
    if (deps) {
      const subIndex = await loadTypeIndex(info.type, deps);
      if (subIndex) {
        await walk(childValue, childPath, subIndex, sdUrl, issues, false, deps, visited, info.type);
      }
    }
  }
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Primitive extension sidecars (`_id`, `_given`, …) are Elements and may
 * contain only `id` and `extension`. Treating every underscore-prefixed key
 * as opaque allowed malformed JSON such as `_id.fhir_comments` to pass the
 * recursive unknown-property check.
 */
function validatePrimitiveSidecarProperties(
  sidecar: unknown,
  primitivePath: string,
  sdUrl: string | undefined,
  issues: ValidationIssue[],
): void {
  const entries = Array.isArray(sidecar) ? sidecar : [sidecar];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    for (const sidecarKey of Object.keys(entry)) {
      if (PRIMITIVE_SIDECAR_KEYS.has(sidecarKey)) continue;
      issues.push(createValidationIssue({
        code: 'structural-unknown-element',
        path: primitivePath,
        resourceType: primitivePath.split('.')[0],
        customMessage:
          `Unknown element '${sidecarKey}' in primitive extension sidecar - ` +
          `not defined in ${sdUrl || 'StructureDefinition'}`,
        severityOverride: undefined,
      }));
    }
  }
}

function isPrimitiveTypeInfo(type: string): boolean {
  if (PRIMITIVE_TYPES.has(type)) return true;
  if (!type) return false;

  const choicePrimitive = type.charAt(0).toLowerCase() + type.slice(1);
  return PRIMITIVE_TYPES.has(choicePrimitive);
}

async function loadTypeIndex(
  typeCode: string,
  deps: WalkerDeps,
): Promise<SnapshotIndex | null> {
  if (deps.typeIndexCache.has(typeCode)) {
    return deps.typeIndexCache.get(typeCode) ?? null;
  }
  try {
    const sd = await deps.sdLoader.loadProfile(
      `${FHIR_DATATYPE_BASE_URL}${typeCode}`,
      deps.fhirVersion,
    );
    if (!sd?.snapshot?.element?.length) {
      return null;
    }
    const idx = buildSnapshotIndex(sd);
    deps.typeIndexCache.set(typeCode, idx);
    return idx;
  } catch {
    return null;
  }
}

/**
 * Whether a root property belongs to the resource's base definition.
 *
 * `undetermined` is not a formality. This runs only for a property the profile
 * itself does not list, and the caller reports `structural-unknown-element` at
 * error severity when the answer is no. Answering `false` because the base
 * definition could not be loaded therefore turns a transient loader failure
 * into an error on a valid resource.
 */
/**
 * One diagnostic per resource type, not one per property: an unloadable base
 * definition affects every property the profile does not list, and the reader
 * needs the fact once.
 */
function reportUndeterminedBaseDefinition(
  pathPrefix: string,
  issues: ValidationIssue[],
): void {
  const resourceType = pathPrefix.split('.')[0];
  const baseUrl = `${FHIR_DATATYPE_BASE_URL}${resourceType}`;
  const alreadyReported = issues.some(issue =>
    issue.code === 'profile-unreadable'
    && issue.resourceType === resourceType
    && typeof issue.details === 'object'
    && issue.details !== null
    && (issue.details as Record<string, unknown>).reason === 'base-definition');
  if (alreadyReported) return;
  issues.push(createProfileUnreadable({
    profileUrl: baseUrl,
    resourceType,
    reason: 'base-definition',
  }));
}

async function classifyBaseResourcePath(
  childPath: string,
  resourceType: string,
  deps: WalkerDeps,
): Promise<'known' | 'unknown' | 'undetermined'> {
  const cacheKey = `resource:${resourceType}`;
  const cached = deps.typeIndexCache.get(cacheKey);
  if (cached) return cached.knownPaths.has(childPath) ? 'known' : 'unknown';

  try {
    const sd = await deps.sdLoader.loadProfile(
      `${FHIR_DATATYPE_BASE_URL}${resourceType}`,
      deps.fhirVersion,
    );
    if (!sd?.snapshot?.element?.length) {
      return 'undetermined';
    }
    const idx = buildSnapshotIndex(sd);
    deps.typeIndexCache.set(cacheKey, idx);
    return idx.knownPaths.has(childPath) ? 'known' : 'unknown';
  } catch {
    return 'undetermined';
  }
}
