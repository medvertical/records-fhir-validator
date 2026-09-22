import type { SliceDefinition } from './slice-types.js';
import { splitResolveDiscriminatorPath } from './slice-discriminator-path.js';
import {
  getValueAtPath,
  inferType,
} from './slice-utils.js';

export function matchResolvedTypeDiscriminator(
  resolvedElement: unknown,
  slice: SliceDefinition,
  remainder: string,
  allSlices?: SliceDefinition[],
  typeSpecPath = '$this',
): boolean {
  if (!isRecord(resolvedElement)) return false;

  if (remainder) {
    const ofTypeMatch = remainder.match(/^ofType\(([^)]+)\)$/);
    if (ofTypeMatch) return resolvedElement.resourceType === ofTypeMatch[1];
  }

  const typeSpecs = getTypeSpecsForDiscriminator(slice, typeSpecPath);
  if (typeSpecs.length === 0) return false;

  const targetProfiles = typeSpecs.flatMap(spec => spec.targetProfile ?? []);
  if (targetProfiles.length > 0) {
    const meta = isRecord(resolvedElement.meta) ? resolvedElement.meta : null;
    const profiles = toProfileArray(meta?.profile);
    if (profiles.some(profile => profileListContains(targetProfiles, profile))) return true;

    const allowedTargetTypes = new Set(targetProfiles.map(profileToResourceType).filter(Boolean));
    if (
      typeof resolvedElement.resourceType === 'string' &&
      allowedTargetTypes.has(resolvedElement.resourceType) &&
      targetProfilesAreDistinguishing(slice, allSlices, typeSpecPath)
    ) {
      return true;
    }
  }

  const allowedTypeCodes = typeSpecs.map(spec => spec.code).filter(Boolean);
  return typeof resolvedElement.resourceType === 'string' &&
    allowedTypeCodes.includes(resolvedElement.resourceType);
}

export function matchTypeDiscriminator(element: unknown, slice: SliceDefinition, path: string): boolean {
  const value = getValueAtPath(element, path);
  if (value === null || value === undefined) return false;

  const valueType = inferType(value);
  const typeSpecs = getTypeSpecsForDiscriminator(slice, path);

  return typeSpecs.some(t => typeCodeMatchesValue(t.code, valueType, value));
}

export function getTypeSpecsForDiscriminator(
  slice: SliceDefinition,
  path: string,
): Array<{ code: string; profile?: string[]; targetProfile?: string[] }> {
  // In real snapshots, sliced BackboneElements often carry the generic root
  // type on the slice itself while the discriminator-specific type/profile is
  // defined on a child, e.g. Bundle.entry:composition.resource. For
  // discriminator path "resource", that child constraint is authoritative.
  if (slice.childTypes && path && path !== '$this') {
    const childSpecs = slice.childTypes.get(path);
    if (childSpecs && childSpecs.length > 0) return childSpecs;
    // `item.resolve()` discriminates on what the reference at `item` points
    // to, so the constraint lives on `item` itself. Looking up the literal
    // path with the call attached finds nothing and the discriminator counts
    // as unresolvable.
    const resolveStep = splitResolveDiscriminatorPath(path);
    if (resolveStep && resolveStep.referencePath !== '$this') {
      const referenceSpecs = slice.childTypes.get(resolveStep.referencePath);
      if (referenceSpecs && referenceSpecs.length > 0) return referenceSpecs;
    }
  }
  return slice.type ?? [];
}

export function stripCanonicalVersion(profile: string): string {
  return profile.split('|')[0] ?? profile;
}

export function typeCodeMatchesValue(expectedType: string | undefined, inferredType: string, value: unknown): boolean {
  if (!expectedType) return false;
  if (expectedType === inferredType) return true;

  // A valid Quantity does not need to carry `unit`. Do not infer its type
  // from the presence of optional children: incomplete or constrained
  // Quantities still need to match a type-discriminator slice so their
  // missing/fixed child rules can be reported precisely.
  if (expectedType === 'Quantity' && isQuantityLike(value)) {
    return true;
  }

  if (isRecord(value) && typeof value.resourceType === 'string') {
    return expectedType === value.resourceType;
  }

  if (expectedType === 'CodeableConcept' && isCodeableConceptLike(value)) {
    return true;
  }
  if (expectedType === 'Coding' && isCodingLike(value)) {
    return true;
  }
  // Complex datatypes carry no runtime type marker, so closed value[x]
  // slicings (e.g. eu-lab Observation.value[x]) must recognise them by shape
  // or every Ratio/Range/SampledData value fails the whole slicing.
  if (expectedType === 'Ratio' && isShapedLike(value, RATIO_KEYS, ['numerator', 'denominator'])) {
    return true;
  }
  if (expectedType === 'Range' && isShapedLike(value, RANGE_KEYS, ['low', 'high'])) {
    return true;
  }
  if (expectedType === 'SampledData' && isShapedLike(value, SAMPLED_DATA_KEYS, ['origin', 'period', 'dimensions'])) {
    return true;
  }
  // Identifier is only inferable when both system and value are present, but
  // real instances (e.g. BALP ihe-otherId) legally carry type+value alone —
  // without shape matching those fail closed valueIdentifier slicings.
  if (expectedType === 'Identifier' && isIdentifierLike(value)) {
    return true;
  }

  if (isExtensionOnlyObject(value) && !PRIMITIVE_TYPE_CODES.has(expectedType)) {
    return true;
  }

  if (typeof value === 'number') return numericTypeCodeMatches(expectedType, value);

  if (typeof value !== 'string') return false;
  switch (expectedType) {
    case 'date':
      return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value);
    case 'dateTime':
      return /^\d{4}(-\d{2}(-\d{2}(T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)?)?)?)?$/.test(value);
    case 'instant':
      return /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(value);
    case 'time':
      return /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?$/.test(value);
    case 'string':
    case 'code':
    case 'markdown':
    case 'id':
    case 'uri':
    case 'url':
    case 'canonical':
    case 'oid':
    case 'uuid':
      return inferredType === 'string';
    default:
      return false;
  }
}

// JSON numbers carry no FHIR type marker and inferType can only say
// integer/decimal, so the integer family (unsignedInt/positiveInt/integer64)
// must be recognised by value shape — otherwise closed value[x] slicings like
// PoCD operating-hours valueUnsignedInt are unmatchable.
function numericTypeCodeMatches(expectedType: string, value: number): boolean {
  switch (expectedType) {
    case 'decimal':
      return true;
    case 'integer':
    case 'integer64':
      return Number.isInteger(value);
    case 'unsignedInt':
      return Number.isInteger(value) && value >= 0;
    case 'positiveInt':
      return Number.isInteger(value) && value >= 1;
    default:
      return false;
  }
}

function targetProfilesAreDistinguishing(
  currentSlice: SliceDefinition,
  allSlices: SliceDefinition[] | undefined,
  typeSpecPath: string,
): boolean {
  if (!allSlices || allSlices.length <= 1) return false;

  const currentProfiles = collectTargetProfiles(currentSlice, typeSpecPath);
  if (currentProfiles.size === 0) return false;

  for (const otherSlice of allSlices) {
    if (otherSlice.sliceName === currentSlice.sliceName) continue;
    const otherProfiles = collectTargetProfiles(otherSlice, typeSpecPath);
    if (otherProfiles.size === 0) continue;
    for (const profile of currentProfiles) {
      if (otherProfiles.has(profile)) return false;
    }
  }

  return true;
}

function collectTargetProfiles(slice: SliceDefinition, typeSpecPath: string): Set<string> {
  const profiles = new Set<string>();
  for (const spec of getTypeSpecsForDiscriminator(slice, typeSpecPath)) {
    for (const profile of spec.targetProfile ?? []) profiles.add(stripCanonicalVersion(profile));
  }
  return profiles;
}

function profileToResourceType(profileUrl: string): string | null {
  const clean = stripCanonicalVersion(profileUrl);
  const tail = clean.split('/').pop();
  if (!tail) return null;
  return tail.includes('-') ? null : tail;
}

function toProfileArray(profile: unknown): string[] {
  if (Array.isArray(profile)) return profile.filter((p): p is string => typeof p === 'string');
  if (typeof profile === 'string') return [profile];
  return [];
}

function profileListContains(profiles: string[], requestedProfile: string): boolean {
  return profiles.some(profile => profilesMatch(profile, requestedProfile));
}

function profilesMatch(left: string, right: string): boolean {
  return left === right || stripCanonicalVersion(left) === stripCanonicalVersion(right);
}

const PRIMITIVE_TYPE_CODES = new Set<string>([
  'string', 'code', 'markdown', 'id', 'uri', 'url', 'canonical', 'oid', 'uuid', 'xhtml',
  'integer', 'unsignedInt', 'positiveInt', 'integer64',
  'decimal', 'boolean',
  'date', 'dateTime', 'instant', 'time',
  'base64Binary',
]);

function isExtensionOnlyObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(k => k === 'extension' || k === 'id');
}

function isCodeableConceptLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every(key => CODEABLE_CONCEPT_KEYS.has(key))) return false;
  return Array.isArray(value.coding) || typeof value.text === 'string';
}

function isCodingLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every(key => CODING_KEYS.has(key))) return false;
  return ['system', 'version', 'code', 'display', 'userSelected'].some(key => key in value);
}

function isIdentifierLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every(key => IDENTIFIER_KEYS.has(key))) return false;

  // Identifier.value is a string; a numeric `value` indicates Quantity-shaped
  // data that must not satisfy an Identifier slice.
  if (value.value !== undefined && typeof value.value !== 'string') return false;
  return ['use', 'type', 'system', 'value', 'period', 'assigner'].some(key => value[key] !== undefined);
}

function isQuantityLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every(key => QUANTITY_KEYS.has(key))) return false;

  return typeof value.value === 'number' ||
    typeof value.comparator === 'string' ||
    typeof value.unit === 'string' ||
    typeof value.code === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShapedLike(
  value: unknown,
  allowedKeys: Set<string>,
  identifyingKeys: string[],
): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every(key => allowedKeys.has(key))) return false;
  return identifyingKeys.some(key => value[key] !== undefined);
}

const CODEABLE_CONCEPT_KEYS = new Set(['id', 'extension', 'coding', 'text']);
const CODING_KEYS = new Set(['id', 'extension', 'system', 'version', 'code', 'display', 'userSelected']);
const QUANTITY_KEYS = new Set(['id', 'extension', 'value', 'comparator', 'unit', 'system', 'code']);
const IDENTIFIER_KEYS = new Set([
  'id', 'extension', 'use', '_use', 'type', 'system', '_system', 'value', '_value', 'period', 'assigner',
]);
const RATIO_KEYS = new Set(['id', 'extension', 'numerator', 'denominator']);
const RANGE_KEYS = new Set(['id', 'extension', 'low', 'high']);
const SAMPLED_DATA_KEYS = new Set([
  'id', 'extension', 'origin', 'period', 'factor', 'lowerLimit', 'upperLimit', 'dimensions', 'data', '_data',
]);
