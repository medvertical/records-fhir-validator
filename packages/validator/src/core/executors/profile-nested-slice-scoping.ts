import type { StructureDefinition } from '../structure-definition-types';

type ElementDef = { id?: string; path?: string };

export function resolveNestedSliceParentItems(
  resource: any,
  elementDef: ElementDef,
  structureDef: StructureDefinition,
  getValueAtPath: (resource: any, path: string) => any,
): any[] | null {
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
  parentItems: any[],
  elementDef: ElementDef,
  structureDef: StructureDefinition,
): any[] | null {
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
): { sliceElement: any } | null {
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
  parentItems: any[],
  parentSlice: any,
  structureDef: StructureDefinition,
): any[] | null {
  if (!parentSlice?.id || !parentSlice.sliceName || !parentSlice.path) return null;

  const parentSlicingBase = structureDef.snapshot?.element?.find(
    e => e.path === parentSlice.path && e.slicing,
  );
  if (!parentSlicingBase?.slicing?.discriminator?.length) return null;

  const discriminator = parentSlicingBase.slicing.discriminator[0];
  if (discriminator.type !== 'value' && discriminator.type !== 'pattern') return null;

  const discriminatorPath = normalizeThisPath(discriminator.path);
  const discriminatorConstraint = structureDef.snapshot?.element?.find(
    e => e.id === `${parentSlice.id}.${discriminatorPath}`,
  );
  const constraintElement = discriminatorConstraint ?? parentSlice;
  const expected = discriminator.type === 'pattern'
    ? extractPattern(constraintElement) ?? extractFixed(constraintElement)
    : extractFixed(constraintElement) ?? extractPattern(constraintElement);
  if (expected === undefined) return null;

  return parentItems.filter(item => valueContainsPattern(
    getPathValue(item, discriminatorPath),
    expected,
  ));
}

function resolveRelativeParentItems(
  rootItems: any[],
  rootPath: string,
  slicedPath: string,
): any[] {
  const rootParts = rootPath.split('.');
  const slicedParts = slicedPath.split('.');
  const relativeParentParts = slicedParts.slice(rootParts.length, -1);
  if (relativeParentParts.length === 0) return rootItems;

  let currentItems = rootItems;
  for (const part of relativeParentParts) {
    const nextItems: any[] = [];
    for (const item of currentItems) {
      const next = getPathValue(item, part);
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
  parentItems: any[],
  elementDef: ElementDef,
  structureDef: StructureDefinition,
): any[] | null {
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
      childPatterns.some(pattern => valueContainsPattern(childValue, pattern)),
    );
  });

  return scoped.length > 0 ? scoped : null;
}

function normalizeThisPath(path: string): string {
  if (!path || path === '$this') return '';
  return path.startsWith('$this.') ? path.slice('$this.'.length) : path;
}

function extractPattern(elementDef: any): any {
  for (const [key, value] of Object.entries(elementDef)) {
    if (key.startsWith('pattern')) return value;
  }
  return undefined;
}

function extractFixed(elementDef: any): any {
  for (const [key, value] of Object.entries(elementDef)) {
    if (key.startsWith('fixed')) return value;
  }
  return undefined;
}

function getPathValue(value: any, path: string): any {
  if (!path || path === '$this') return value;
  return path.split('.').reduce((current, segment) => {
    if (current == null) return undefined;
    return current[segment];
  }, value);
}

function valueContainsPattern(actual: any, expected: any): boolean {
  if (expected === undefined || expected === null) return true;
  if (actual === undefined || actual === null) return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every(expectedItem =>
      actual.some(actualItem => valueContainsPattern(actualItem, expectedItem)),
    );
  }
  if (typeof expected === 'object') {
    if (typeof actual !== 'object') return false;
    return Object.entries(expected).every(([key, expectedValue]) =>
      valueContainsPattern(actual[key], expectedValue),
    );
  }
  return actual === expected;
}

function coerceToArray(val: any): any[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}
