/**
 * Slice Info Extractor
 *
 * Extracted from SlicingValidator. Builds SliceDefinition[] from a
 * StructureDefinition by scanning for slicing declarations and
 * collecting child patterns, fixed values, type constraints, and
 * binding codes.
 */

import type { StructureDefinition, ElementDefinition, SlicingDefinition } from '../core/structure-definition-types.js';
import type { SliceDefinition } from './slice-types.js';
import { createSliceElementIndex } from './slice-element-index.js';
import { extractFixedFromElement, extractPatternFromElement, getValueAtPath } from './slice-utils.js';
import { loadResolvedCodeDiscriminatorEvidence, type ResolvedCodeDefinitionResolver } from './slice-resolved-code-discriminator.js';
import { inferChoiceSliceType } from './slice-choice-type-inference.js';
import { logger } from '../logger.js';
import {
  sensitiveValueMetadata,
  terminologyTargetMetadata,
} from '../utils/sensitive-logging-metadata.js';
import {
  childBindingAppliesToDiscriminatorPath,
  collectChildBindingDiscriminatorPaths,
  getElementTypes,
  getNonEmptyString,
  getProfileElements,
  getSlicingDefinition,
  inferInheritedSlicing,
  isSliceInScope,
  normalizeCodes,
} from './slice-info-input.js';
import {
  applyRootSliceConstraints,
  mergeAncestorTypeProfileSliceMetadata,
  mergeChildTypeProfileConstraints,
  mergeTypeProfilePatterns,
  type TypeProfileResolverFn,
} from './slice-info-inheritance.js';

export type { TypeProfileResolverFn } from './slice-info-inheritance.js';

export interface ValueSetLoaderLike {
  loadValueSet(url: string): Promise<string[] | null>;
}

export async function extractSlicingInfo(
  elementPath: string,
  profileSD: StructureDefinition,
  typeProfileResolver: TypeProfileResolverFn,
  valueSetLoader: ValueSetLoaderLike | null,
  slicingElementId?: string,
  resolveOwnedCodeDefinition?: ResolvedCodeDefinitionResolver,
): Promise<{ slicing: SlicingDefinition; slices: SliceDefinition[]; selectedSlicingElementId?: string } | null> {
  const elements = getProfileElements(profileSD);
  const pathElements = elements.filter(element => element.path === elementPath);
  const baseElement = slicingElementId
    ? pathElements.find(
      element => element.id === slicingElementId && getSlicingDefinition(element),
    )
    : pathElements.find(
      element => getSlicingDefinition(element),
    );
  const candidateSliceElements = pathElements.filter(element =>
    typeof element.sliceName === 'string' && element.sliceName.length > 0
      && isSliceInScope(element, slicingElementId),
  );
  if ((!baseElement || !baseElement.slicing) && candidateSliceElements.length === 0) return null;

  const slicingDef = getSlicingDefinition(baseElement) ?? inferInheritedSlicing(candidateSliceElements);
  const childBindingDiscriminatorPaths = collectChildBindingDiscriminatorPaths(slicingDef);
  const slices: SliceDefinition[] = [];
  const sliceScopeId = slicingElementId ?? getNonEmptyString(baseElement?.id);
  const elementIndex = createSliceElementIndex(elements,
    candidateSliceElements.filter(element => isSliceInScope(element, sliceScopeId)));
  const constraintIdsIndexable = elementIndex
    && elements.every(element => element.id == null || typeof element.id === 'string');
  const seenSliceIds = new Set<string>();

  for (const element of pathElements) {
    if (typeof element.sliceName !== 'string' || element.sliceName.length === 0
      || !isSliceInScope(element, sliceScopeId)) continue;
    const sliceIdentity = getNonEmptyString(element.id) ?? `${element.path}:${element.sliceName}`;
    if (seenSliceIds.has(sliceIdentity)) continue;
    seenSliceIds.add(sliceIdentity);

    const sliceDef: SliceDefinition = {
      sliceName: element.sliceName,
      path: element.path,
      min: typeof element.min === 'number' && Number.isFinite(element.min) ? element.min : 0,
      max: getNonEmptyString(element.max) ?? '*',
      discriminator: slicingDef.discriminator,
      type: getElementTypes(element),
    };
    applyRootSliceConstraints(sliceDef, element, constraintIdsIndexable
      ? elementIndex.descendants(`${element.id ?? `${elementPath}:${element.sliceName}`}.`) : elements);

    const slicePrefix = element.id ? `${element.id}.` : `${elementPath}:${element.sliceName}.`;
    const childPatterns = new Map<string, unknown>();
    const childFixed = new Map<string, unknown>();
    const childMin = new Map<string, number>();
    const childMax = new Map<string, number>();
    const childTypes = new Map<string, Array<{ code: string; profile?: string[]; targetProfile?: string[] }>>();
    const childBindingValueSets = new Map<string, string>();

    for (const candidate of elementIndex?.descendants(slicePrefix) ?? elements) {
      if (typeof candidate.id !== 'string') continue;
      if (!candidate.id.startsWith(slicePrefix)) continue;
      const relativePath = candidate.id.substring(slicePrefix.length);
      const childPattern = extractPatternFromElement(candidate);
      if (childPattern !== undefined) childPatterns.set(relativePath, childPattern);
      const childFixedValue = extractFixedFromElement(candidate);
      if (childFixedValue !== undefined) childFixed.set(relativePath, childFixedValue);
      recordChildCardinality(candidate, relativePath, childMin, childMax);
      const candidateTypes = getElementTypes(candidate);
      if (candidateTypes.length > 0) {
        childTypes.set(relativePath, candidateTypes);
      }
      const bindingValueSet = discriminatingBindingValueSet(candidate);
      if (bindingValueSet && childBindingAppliesToDiscriminatorPath(relativePath, childBindingDiscriminatorPaths)) {
        childBindingValueSets.set(relativePath, bindingValueSet);
      }
    }

    await mergeProfiledTypeMetadata({ element, childTypes, childPatterns, childFixed, childMin, childBindingValueSets, typeProfileResolver });
    await mergeAncestorTypeProfileSliceMetadata({
      element, elements: elementIndex?.ancestors(element.id) ?? elements, elementPath, sliceDef,
      childPatterns, childFixed, childMin, childTypes,
      resolver: typeProfileResolver,
    });
    inferChoiceSliceType(sliceDef, elementPath);

    const childBindingCodes = await loadChildBindingCodes(
      childBindingValueSets, childBindingDiscriminatorPaths, valueSetLoader, element.sliceName,
    );

    if (childPatterns.size > 0) sliceDef.childPatterns = childPatterns;
    if (childFixed.size > 0) sliceDef.childFixed = childFixed;
    if (childMin.size > 0) sliceDef.childMin = childMin;
    if (childMax.size > 0) sliceDef.childMax = childMax;
    if (childTypes.size > 0) sliceDef.childTypes = childTypes;
    if (childBindingValueSets.size > 0) sliceDef.childBindingValueSets = childBindingValueSets;
    if (childBindingCodes.size > 0) sliceDef.childBindingCodes = childBindingCodes;

    await mergeRootBindingCodes(sliceDef, element, valueSetLoader);
    await loadResolvedCodeDiscriminatorEvidence(sliceDef, typeProfileResolver, element, profileSD, resolveOwnedCodeDefinition);
    if (lacksDiscriminatingValue(profileSD, sliceDef, element)) sliceDef.undiscriminated = true;
    slices.push(sliceDef);
  }

  logSliceExtraction(slices.length, elementPath);
  return { slicing: slicingDef, slices,
    ...(baseElement?.slicing && getNonEmptyString(baseElement.id)
      ? { selectedSlicingElementId: baseElement.id } : {}) };
}

async function loadChildBindingCodes(
  bindings: Map<string, string>,
  discriminatorPaths: Set<string>,
  loader: ValueSetLoaderLike | null,
  sliceName: string,
): Promise<Map<string, Set<string>>> {
  const resolved = new Map<string, Set<string>>();
  if (!loader) return resolved;
  for (const [relativePath, valueSet] of bindings) {
    if (!childBindingAppliesToDiscriminatorPath(relativePath, discriminatorPaths)) continue;
    try {
      const codes = normalizeCodes(await loader.loadValueSet(valueSet));
      if (codes.length > 0) {
        resolved.set(relativePath, new Set(codes));
        logChildBindingLoaded(codes.length, sliceName, relativePath);
      }
    } catch {
      logChildBindingLoadFailed(sliceName, relativePath, valueSet);
    }
  }
  return resolved;
}

async function mergeProfiledTypeMetadata(input: {
  element: ElementDefinition;
  childTypes: Map<string, Array<{ code: string; profile?: string[]; targetProfile?: string[] }>>;
  childPatterns: Map<string, unknown>;
  childFixed: Map<string, unknown>;
  childMin: Map<string, number>;
  childBindingValueSets: Map<string, string>;
  typeProfileResolver: TypeProfileResolverFn;
}): Promise<void> {
  const { element, childTypes, childPatterns, childFixed, childMin, childBindingValueSets, typeProfileResolver } = input;
  await mergeTypeProfilePatterns(element, childPatterns, childFixed, childMin, typeProfileResolver, childBindingValueSets);
  await mergeChildTypeProfileConstraints(
    childTypes, childPatterns, childFixed, typeProfileResolver,
  );
}

/**
 * Only a required binding can stand in for a pattern discriminator, as in the
 * reference validator: a code outside an extensible binding is still allowed,
 * so such a binding cannot tell slices apart. A slice without a pattern, a
 * fixed value or a required binding matches nothing.
 */
function discriminatingBindingValueSet(element: ElementDefinition): string | undefined {
  return element.binding?.strength === 'required' ? element.binding.valueSet : undefined;
}

/** Only a snapshot is conclusive: a differential inherits discriminator values. */
function lacksDiscriminatingValue(
  profileSD: StructureDefinition,
  sliceDef: SliceDefinition,
  element: ElementDefinition,
): boolean {
  const discriminators = sliceDef.discriminator ?? [];
  return (profileSD.snapshot?.element?.length ?? 0) > 0
    && discriminators.length > 0
    && discriminators.every(discriminator =>
      (discriminator.type === 'pattern' || discriminator.type === 'value')
      && (!discriminator.path || discriminator.path === '$this' || /^[A-Za-z]\w*$/.test(discriminator.path)))
    && discriminators.some(({ path }) => {
      if (!path || path === '$this') return sliceDef.pattern === undefined
        && sliceDef.fixed === undefined && !discriminatingBindingValueSet(element);
      const child = profileSD.snapshot?.element?.find(candidate => candidate.id === `${element.id}.${path}`);
      // An omitted child may still inherit its assertion from an unresolved datatype profile.
      if (!child || [element, child].some(candidate => getElementTypes(candidate).some(type => type.profile?.length))) return false;
      return !sliceDef.childFixed?.has(path) && !sliceDef.childPatterns?.has(path)
        && !sliceDef.childBindingValueSets?.has(path)
        && getValueAtPath(sliceDef.fixed, path) === null
        && getValueAtPath(sliceDef.pattern, path) === null;
    });
}

async function mergeRootBindingCodes(
  sliceDef: SliceDefinition,
  element: ElementDefinition,
  valueSetLoader: ValueSetLoaderLike | null,
): Promise<void> {
  const bindingValueSet = discriminatingBindingValueSet(element);
  if (
    sliceDef.pattern !== undefined
    || sliceDef.fixed !== undefined
    || !bindingValueSet
    || !valueSetLoader
  ) return;

  sliceDef.bindingValueSet = bindingValueSet;
  try {
    const codes = normalizeCodes(
      await valueSetLoader.loadValueSet(bindingValueSet),
    );
    if (codes.length > 0) {
      sliceDef.bindingCodes = new Set(codes);
      logRootBindingLoaded(codes.length, element.sliceName);
    }
  } catch {
    logRootBindingLoadFailed(element.sliceName, bindingValueSet);
  }
}

function logChildBindingLoaded(codeCount: number, sliceName?: string, relativePath?: string): void {
  logger.debug('[SlicingValidator] Loaded child binding codes', {
    codeCount,
    ...sensitiveValueMetadata(sliceName, relativePath),
  });
}

function logChildBindingLoadFailed(
  sliceName: string | undefined,
  relativePath: string,
  valueSet: string,
): void {
  logger.debug('[SlicingValidator] Failed to load child binding ValueSet', {
    ...sensitiveValueMetadata(sliceName, relativePath),
    ...terminologyTargetMetadata(valueSet),
  });
}

function logSliceExtraction(sliceCount: number, elementPath: string): void {
  logger.debug('[SlicingValidator] Slice extraction complete', {
    sliceCount,
    ...sensitiveValueMetadata(elementPath),
  });
}

function logRootBindingLoaded(codeCount: number, sliceName?: string): void {
  logger.debug('[SlicingValidator] Loaded root binding codes', {
    codeCount,
    ...sensitiveValueMetadata(sliceName),
  });
}

function logRootBindingLoadFailed(sliceName: string | undefined, valueSet: string): void {
  logger.debug('[SlicingValidator] Failed to load root binding ValueSet', {
    ...sensitiveValueMetadata(sliceName),
    ...terminologyTargetMetadata(valueSet),
  });
}

function recordChildCardinality(
  candidate: ElementDefinition, relativePath: string,
  childMin: Map<string, number>, childMax: Map<string, number>,
): void {
  if ((candidate.min ?? 0) > 0) childMin.set(relativePath, candidate.min!);
  const maximum = candidate.max === undefined || candidate.max === '*' ? NaN : Number(candidate.max);
  if (Number.isInteger(maximum)) childMax.set(relativePath, maximum);
}
