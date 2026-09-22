import { getPrimitiveSidecar, resolveFhirSegmentValue } from '../fhir-primitive-sidecar.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import { typeCodeMatchesValue } from '../../validators/slice-type-discriminator.js';
import { inferType } from '../../validators/slice-value-type.js';
import { excludeAmbiguousResliceItems } from './profile-nested-slice-ambiguity.js';
import {
  buildFunctionPathPredicate,
  extractFixed,
  extractPattern,
  hasFunctionPathSegments,
  valueContainsPattern,
} from './profile-nested-slice-function-paths.js';

type ElementDef = { id?: string; path?: string };

export function resolveNestedSliceParentItems(
  resource: unknown,
  elementDef: ElementDef,
  structureDef: StructureDefinition,
  getValueAtPath: (resource: unknown, path: string) => unknown,
): unknown[] | null {
  const context = findNestedSliceContext(elementDef, structureDef);
  if (!context) return null;

  const sliceRootValue = getValueAtPath(resource, context.sliceElement.path);
  const sliceRootItems = coerceToArray(sliceRootValue);
  if (sliceRootItems.length === 0) return [];

  const scopedRootItems = scopeItemsToSlice(sliceRootItems, context.sliceElement, structureDef);
  if (scopedRootItems === null) return null;

  return resolveRelativeParentItems(
    scopedRootItems,
    context.sliceElement.path,
    elementDef.path!,
  );
}

export function scopeParentItemsToNestedSlice(
  parentItems: unknown[],
  elementDef: ElementDef,
  structureDef: StructureDefinition,
): unknown[] | null {
  const context = findNestedSliceContext(elementDef, structureDef);
  if (!context) return null;

  return scopeItemsToSlice(parentItems, context.sliceElement, structureDef)
    ?? scopeItemsToNestedChildPatterns(parentItems, elementDef, structureDef);
}

function isSlicingNestedUnderSlice(elementDef: ElementDef): boolean {
  const id = elementDef.id;
  if (!id || !elementDef.path) return false;
  const segments = id.split('.');
  const pathDepth = elementDef.path.split('.').length;
  return segments.length >= pathDepth && segments.slice(0, -1).some(segment => segment.includes(':'));
}

function findNestedSliceContext(
  elementDef: ElementDef,
  structureDef: StructureDefinition,
): { sliceElement: ElementDefinition } | null {
  const id = elementDef.id;
  if (!id || !elementDef.path || !isSlicingNestedUnderSlice(elementDef)) return null;

  const idParts = id.split('.');
  for (let end = idParts.length - 1; end > 0; end -= 1) {
    const candidateId = idParts.slice(0, end).join('.');
    if (!candidateId.includes(':')) continue;

    const candidate = structureDef.snapshot?.element?.find(e => e.id === candidateId);
    if (candidate?.sliceName && candidate.path && elementDef.path.startsWith(candidate.path)) {
      return { sliceElement: candidate };
    }
  }

  return null;
}

function scopeItemsToSlice(
  parentItems: unknown[],
  parentSlice: ElementDefinition,
  structureDef: StructureDefinition,
): unknown[] | null {
  if (!parentSlice?.id || !parentSlice.sliceName || !parentSlice.path) return null;

  const parentSlicingBase = structureDef.snapshot?.element?.find(
    e => e.path === parentSlice.path && e.slicing,
  );
  if (!parentSlicingBase?.slicing?.discriminator?.length) return null;

  const predicates = parentSlicingBase.slicing.discriminator.map(discriminator =>
    buildDiscriminatorPredicate(discriminator, parentSlice, structureDef),
  );
  if (predicates.some(predicate => predicate === null)) return null;

  const matchedItems = parentItems.filter(item =>
    predicates.every(predicate => predicate !== null && predicate(item)),
  );
  return excludeAmbiguousResliceItems(
    matchedItems,
    parentSlice,
    parentSlicingBase,
    structureDef,
    buildDiscriminatorPredicate,
  );
}

function buildDiscriminatorPredicate(
  discriminator: { type?: string; path?: string },
  parentSlice: ElementDefinition,
  structureDef: StructureDefinition,
): ((item: unknown) => boolean) | null {
  const discriminatorPath = normalizeThisPath(discriminator.path ?? '');

  if (discriminator.type === 'type') {
    // Choice slices (value[x]:valueCodeableConcept) are told apart by the
    // slice's declared type; without this, every sibling-typed value leaks
    // into the slice scope and its nested minimums misfire.
    const typeCodes = discriminatorPath === ''
      ? (parentSlice.type ?? [])
        .map(typeSpec => typeSpec.code)
        .filter((code): code is string => typeof code === 'string' && code.length > 0)
      // A pathed type discriminator (e.g. Bundle.entry sliced on `resource`)
      // reads its type constraint from the slice's child element.
      : findDiscriminatorConstraints(parentSlice, discriminatorPath, structureDef)
        .flatMap(constraintElement => constraintElement.type ?? [])
        .map(typeSpec => typeSpec.code)
        .filter((code): code is string => typeof code === 'string' && code.length > 0);
    if (typeCodes.length === 0) return null;
    return item => coerceToArray(getPathValue(item, discriminatorPath)).some(discriminatorValue =>
      typeCodes.some(code => typeCodeMatchesValue(code, inferType(discriminatorValue), discriminatorValue)),
    );
  }

  if (discriminator.type !== 'value' && discriminator.type !== 'pattern') return null;

  if (hasFunctionPathSegments(discriminatorPath)) {
    return buildFunctionPathPredicate(discriminator.type, discriminatorPath, parentSlice, structureDef);
  }

  const constraintElements = findDiscriminatorConstraints(
    parentSlice,
    discriminatorPath,
    structureDef,
  );
  // A discriminator path crossing a resliced repeat yields one constraint per
  // sub-slice; any of them identifies membership in the parent slice.
  const expectedValues = (constraintElements.length > 0 ? constraintElements : [parentSlice])
    .map(constraintElement => discriminator.type === 'pattern'
      ? extractPattern(constraintElement) ?? extractFixed(constraintElement)
      : extractFixed(constraintElement) ?? extractPattern(constraintElement))
    .filter(expected => expected !== undefined);
  if (expectedValues.length === 0) {
    const inferredUrl = inferExtensionUrlFromSliceType(parentSlice, discriminatorPath);
    if (inferredUrl === undefined) return null;
    expectedValues.push(inferredUrl);
  }
  return item => expectedValues.some(expected => valueContainsPattern(
    getPathValue(item, discriminatorPath),
    expected,
    new WeakMap<object, WeakSet<object>>(),
  ));
}

function findDiscriminatorConstraints(
  parentSlice: ElementDefinition,
  discriminatorPath: string,
  structureDef: StructureDefinition,
): ElementDefinition[] {
  const expectedId = `${parentSlice.id}.${discriminatorPath}`;
  const normalizedExpectedId = stripSliceLabels(expectedId);
  return (structureDef.snapshot?.element ?? []).filter(element => {
    if (typeof element.id !== 'string' || !element.id.startsWith(`${parentSlice.id}.`)) return false;
    return stripSliceLabels(element.id) === normalizedExpectedId;
  });
}

function stripSliceLabels(path: string): string {
  return path
    .split('.')
    .map(segment => segment.split(':')[0])
    .join('.');
}

function resolveRelativeParentItems(
  rootItems: unknown[],
  rootPath: string,
  slicedPath: string,
): unknown[] {
  const rootParts = rootPath.split('.');
  const slicedParts = slicedPath.split('.');
  const relativeParentParts = slicedParts.slice(rootParts.length, -1);
  if (relativeParentParts.length === 0) return rootItems;

  let currentItems = rootItems;
  for (const part of relativeParentParts) {
    const nextItems: unknown[] = [];
    for (const item of currentItems) {
      const next = getTraversalSegmentValue(item, part, true);
      if (Array.isArray(next)) {
        nextItems.push(...next.filter(value => value !== undefined && value !== null));
      } else if (next !== undefined && next !== null) {
        nextItems.push(next);
      }
    }
    currentItems = nextItems;
    if (currentItems.length === 0) return [];
  }

  return currentItems;
}

function scopeItemsToNestedChildPatterns(
  parentItems: unknown[],
  elementDef: ElementDef,
  structureDef: StructureDefinition,
): unknown[] | null {
  if (!elementDef.id || !elementDef.path) return null;

  const leafKey = elementDef.path.split('.').pop();
  if (!leafKey) return null;

  const childPatterns = (structureDef.snapshot?.element ?? [])
    .filter(element =>
      element.path === elementDef.path &&
      Boolean(element.sliceName) &&
      typeof element.id === 'string' &&
      element.id.startsWith(`${elementDef.id}:`)
    )
    .map(element => extractPattern(element) ?? extractFixed(element))
    .filter(pattern => pattern !== undefined);
  if (childPatterns.length === 0) return null;

  const scoped = parentItems.filter(parentItem => {
    const childValues = coerceToArray(getPathValue(parentItem, leafKey));
    return childValues.some(childValue =>
      childPatterns.some(pattern => valueContainsPattern(
        childValue,
        pattern,
        new WeakMap<object, WeakSet<object>>(),
      )),
    );
  });

  return scoped.length > 0 ? scoped : null;
}

function normalizeThisPath(path: string): string {
  if (!path || path === '$this') return '';
  return path.startsWith('$this.') ? path.slice('$this.'.length) : path;
}

function getPathValue(value: unknown, path: string): unknown {
  if (!path || path === '$this') return value;
  return resolvePathParts(value, path.split('.'), 0, new WeakSet<object>());
}

function resolvePathParts(
  current: unknown,
  parts: string[],
  index: number,
  visitedArrays: WeakSet<object>,
): unknown {
  if (current == null) return undefined;
  if (index >= parts.length) return current;
  if (Array.isArray(current)) {
    if (visitedArrays.has(current)) return undefined;
    visitedArrays.add(current);
    const resolvedValues: unknown[] = [];
    for (const item of current) {
      const resolved = resolvePathParts(item, parts, index, visitedArrays);
      if (Array.isArray(resolved)) {
        resolvedValues.push(...resolved);
      } else if (resolved !== undefined) {
        resolvedValues.push(resolved);
      }
    }
    visitedArrays.delete(current);
    if (resolvedValues.length === 0) return undefined;
    return resolvedValues.length === 1 ? resolvedValues[0] : resolvedValues;
  }
  return resolvePathParts(
    resolveFhirSegmentValue(current, parts[index]),
    parts,
    index + 1,
    visitedArrays,
  );
}

function getTraversalSegmentValue(
  value: unknown,
  segment: string,
  hasRemainingPath: boolean,
): unknown {
  if (value == null) return undefined;
  if (
    hasRemainingPath &&
    isObjectRecord(value) &&
    isPrimitiveValueOrPrimitiveArray(value[segment])
  ) {
    const sidecar = getPrimitiveSidecar(value, segment);
    if (sidecar !== undefined) return sidecar;
  }
  return resolveFhirSegmentValue(value, segment);
}

function inferExtensionUrlFromSliceType(
  parentSlice: ElementDefinition,
  discriminatorPath: string,
): string | undefined {
  if (discriminatorPath !== 'url') return undefined;
  const extensionType = parentSlice.type?.find(typeSpec =>
    typeSpec.code === 'Extension' &&
    Array.isArray(typeSpec.profile) &&
    typeSpec.profile.length > 0,
  );
  return extensionType?.profile?.[0]?.split('|')[0];
}

function isPrimitiveValue(value: unknown): boolean {
  return value === null ||
    ['string', 'number', 'boolean'].includes(typeof value);
}

function isPrimitiveValueOrPrimitiveArray(value: unknown): boolean {
  return Array.isArray(value)
    ? value.every(isPrimitiveValue)
    : isPrimitiveValue(value);
}

function coerceToArray(val: unknown): unknown[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
