/**
 * Slicing Validator
 *
 * Validates sliced elements in FHIR resources:
 * - Identifies which slice each element belongs to
 * - Validates slice cardinality (min/max per slice)
 * - Validates discriminator matching
 * - Supports discriminator types: value, pattern, type, profile, exists
 * 
 * Critical for UK Core NHS Number validation (Patient.identifier slicing)
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import {
  getValueAtPath,
  codingMatchesBindingCodes,
  matchesPattern,
} from './slice-utils';
import { matchDiscriminator as externalMatchDiscriminator } from './slice-discriminator-matcher';
import { extractSlicingInfo as externalExtractSlicingInfo } from './slice-info-extractor';
import type { SliceDefinition } from './slice-types';
import type { StructureDefinition, SlicingDefinition, SlicingDiscriminator } from '../core/structure-definition-types';
import { ValueSetPackageLoader } from './valueset-package-loader';
import { logger } from '../logger';
import {
  emitMatchedSliceChildIssues,
  resourceTypeFromPath,
  validateSliceContentConstraints,
  validateSliceRootConstraints,
} from './slicing-content-rules';
import { validateSliceOrdering } from './slicing-ordering';
import { createIsolatedSlicingValueSetLoader } from './slicing-valueset-loader';
import { urlMatchesRequestedFhirVersion, type FhirVersionFamily } from '../core/sd-loader-version-utils';

// ============================================================================
// Types
// ============================================================================

// Re-export slicing types from core types
export type { SlicingDiscriminator, SlicingDefinition } from '../core/structure-definition-types';

export type { SliceDefinition } from './slice-types';

/**
 * Callback used by the slicing validator to resolve a FHIR reference to the
 * referenced resource. Implementations typically look up the reference in
 * the current Bundle or `contained[]`.
 *
 * The resolver is **synchronous** — it must be able to answer from data the
 * caller already has in memory. Async resolution (e.g. remote reference
 * existence checks) should happen in a pre-pass via
 * `BatchedReferenceChecker` and the resolved bodies passed into the slicing
 * validator via this resolver.
 *
 * Returning `null` means "not resolvable" — the validator will then fall
 * back to matching against `value.meta.profile` as before.
 */
export type ReferenceResolver = (reference: string) => any | null;

/**
 * Callback that resolves a profile URL to its StructureDefinition. Used by
 * the slicing validator to follow `type[].profile` on slice elements and
 * extract discriminator patterns (e.g. ISiKLoincCoding → patternUri on
 * Coding.system).
 */
export type TypeProfileResolver = (profileUrl: string) => Promise<StructureDefinition | null>;

// ============================================================================
// Slicing Validator
// ============================================================================

export class SlicingValidator {
  /**
   * Optional reference resolver used by the discriminator-by-profile matcher
   * to chase references inside Bundles / contained resources. Set via
   * `setReferenceResolver` from whichever validator owns the bundle context.
   */
  private referenceResolver: ReferenceResolver | null = null;

  /**
   * Optional profile resolver for looking up type profiles on slice elements.
   * When a slice has `type[].profile` (e.g. ISiKLoincCoding), the resolver
   * fetches the profile so discriminator patterns can be extracted.
   */
  private typeProfileResolver: TypeProfileResolver | null = null;

  /** Lazy-initialised loader for resolving ValueSet compose into code sets. */
  private valueSetLoader: ValueSetPackageLoader | null = null;

  private getValueSetLoader(): ValueSetPackageLoader {
    if (!this.valueSetLoader) {
      this.valueSetLoader = createIsolatedSlicingValueSetLoader();
    }
    return this.valueSetLoader;
  }

  /**
   * Provide a resolver so `matchProfileDiscriminator` can follow references
   * to check the referenced resource's `meta.profile`. Pass `null` to clear.
   */
  public setReferenceResolver(resolver: ReferenceResolver | null): void {
    this.referenceResolver = resolver;
  }

  /**
   * Provide a resolver for type profiles on slice elements.
   */
  public setTypeProfileResolver(resolver: TypeProfileResolver | null): void {
    this.typeProfileResolver = resolver;
  }

  /**
   * Validate slicing for a specific element path
   */
  // eslint-disable-next-line max-lines-per-function
  async validateSlicing(
    elements: any[],
    elementPath: string,
    profileSD: StructureDefinition,
    referenceResolverOverride?: ReferenceResolver | null,
    slicingElementId?: string,
    fhirVersion: FhirVersionFamily = 'R4',
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Get slicing definition for this path
      const slicingInfo = await this.extractSlicingInfo(elementPath, profileSD, slicingElementId);

      if (!slicingInfo || slicingInfo.slices.length === 0) {
        // No slicing defined for this element
        return issues;
      }
      const compatibleSlices = slicingInfo.slices.filter(slice => this.isSliceCompatibleWithFhirVersion(slice, fhirVersion));
      if (compatibleSlices.length === 0) {
        return issues;
      }

      logger.debug(`[SlicingValidator] Validating ${elements.length} elements for path ${elementPath} with ${compatibleSlices.length} slices`);

      // Match each element to its slice
      const sliceMatches = new Map<string, Array<{ element: any; index: number }>>(); // sliceName -> matched elements with original index
      const cardinalityMatches = new Map<string, Array<{ element: any; index: number }>>();
      const unmatchedElements: Array<{ element: any; index: number }> = [];

      for (let index = 0; index < elements.length; index++) {
        const element = elements[index];
        const matchedSlice = this.matchElementToSlice(
          element,
          compatibleSlices,
          slicingInfo.slicing,
          referenceResolverOverride,
        );

        if (matchedSlice) {
          if (!sliceMatches.has(matchedSlice.sliceName)) {
            sliceMatches.set(matchedSlice.sliceName, []);
          }
          sliceMatches.get(matchedSlice.sliceName)!.push({ element, index });

          if (this.elementCountsForSliceCardinality(
            element,
            matchedSlice,
            slicingInfo.slicing.discriminator || [],
            compatibleSlices,
            referenceResolverOverride,
            slicingInfo.slicing.rules,
          )) {
            if (!cardinalityMatches.has(matchedSlice.sliceName)) {
              cardinalityMatches.set(matchedSlice.sliceName, []);
            }
            cardinalityMatches.get(matchedSlice.sliceName)!.push({ element, index });
          }
        } else {
          unmatchedElements.push({ element, index });
        }
      }

      // Validate cardinality for each slice
      for (const slice of compatibleSlices) {
        const matchedElements = sliceMatches.get(slice.sliceName) || [];
        const countedElements = cardinalityMatches.get(slice.sliceName) || [];
        const count = countedElements.length;
        const resourceType = resourceTypeFromPath(elementPath);

        // Check min cardinality
        if (
          count < slice.min &&
          !this.shouldSuppressUnresolvedBindingOnlyMin(slice, elements)
        ) {
          issues.push(createValidationIssue({
            code: 'profile-slice-min-cardinality',
            path: elementPath,
            resourceType,
            messageParams: { slice: slice.sliceName, min: slice.min, actual: count },
            ruleId: `slice-min-${slice.sliceName}`,
            details: { sliceName: slice.sliceName },
          }));

          // Ghost nodes for the tree viewer are derived from the slice-level
          // cardinality issue above — emitting separate required-element-missing
          // issues for each child of an absent slice causes false positives
          // (Java only reports the slice cardinality error, not per-child errors).
        }

        // Check max cardinality
        if (slice.max !== '*') {
          const maxNum = parseInt(slice.max, 10);
          if (count > maxNum) {
            issues.push(createValidationIssue({
              code: 'profile-slice-max-cardinality',
              path: elementPath,
              resourceType,
              messageParams: { slice: slice.sliceName, max: slice.max, actual: count },
              ruleId: `slice-max-${slice.sliceName}`,
              details: { sliceName: slice.sliceName },
            }));
          }
        }

        // Validate slice content constraints (fixed/pattern values in nested elements)
        for (const matched of matchedElements) {
          const rootIssues = validateSliceRootConstraints(
            matched.element,
            slice,
            `${elementPath}[${matched.index}]`,
          );
          issues.push(...rootIssues);

          const contentIssues = validateSliceContentConstraints(
            matched.element,
            slice,
            `${elementPath}[${matched.index}]`,
            profileSD
          );
          issues.push(...contentIssues);

          // Report missing required / mustSupport direct children of the
          // matched slice element so the tree viewer can render ghosts for
          // them (e.g. name:name exists but lacks required family/given).
          const childIssues = emitMatchedSliceChildIssues(
            matched.element,
            slice,
            `${elementPath}[${matched.index}]`,
            profileSD
          );
          issues.push(...childIssues);
        }
      }

      // Check unmatched elements
      if (
        unmatchedElements.length > 0 &&
        slicingInfo.slicing.rules === 'closed' &&
        !this.shouldSuppressUnresolvedBindingClosedUnmatched(compatibleSlices, slicingInfo.slicing)
      ) {
        issues.push(createValidationIssue({
          code: 'profile-slice-closed-unmatched',
          path: elementPath,
          resourceType: resourceTypeFromPath(elementPath),
          messageParams: { path: elementPath, count: unmatchedElements.length },
        }));
      }

      if (unmatchedElements.length > 0) {
        issues.push(...this.emitMissingDiscriminatorIssues(
          unmatchedElements,
          compatibleSlices,
          slicingInfo.slicing,
          elementPath,
          profileSD,
        ));
      }

      // Check ordering if required
      if (slicingInfo.slicing.ordered && sliceMatches.size > 1) {
        const orderIssues = validateSliceOrdering(
          elements,
          compatibleSlices,
          element => this.matchElementToSlice(
            element,
            compatibleSlices,
            { discriminator: compatibleSlices[0].discriminator },
          ),
          elementPath,
        );
        issues.push(...orderIssues);
      }

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('[SlicingValidator] Error validating slicing:', error);
      issues.push(createValidationIssue({
        code: 'profile-slice-validation-error',
        path: elementPath,
        resourceType: resourceTypeFromPath(elementPath),
        customMessage: `Slicing validation failed: ${err.message}`,
      }));
    }

    return issues;
  }

  /**
   * Match an element to a slice based on discriminators
   */
  private matchElementToSlice(
    element: any,
    slices: SliceDefinition[],
    slicingDef: SlicingDefinition,
    referenceResolverOverride?: ReferenceResolver | null,
  ): SliceDefinition | null {
    // Try to match element against each slice
    for (const slice of slices) {
      if (this.elementMatchesSlice(
        element,
        slice,
        slicingDef.discriminator || [],
        slices,
        referenceResolverOverride,
      )) {
        return slice;
      }
    }

    return null;
  }

  private shouldSuppressUnresolvedBindingOnlyMin(slice: SliceDefinition, elements: any[]): boolean {
    if (elements.length === 0) return false;
    if (!this.isUnresolvedBindingOnlySlice(slice)) return false;

    const discriminators = slice.discriminator ?? [];
    if (discriminators.length === 0) return false;

    return discriminators.every(discriminator =>
      (discriminator.type === 'pattern' || discriminator.type === 'value') &&
      (!discriminator.path || discriminator.path === '$this'),
    );
  }

  private shouldSuppressUnresolvedBindingClosedUnmatched(
    slices: SliceDefinition[],
    slicingDef: SlicingDefinition,
  ): boolean {
    const discriminators = slicingDef.discriminator ?? [];
    if (slices.length === 0) return false;
    if (discriminators.length === 0) return false;
    if (!discriminators.every(discriminator =>
      (discriminator.type === 'pattern' || discriminator.type === 'value') &&
      (!discriminator.path || discriminator.path === '$this'),
    )) {
      return false;
    }

    return slices.some(slice => this.isUnresolvedBindingOnlySlice(slice));
  }

  private isUnresolvedBindingOnlySlice(slice: SliceDefinition): boolean {
    return Boolean(slice.bindingValueSet) &&
      !slice.bindingCodes?.size &&
      slice.pattern === undefined &&
      slice.fixed === undefined &&
      (slice.childPatterns?.size ?? 0) === 0 &&
      (slice.childFixed?.size ?? 0) === 0;
  }

  private isSliceCompatibleWithFhirVersion(slice: SliceDefinition, fhirVersion: FhirVersionFamily): boolean {
    const urls: string[] = [];
    for (const typeSpec of slice.type ?? []) {
      urls.push(...(typeSpec.profile ?? []), ...(typeSpec.targetProfile ?? []));
    }

    for (const typeSpecs of slice.childTypes?.values() ?? []) {
      for (const typeSpec of typeSpecs) {
        urls.push(...(typeSpec.profile ?? []), ...(typeSpec.targetProfile ?? []));
      }
    }

    return urls.every(url => urlMatchesRequestedFhirVersion(url, fhirVersion));
  }

  /**
   * Check if element matches slice definition
   */
  private elementMatchesSlice(
    element: any,
    slice: SliceDefinition,
    discriminators: SlicingDiscriminator[],
    allSlices?: SliceDefinition[],
    referenceResolverOverride?: ReferenceResolver | null,
  ): boolean {
    // If no discriminators, we can't match
    if (discriminators.length === 0) {
      return false;
    }

    // All discriminators must match
    for (const discriminator of discriminators) {
      if (!this.matchDiscriminator(element, slice, discriminator, allSlices, referenceResolverOverride)) {
        return false;
      }
    }

    return true;
  }

  private elementCountsForSliceCardinality(
    element: any,
    slice: SliceDefinition,
    discriminators: SlicingDiscriminator[],
    allSlices: SliceDefinition[],
    referenceResolverOverride?: ReferenceResolver | null,
    slicingRules?: string,
  ): boolean {
    if (slicingRules !== 'closed') return true;

    return !this.isRelaxedCodingIdentityMatch(
      element,
      slice,
      discriminators,
      allSlices,
      referenceResolverOverride,
    );
  }

  private isRelaxedCodingIdentityMatch(
    element: any,
    slice: SliceDefinition,
    discriminators: SlicingDiscriminator[],
    allSlices: SliceDefinition[],
    referenceResolverOverride?: ReferenceResolver | null,
  ): boolean {
    for (const discriminator of discriminators) {
      if (!this.matchDiscriminator(element, slice, discriminator, allSlices, referenceResolverOverride)) {
        return false;
      }

      if (isCodingIdentityRelaxedPatternMatch(element, slice, discriminator)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Match a single discriminator.
   *
   * When the discriminator path starts with `resolve()`, the element is
   * treated as a FHIR Reference, the reference is resolved via the
   * configured `ReferenceResolver`, and the remaining path (after
   * `resolve()`) is applied to the resolved resource. This closes gap
   * K-4 from the strategic roadmap.
   */
  private matchDiscriminator(
    element: any,
    slice: SliceDefinition,
    discriminator: SlicingDiscriminator,
    allSlices?: SliceDefinition[],
    referenceResolverOverride?: ReferenceResolver | null,
  ): boolean {
    return externalMatchDiscriminator(
      element, slice, discriminator,
      referenceResolverOverride ?? this.referenceResolver ?? null,
      matchesPattern,
      codingMatchesBindingCodes,
      allSlices,
    );
  }
  /**
   * Resolve type profiles on a slice element and merge their pattern/fixed
   * values into the child maps. When a slice's type carries a profile
   * (e.g. ISiKLoincCoding), the distinguishing value lives inside that
   * profile rather than on the slice element itself.
   */
  // Delegated to slice-info-extractor.ts.
  private async extractSlicingInfo(
    elementPath: string,
    profileSD: StructureDefinition,
    slicingElementId?: string,
  ) {
    return externalExtractSlicingInfo(
      elementPath, profileSD,
      this.typeProfileResolver,
      this.getValueSetLoader(),
      slicingElementId,
    );
  }
  /**
   * Open value slicing can otherwise hide an intended slice when the
   * discriminator itself is absent. For a single fixed-discriminator slice,
   * report a low-severity profile constraint on the sliced element if another
   * required child from that slice is present.
   */
  private emitMissingDiscriminatorIssues(
    unmatchedElements: Array<{ element: any; index: number }>,
    slices: SliceDefinition[],
    slicingDef: SlicingDefinition,
    elementPath: string,
    profileSD: StructureDefinition,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (slices.length !== 1 || slicingDef.discriminator?.length !== 1) return issues;

    const discriminator = slicingDef.discriminator[0];
    if (discriminator.type !== 'value' || !discriminator.path || discriminator.path === '$this') {
      return issues;
    }

    const slice = slices[0];
    const expectedValue = slice.childFixed?.get(discriminator.path)
      ?? slice.childPatterns?.get(discriminator.path)
      ?? (slice.fixed ? getValueAtPath(slice.fixed, discriminator.path) : undefined)
      ?? (slice.pattern ? getValueAtPath(slice.pattern, discriminator.path) : undefined);
    if (expectedValue === undefined || expectedValue === null) return issues;

    const evidencePaths = this.getRequiredSliceEvidencePaths(slice, discriminator.path, profileSD);
    if (evidencePaths.length === 0) return issues;

    for (const { element, index } of unmatchedElements) {
      const discriminatorValue = getValueAtPath(element, discriminator.path);
      if (discriminatorValue !== undefined && discriminatorValue !== null) continue;

      const hasEvidence = evidencePaths.some(path => {
        const value = getValueAtPath(element, path);
        return value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
      });
      if (!hasEvidence) continue;

      issues.push(createValidationIssue({
        code: 'profile-constraint-violation',
        path: `${elementPath}[${index}]`,
        resourceType: resourceTypeFromPath(elementPath),
        customMessage: `Slice '${slice.sliceName}' requires discriminator '${discriminator.path}' to be present`,
        severityOverride: 'info',
        ruleId: `slice-${slice.sliceName}-${discriminator.path}`,
        details: {
          sliceName: slice.sliceName,
          discriminatorPath: discriminator.path,
          expectedValue,
        },
      }));
    }

    return issues;
  }

  private getRequiredSliceEvidencePaths(
    slice: SliceDefinition,
    discriminatorPath: string,
    profileSD: StructureDefinition,
  ): string[] {
    const snapshot = profileSD.snapshot?.element;
    if (!snapshot?.length) return [];

    const idPrefix = `${slice.path}:${slice.sliceName}.`;
    const evidencePaths: string[] = [];

    for (const elementDef of snapshot) {
      const id = elementDef.id;
      if (!id || !id.startsWith(idPrefix)) continue;

      const relative = id.substring(idPrefix.length);
      if (relative.includes('.') || relative.includes(':')) continue;
      if (relative === discriminatorPath) continue;
      if ((elementDef.min ?? 0) < 1) continue;

      evidencePaths.push(relative);
    }

    return evidencePaths;
  }

}

function isCodingIdentityRelaxedPatternMatch(
  element: any,
  slice: SliceDefinition,
  discriminator: SlicingDiscriminator,
): boolean {
  if (discriminator.type !== 'pattern') return false;
  if (discriminator.path && discriminator.path !== '$this') return false;
  if (slice.patternKind !== 'patternCoding' || slice.pattern === undefined) return false;

  const elementValue = getValueAtPath(element, discriminator.path);
  if (matchesPattern(elementValue, slice.pattern)) return false;

  return codingIdentityMatchesPattern(elementValue, slice.pattern);
}

function codingIdentityMatchesPattern(elementValue: any, patternValue: any): boolean {
  if (!isRecord(elementValue) || !isRecord(patternValue)) return false;
  if (typeof patternValue.system !== 'string' || typeof patternValue.code !== 'string') {
    return false;
  }
  return elementValue.system === patternValue.system && elementValue.code === patternValue.code;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
