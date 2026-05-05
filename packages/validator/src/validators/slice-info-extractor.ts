/**
 * Slice Info Extractor
 *
 * Extracted from SlicingValidator. Builds SliceDefinition[] from a
 * StructureDefinition by scanning for slicing declarations and
 * collecting child patterns, fixed values, type constraints, and
 * binding codes.
 */

import type { StructureDefinition, ElementDefinition, SlicingDefinition } from '../core/structure-definition-types';
import type { SliceDefinition } from './slice-types';
import { extractPatternFromElement, extractFixedFromElement } from './slice-utils';
import { logger } from '../logger';

export type TypeProfileResolverFn = ((url: string) => Promise<StructureDefinition | null>) | null;

export interface ValueSetLoaderLike {
  loadValueSet(url: string): Promise<string[] | null>;
}

async function mergeTypeProfilePatterns(
  element: ElementDefinition,
  childPatterns: Map<string, any>,
  childFixed: Map<string, any>,
  resolver: TypeProfileResolverFn,
): Promise<void> {
  if (!resolver || !element.type) return;

  for (const typeSpec of element.type) {
    if (!typeSpec.profile || typeSpec.profile.length === 0) continue;
    for (const profileUrl of typeSpec.profile) {
      try {
        const typeSd = await resolver(profileUrl);
        if (!typeSd) continue;
        const typeElements = typeSd.snapshot?.element || typeSd.differential?.element || [];
        const typeRoot = typeSd.type || '';
        for (const typeEl of typeElements) {
          if (!typeEl.path.startsWith(typeRoot + '.')) continue;
          const relativePath = typeEl.path.substring(typeRoot.length + 1);
          if (!childPatterns.has(relativePath)) {
            const tp = extractPatternFromElement(typeEl);
            if (tp !== undefined) childPatterns.set(relativePath, tp);
          }
          if (!childFixed.has(relativePath)) {
            const tf = extractFixedFromElement(typeEl);
            if (tf !== undefined) childFixed.set(relativePath, tf);
          }
        }
      } catch (err) {
        logger.debug(`[SlicingValidator] Failed to resolve type profile ${profileUrl}: ${err}`);
      }
    }
  }
}

export async function extractSlicingInfo(
  elementPath: string,
  profileSD: StructureDefinition,
  typeProfileResolver: TypeProfileResolverFn,
  valueSetLoader: ValueSetLoaderLike | null,
): Promise<{ slicing: SlicingDefinition; slices: SliceDefinition[] } | null> {
  const elements = profileSD.snapshot?.element || profileSD.differential?.element || [];

  const baseElement = elements.find(e => e.path === elementPath && e.slicing);
  if (!baseElement || !baseElement.slicing) return null;

  const slicingDef: SlicingDefinition = baseElement.slicing;
  const slices: SliceDefinition[] = [];

  for (const element of elements) {
    if (element.path !== elementPath || !element.sliceName) continue;

    const sliceDef: SliceDefinition = {
      sliceName: element.sliceName,
      path: element.path,
      min: element.min !== undefined ? element.min : 0,
      max: element.max || '*',
      discriminator: slicingDef.discriminator,
      type: element.type,
    };

    const rootPattern = extractPatternFromElement(element);
    if (rootPattern !== undefined) sliceDef.pattern = rootPattern;

    const rootFixed = extractFixedFromElement(element);
    if (rootFixed !== undefined) sliceDef.fixed = rootFixed;

    const slicePrefix = element.id
      ? `${element.id}.`
      : `${elementPath}:${element.sliceName}.`;
    const childPatterns = new Map<string, any>();
    const childFixed = new Map<string, any>();
    const childTypes = new Map<string, Array<{ code: string; profile?: string[] }>>();

    for (const candidate of elements) {
      if (typeof candidate.id !== 'string') continue;
      if (!candidate.id.startsWith(slicePrefix)) continue;

      const relativePath = candidate.id.substring(slicePrefix.length);
      const childPattern = extractPatternFromElement(candidate);
      if (childPattern !== undefined) childPatterns.set(relativePath, childPattern);
      const childFixedValue = extractFixedFromElement(candidate);
      if (childFixedValue !== undefined) childFixed.set(relativePath, childFixedValue);
      if (candidate.type && candidate.type.length > 0) {
        childTypes.set(relativePath, candidate.type);
      }
    }

    await mergeTypeProfilePatterns(element, childPatterns, childFixed, typeProfileResolver);

    if (childPatterns.size > 0) sliceDef.childPatterns = childPatterns;
    if (childFixed.size > 0) sliceDef.childFixed = childFixed;
    if (childTypes.size > 0) sliceDef.childTypes = childTypes;

    if (!sliceDef.pattern && !sliceDef.fixed) {
      const binding = element.binding;
      if (binding?.valueSet && valueSetLoader) {
        try {
          const codes = await valueSetLoader.loadValueSet(binding.valueSet);
          if (codes && codes.length > 0) {
            sliceDef.bindingCodes = new Set(codes);
            logger.debug(`[SlicingValidator] Loaded ${codes.length} binding codes for slice ${element.sliceName}`);
          }
        } catch {
          logger.debug(`[SlicingValidator] Failed to load binding ValueSet for slice ${element.sliceName}`);
        }
      }
    }

    slices.push(sliceDef);
  }

  logger.debug(`[SlicingValidator] Found ${slices.length} slices for ${elementPath}`);
  return { slicing: slicingDef, slices };
}
