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

import type { ValidationIssue } from '../../types';
import type { StructureDefinition } from '../structure-definition-types';
import type { StructureDefinitionLoader } from '../structure-definition-loader';
import { createValidationIssue } from '../../issues';

const SPECIAL_RESOURCE_KEYS = new Set([
  'resourceType', 'id', 'meta', 'implicitRules', 'language',
  'text', 'contained', 'extension', 'modifierExtension',
]);

const SPECIAL_BACKBONE_KEYS = new Set([
  'id', 'extension', 'modifierExtension',
]);

const CHOICE_TYPE_SUFFIXES = [
  'String', 'Boolean', 'Integer', 'Decimal', 'DateTime', 'Date', 'Time',
  'Instant', 'Uri', 'Url', 'Canonical', 'Base64Binary', 'Code', 'Oid', 'Id',
  'Markdown', 'UnsignedInt', 'PositiveInt', 'Uuid', 'Quantity', 'Range',
  'Ratio', 'Period', 'Coding', 'CodeableConcept', 'Identifier', 'Reference',
  'Attachment', 'Address', 'Age', 'Annotation', 'ContactPoint', 'Count',
  'Distance', 'Duration', 'HumanName', 'Money', 'SampledData', 'Signature',
  'Timing',
];

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

interface PathInfo {
  type?: string;
}

export interface SnapshotIndex {
  knownPaths: Set<string>;
  byPath: Map<string, PathInfo>;
}

export interface WalkerDeps {
  sdLoader: StructureDefinitionLoader;
  fhirVersion: 'R4' | 'R5' | 'R6';
  typeIndexCache: Map<string, SnapshotIndex | null>;
}

export function buildSnapshotIndex(sd: StructureDefinition | undefined): SnapshotIndex {
  const knownPaths = new Set<string>();
  const byPath = new Map<string, PathInfo>();
  for (const el of sd?.snapshot?.element || []) {
    if (!el?.path) continue;
    const type = (el as any)?.type?.[0]?.code;
    byPath.set(el.path, { type });
    if (el.path.endsWith('[x]')) {
      const base = el.path.slice(0, -3);
      knownPaths.add(base);
      for (const suffix of CHOICE_TYPE_SUFFIXES) {
        knownPaths.add(base + suffix);
        byPath.set(base + suffix, { type: suffix });
      }
    } else {
      knownPaths.add(el.path);
    }
  }
  return { knownPaths, byPath };
}

export function makeWalkerDeps(
  sdLoader: StructureDefinitionLoader,
  fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
): WalkerDeps {
  return { sdLoader, fhirVersion, typeIndexCache: new Map() };
}

/**
 * Walk `resource` recursively against `index` and return one issue per
 * unrecognised key, descending through BackboneElement children and —
 * when a `WalkerDeps` is provided — into complex datatype children too.
 */
export async function detectUnknownProperties(
  resource: any,
  index: SnapshotIndex,
  resourceType: string,
  sdUrl: string | undefined,
  deps?: WalkerDeps,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  await walk(resource, resourceType, index, sdUrl, issues, true, deps);
  return issues;
}

async function walk(
  value: any,
  pathPrefix: string,
  index: SnapshotIndex,
  sdUrl: string | undefined,
  issues: ValidationIssue[],
  isRoot: boolean,
  deps: WalkerDeps | undefined,
): Promise<void> {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) await walk(item, pathPrefix, index, sdUrl, issues, false, deps);
    return;
  }

  const allowedSpecial = isRoot ? SPECIAL_RESOURCE_KEYS : SPECIAL_BACKBONE_KEYS;

  for (const key of Object.keys(value)) {
    if (allowedSpecial.has(key)) continue;
    if (key.startsWith('_')) continue;

    const childPath = `${pathPrefix}.${key}`;

    if (!index.knownPaths.has(childPath)) {
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

    const info = index.byPath.get(childPath);
    const childValue = (value as any)[key];

    if (!info?.type) continue;
    if (PRIMITIVE_TYPES.has(info.type)) continue;
    if (RESOURCE_LIKE_TYPES.has(info.type)) continue;

    if (BACKBONE_LIKE_TYPES.has(info.type)) {
      await walk(childValue, childPath, index, sdUrl, issues, false, deps);
      continue;
    }

    // Complex datatype — try to load the type's SD and descend with that
    // sub-index. Without `deps`, complex types remain opaque (phase-1
    // behaviour).
    if (deps) {
      const subIndex = await loadTypeIndex(info.type, deps);
      if (subIndex) {
        await walk(childValue, info.type, subIndex, sdUrl, issues, false, deps);
      }
    }
  }
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
      deps.typeIndexCache.set(typeCode, null);
      return null;
    }
    const idx = buildSnapshotIndex(sd);
    deps.typeIndexCache.set(typeCode, idx);
    return idx;
  } catch {
    deps.typeIndexCache.set(typeCode, null);
    return null;
  }
}
