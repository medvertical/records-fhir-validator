import type { ElementDefinition, StructureDefinition } from '../core/structure-definition-types.js';
import { logger } from '../logger.js';
import type { SliceDefinition } from './slice-types.js';
import {
  extractFixedEntry,
  extractFixedFromElement,
  extractPatternEntry,
  extractPatternFromElement,
} from './slice-utils.js';
import {
  getElementTypes,
  getNonEmptyString,
  getProfileElements,
  type TypeSpec,
} from './slice-info-input.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import {
  asRecord,
  collectReferencedSliceChildren,
  differentialElements,
  profileElementReference,
} from './slice-profile-element-reference.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';

export type TypeProfileResolverFn = ((url: string) => Promise<StructureDefinition | null>) | null;


export async function mergeTypeProfilePatterns(
  element: ElementDefinition,
  childPatterns: Map<string, unknown>,
  childFixed: Map<string, unknown>,
  childMin: Map<string, number>,
  resolver: TypeProfileResolverFn,
): Promise<void> {
  if (!resolver) return;
  // Read the raw type entries rather than getElementTypes(), which drops the
  // `_profile` primitive extensions this needs.
  const rawTypes = Array.isArray(element.type) ? element.type : [];
  for (const rawType of rawTypes) {
    const typeRecord = asRecord(rawType);
    // Keep getElementTypes()'s contract: an entry without a code is not a type
    // and was never merged. Only the `_profile` sidecar is read from the raw
    // entry, because getElementTypes() drops it.
    if (!getNonEmptyString(typeRecord?.code)) continue;
    const profiles = Array.isArray(typeRecord?.profile) ? typeRecord.profile : [];
    const profileSidecars = Array.isArray(typeRecord?._profile) ? typeRecord._profile : [];
    for (let index = 0; index < profiles.length; index += 1) {
      const profileUrl = getNonEmptyString(profiles[index]);
      if (!profileUrl) continue;
      const elementReference = profileElementReference(profileSidecars[index]);
      try {
        const typeDefinition = await resolver(profileUrl);
        if (!typeDefinition) continue;
        const typeRoot = getNonEmptyString(typeDefinition.type) ?? '';
        const referencedElements = elementReference
          ? collectReferencedSliceChildren(
              // A slice reference names an element as the differential authored
              // it. A generated snapshot interleaves inherited base children
              // between the slices, so walking it would collect the wrong ones.
              differentialElements(typeDefinition) ?? getProfileElements(typeDefinition),
              elementReference,
            )
          : undefined;
        if (referencedElements) {
          for (const [relativePath, typeElement] of referencedElements) {
            mergeTypeProfileChildAt(relativePath, typeElement, childPatterns, childFixed, childMin);
          }
          continue;
        }
        for (const typeElement of getProfileElements(typeDefinition)) {
          if (!typeElement.path.startsWith(`${typeRoot}.`)) continue;
          mergeTypeProfileChild(typeElement, typeRoot, childPatterns, childFixed, childMin);
        }
      } catch (error) {
        logger.debug('[SlicingValidator] Failed to resolve type profile', {
          ...profileCanonicalMetadata(profileUrl),
          ...validationFailureMetadata(error),
        });
      }
    }
  }
}

export async function mergeAncestorTypeProfileSliceMetadata(input: {
  element: ElementDefinition;
  elements: ElementDefinition[];
  elementPath: string;
  sliceDef: SliceDefinition;
  childPatterns: Map<string, unknown>;
  childFixed: Map<string, unknown>;
  childMin: Map<string, number>;
  childTypes: Map<string, TypeSpec[]>;
  resolver: TypeProfileResolverFn;
}): Promise<void> {
  const { element, elements, elementPath, resolver } = input;
  if (!resolver || !element.id || !element.sliceName) return;
  for (const ancestor of findTypedAncestorElements(elements, element.id, elementPath)) {
    const relativePath = getRelativeProfilePath(ancestor.path, elementPath);
    if (!relativePath) continue;
    for (const typeSpec of getElementTypes(ancestor)) {
      for (const profileUrl of typeSpec.profile ?? []) {
        await mergeAncestorProfile(profileUrl, relativePath, input);
      }
    }
  }
}

export function applyRootSliceConstraints(sliceDef: SliceDefinition, element: ElementDefinition): void {
  const rootPattern = extractPatternEntry(element);
  if (rootPattern !== undefined) {
    sliceDef.pattern = rootPattern.value;
    sliceDef.patternKind = rootPattern.key;
  }
  const rootFixed = extractFixedEntry(element);
  if (rootFixed !== undefined) {
    sliceDef.fixed = rootFixed.value;
    sliceDef.fixedKind = rootFixed.key;
  }
}


/**
 * Merge constraints from datatype profiles declared on a slice's children.
 *
 * A discriminator may point through a child: `identifier.system` resolves to
 * the fixed `Identifier.system` inside the profile that the child's
 * `type.profile` names. Without this the discriminator has no evidence, the
 * slice is written off as unverifiable, and nothing about it is checked.
 */
export async function mergeChildTypeProfileConstraints(
  childTypes: Map<string, TypeSpec[]>,
  childPatterns: Map<string, unknown>,
  childFixed: Map<string, unknown>,
  resolver: TypeProfileResolverFn,
): Promise<void> {
  if (!resolver) return;
  // Only discriminator evidence is merged. Cardinality from a child's datatype
  // profile does not describe the sliced element and produced spurious
  // "too few values" errors when it was carried across.
  const ignoredMin = new Map<string, number>();
  for (const [childPath, typeSpecs] of childTypes) {
    // Evidence from one of several alternative profiles would privilege that
    // alternative over the others; only an unambiguous declaration is merged.
    const profileUrls = typeSpecs.flatMap(typeSpec => typeSpec.profile ?? []);
    if (profileUrls.length !== 1) continue;
    const profileUrl = profileUrls[0];
    try {
      const typeDefinition = await resolver(profileUrl);
      if (!typeDefinition) continue;
      const typeRoot = getNonEmptyString(typeDefinition.type) ?? '';
      if (!typeRoot) continue;
      for (const typeElement of getProfileElements(typeDefinition)) {
        if (!typeElement.path.startsWith(`${typeRoot}.`)) continue;
        // The id-based relative path keeps a slice segment (`section:problems.code`),
        // which never resolves to an instance value. Walking by path instead
        // would lift a slice-scoped pattern onto the unsliced element and fail
        // every sibling slice against the first slice's pattern.
        const suffix = getTypeProfileRelativePath(typeElement, typeRoot);
        mergeTypeProfileChildAt(
          `${childPath}.${suffix}`, typeElement, childPatterns, childFixed, ignoredMin,
        );
      }
    } catch (error) {
      logger.debug('[SlicingValidator] Failed to resolve child type profile', {
        ...profileCanonicalMetadata(profileUrl),
        ...validationFailureMetadata(error),
      });
    }
  }
}


function mergeTypeProfileChild(
  element: ElementDefinition,
  typeRoot: string,
  childPatterns: Map<string, unknown>,
  childFixed: Map<string, unknown>,
  childMin: Map<string, number>,
): void {
  mergeTypeProfileChildAt(
    getTypeProfileRelativePath(element, typeRoot),
    element, childPatterns, childFixed, childMin,
  );
}

function mergeTypeProfileChildAt(
  relativePath: string,
  element: ElementDefinition,
  childPatterns: Map<string, unknown>,
  childFixed: Map<string, unknown>,
  childMin: Map<string, number>,
): void {
  if (!childPatterns.has(relativePath)) {
    const pattern = extractPatternFromElement(element);
    if (pattern !== undefined) childPatterns.set(relativePath, pattern);
  }
  if (!childFixed.has(relativePath)) {
    const fixed = extractFixedFromElement(element);
    if (fixed !== undefined) childFixed.set(relativePath, fixed);
  }
  if ((element.min ?? 0) > 0 && !childMin.has(relativePath)) childMin.set(relativePath, element.min!);
}

async function mergeAncestorProfile(
  profileUrl: string,
  relativePath: string,
  input: Parameters<typeof mergeAncestorTypeProfileSliceMetadata>[0],
): Promise<void> {
  try {
    const typeDefinition = await input.resolver?.(profileUrl);
    const typeElements = getProfileElements(typeDefinition);
    const typeRoot = getNonEmptyString(typeDefinition?.type) ?? '';
    if (!typeRoot) return;
    const inheritedElement = typeElements.find(candidate =>
      candidate.path === `${typeRoot}.${relativePath}`
      && candidate.sliceName === input.element.sliceName
    );
    if (!inheritedElement) return;
    mergeInheritedSliceElement(input.sliceDef, inheritedElement);
    mergeInheritedSliceChildren(inheritedElement, typeElements, input);
  } catch (error) {
    logger.debug('[SlicingValidator] Failed to inherit slice metadata from type profile', {
      ...profileCanonicalMetadata(profileUrl),
      ...validationFailureMetadata(error),
    });
  }
}

function findTypedAncestorElements(
  elements: ElementDefinition[],
  elementId: string,
  elementPath: string,
): ElementDefinition[] {
  return elements.filter(candidate =>
    typeof candidate.id === 'string'
    && candidate.id.length < elementId.length
    && elementId.startsWith(`${candidate.id}.`)
    && typeof candidate.path === 'string'
    && elementPath.startsWith(`${candidate.path}.`)
    && getElementTypes(candidate).some(typeSpec => (typeSpec.profile ?? []).length > 0)
  ).sort((left, right) => right.id!.length - left.id!.length);
}

function getRelativeProfilePath(ancestorPath: string | undefined, elementPath: string): string | null {
  return ancestorPath && elementPath.startsWith(`${ancestorPath}.`)
    ? elementPath.slice(ancestorPath.length + 1)
    : null;
}

function mergeInheritedSliceElement(sliceDef: SliceDefinition, inherited: ElementDefinition): void {
  if (!sliceDef.type && inherited.type) sliceDef.type = inherited.type;
  if (sliceDef.pattern === undefined) {
    const pattern = extractPatternEntry(inherited);
    if (pattern !== undefined) {
      sliceDef.pattern = pattern.value;
      sliceDef.patternKind = pattern.key;
    }
  }
  if (sliceDef.fixed === undefined) {
    const fixed = extractFixedEntry(inherited);
    if (fixed !== undefined) {
      sliceDef.fixed = fixed.value;
      sliceDef.fixedKind = fixed.key;
    }
  }
}

function mergeInheritedSliceChildren(
  inherited: ElementDefinition,
  typeElements: ElementDefinition[],
  input: Parameters<typeof mergeAncestorTypeProfileSliceMetadata>[0],
): void {
  const prefix = inherited.id ? `${inherited.id}.` : null;
  if (!prefix) return;
  for (const candidate of typeElements) {
    if (typeof candidate.id !== 'string' || !candidate.id.startsWith(prefix)) continue;
    const relativePath = candidate.id.slice(prefix.length);
    mergeInheritedChild(relativePath, candidate, input);
  }
}

function mergeInheritedChild(
  relativePath: string,
  candidate: ElementDefinition,
  input: Parameters<typeof mergeAncestorTypeProfileSliceMetadata>[0],
): void {
  if (!input.childPatterns.has(relativePath)) {
    const pattern = extractPatternFromElement(candidate);
    if (pattern !== undefined) input.childPatterns.set(relativePath, pattern);
  }
  if (!input.childFixed.has(relativePath)) {
    const fixed = extractFixedFromElement(candidate);
    if (fixed !== undefined) input.childFixed.set(relativePath, fixed);
  }
  if ((candidate.min ?? 0) > 0 && !input.childMin.has(relativePath)) {
    input.childMin.set(relativePath, candidate.min!);
  }
  const types = getElementTypes(candidate);
  if (!input.childTypes.has(relativePath) && types.length > 0) input.childTypes.set(relativePath, types);
}

function getTypeProfileRelativePath(element: ElementDefinition, typeRoot: string): string {
  const idPrefix = `${typeRoot}.`;
  return typeof element.id === 'string' && element.id.startsWith(idPrefix)
    ? element.id.substring(idPrefix.length)
    : element.path.substring(typeRoot.length + 1);
}
