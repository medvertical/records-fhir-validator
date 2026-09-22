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
import {
  extractFixedFromElement,
  extractPatternFromElement,
} from './slice-utils.js';
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
): Promise<{ slicing: SlicingDefinition; slices: SliceDefinition[] } | null> {
  const elements = getProfileElements(profileSD);

  const baseElement = slicingElementId
    ? elements.find(element =>
        element.id === slicingElementId
        && element.path === elementPath
        && getSlicingDefinition(element)
      )
    : elements.find(element =>
        element.path === elementPath && getSlicingDefinition(element)
      );
  const candidateSliceElements = elements.filter(element =>
    element.path === elementPath &&
    typeof element.sliceName === 'string' &&
    element.sliceName.length > 0 &&
    isSliceInScope(element, slicingElementId)
  );
  if ((!baseElement || !baseElement.slicing) && candidateSliceElements.length === 0) return null;

  const slicingDef = getSlicingDefinition(baseElement)
    ?? inferInheritedSlicing(candidateSliceElements);
  const childBindingDiscriminatorPaths = collectChildBindingDiscriminatorPaths(slicingDef);
  const slices: SliceDefinition[] = [];
  const sliceScopeId = slicingElementId ?? getNonEmptyString(baseElement?.id);
  const seenSliceIds = new Set<string>();

  for (const element of elements) {
    if (
      element.path !== elementPath
      || typeof element.sliceName !== 'string'
      || element.sliceName.length === 0
      || !isSliceInScope(element, sliceScopeId)
    ) continue;
    const sliceIdentity = getNonEmptyString(element.id)
      ?? `${element.path}:${element.sliceName}`;
    if (seenSliceIds.has(sliceIdentity)) continue;
    seenSliceIds.add(sliceIdentity);

    const sliceDef: SliceDefinition = {
      sliceName: element.sliceName,
      path: element.path,
      min: typeof element.min === 'number' && Number.isFinite(element.min)
        ? element.min
        : 0,
      max: getNonEmptyString(element.max) ?? '*',
      discriminator: slicingDef.discriminator,
      type: getElementTypes(element),
    };

    applyRootSliceConstraints(sliceDef, element);

    const slicePrefix = element.id
      ? `${element.id}.`
      : `${elementPath}:${element.sliceName}.`;
    const childPatterns = new Map<string, unknown>();
    const childFixed = new Map<string, unknown>();
    const childMin = new Map<string, number>();
    const childTypes = new Map<string, Array<{ code: string; profile?: string[]; targetProfile?: string[] }>>();
    const childBindingValueSets = new Map<string, string>();
    const childBindingCodes = new Map<string, Set<string>>();

    for (const candidate of elements) {
      if (typeof candidate.id !== 'string') continue;
      if (!candidate.id.startsWith(slicePrefix)) continue;

      const relativePath = candidate.id.substring(slicePrefix.length);
      const childPattern = extractPatternFromElement(candidate);
      if (childPattern !== undefined) childPatterns.set(relativePath, childPattern);
      const childFixedValue = extractFixedFromElement(candidate);
      if (childFixedValue !== undefined) childFixed.set(relativePath, childFixedValue);
      if ((candidate.min ?? 0) > 0) {
        childMin.set(relativePath, candidate.min!);
      }
      const candidateTypes = getElementTypes(candidate);
      if (candidateTypes.length > 0) {
        childTypes.set(relativePath, candidateTypes);
      }
      const bindingValueSet = candidate.binding?.valueSet;
      if (
        bindingValueSet &&
        valueSetLoader &&
        childBindingAppliesToDiscriminatorPath(relativePath, childBindingDiscriminatorPaths)
      ) {
        childBindingValueSets.set(relativePath, bindingValueSet);
        try {
          const codes = normalizeCodes(await valueSetLoader.loadValueSet(bindingValueSet));
          if (codes.length > 0) {
            childBindingCodes.set(relativePath, new Set(codes));
            logChildBindingLoaded(codes.length, element.sliceName, relativePath);
          }
        } catch {
          logChildBindingLoadFailed(element.sliceName, relativePath, bindingValueSet);
        }
      }
    }

    await mergeProfiledTypeMetadata({ element, childTypes, childPatterns, childFixed, childMin, typeProfileResolver });
    await mergeAncestorTypeProfileSliceMetadata({
      element,
      elements,
      elementPath,
      sliceDef,
      childPatterns,
      childFixed,
      childMin,
      childTypes,
      resolver: typeProfileResolver,
    });
    inferChoiceSliceType(sliceDef, elementPath);

    if (childPatterns.size > 0) sliceDef.childPatterns = childPatterns;
    if (childFixed.size > 0) sliceDef.childFixed = childFixed;
    if (childMin.size > 0) sliceDef.childMin = childMin;
    if (childTypes.size > 0) sliceDef.childTypes = childTypes;
    if (childBindingValueSets.size > 0) sliceDef.childBindingValueSets = childBindingValueSets;
    if (childBindingCodes.size > 0) sliceDef.childBindingCodes = childBindingCodes;

    await mergeRootBindingCodes(sliceDef, element, valueSetLoader);

    slices.push(sliceDef);
  }

  logSliceExtraction(slices.length, elementPath);
  return { slicing: slicingDef, slices };
}

async function mergeProfiledTypeMetadata(input: {
  element: ElementDefinition;
  childTypes: Map<string, Array<{ code: string; profile?: string[]; targetProfile?: string[] }>>;
  childPatterns: Map<string, unknown>;
  childFixed: Map<string, unknown>;
  childMin: Map<string, number>;
  typeProfileResolver: TypeProfileResolverFn;
}): Promise<void> {
  const { element, childTypes, childPatterns, childFixed, childMin, typeProfileResolver } = input;
  await mergeTypeProfilePatterns(element, childPatterns, childFixed, childMin, typeProfileResolver);
  await mergeChildTypeProfileConstraints(
    childTypes, childPatterns, childFixed, typeProfileResolver,
  );
}

async function mergeRootBindingCodes(
  sliceDef: SliceDefinition,
  element: ElementDefinition,
  valueSetLoader: ValueSetLoaderLike | null,
): Promise<void> {
  if (
    sliceDef.pattern !== undefined
    || sliceDef.fixed !== undefined
    || !element.binding?.valueSet
    || !valueSetLoader
  ) return;

  sliceDef.bindingValueSet = element.binding.valueSet;
  try {
    const codes = normalizeCodes(
      await valueSetLoader.loadValueSet(element.binding.valueSet),
    );
    if (codes.length > 0) {
      sliceDef.bindingCodes = new Set(codes);
      logRootBindingLoaded(codes.length, element.sliceName);
    }
  } catch {
    logRootBindingLoadFailed(element.sliceName, element.binding.valueSet);
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
