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
  valuesMatch,
  extractFixedValue,
  extractPatternValue,
  codingMatchesBindingCodes,
  matchesPattern,
} from './slice-utils';
import { matchDiscriminator as externalMatchDiscriminator } from './slice-discriminator-matcher';
import { extractSlicingInfo as externalExtractSlicingInfo } from './slice-info-extractor';
import type { SliceDefinition } from './slice-types';
import type { StructureDefinition, SlicingDefinition, SlicingDiscriminator } from '../core/structure-definition-types';
import { ValueSetPackageLoader } from './valueset-package-loader';
import { ValueSetCache } from './valueset-cache';
import { logger } from '../logger';

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
      // Use an isolated cache so binding lookups for discriminator matching
      // don't pollute the shared terminology cache (which would cause
      // false terminology-binding errors on unrelated codings).
      const isolatedCache = new ValueSetCache();
      // Ensure the loader can find packages even when dotenv loads $HOME
      // literally. Override the env to force os.homedir() resolution.
      const saved = process.env.FHIR_PACKAGE_CACHE_PATH;
      if (saved?.includes('$HOME')) {
        delete process.env.FHIR_PACKAGE_CACHE_PATH;
      }
      this.valueSetLoader = new ValueSetPackageLoader(isolatedCache);
      if (saved !== undefined) {
        process.env.FHIR_PACKAGE_CACHE_PATH = saved;
      }
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
    profileSD: StructureDefinition
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Get slicing definition for this path
      const slicingInfo = await this.extractSlicingInfo(elementPath, profileSD);

      if (!slicingInfo || slicingInfo.slices.length === 0) {
        // No slicing defined for this element
        return issues;
      }

      logger.debug(`[SlicingValidator] Validating ${elements.length} elements for path ${elementPath} with ${slicingInfo.slices.length} slices`);

      // Match each element to its slice
      const sliceMatches = new Map<string, any[]>(); // sliceName -> elements
      const unmatchedElements: Array<{ element: any; index: number }> = [];

      for (let index = 0; index < elements.length; index++) {
        const element = elements[index];
        const matchedSlice = this.matchElementToSlice(
          element,
          slicingInfo.slices,
          slicingInfo.slicing
        );

        if (matchedSlice) {
          if (!sliceMatches.has(matchedSlice.sliceName)) {
            sliceMatches.set(matchedSlice.sliceName, []);
          }
          sliceMatches.get(matchedSlice.sliceName)!.push(element);
        } else {
          unmatchedElements.push({ element, index });
        }
      }

      // Validate cardinality for each slice
      for (const slice of slicingInfo.slices) {
        const matchedElements = sliceMatches.get(slice.sliceName) || [];
        const count = matchedElements.length;

        // Check min cardinality
        if (count < slice.min) {
          issues.push(createValidationIssue({
            code: 'profile-slice-min-cardinality',
            path: elementPath,
            resourceType: 'Unknown',
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
              resourceType: 'Unknown',
              messageParams: { slice: slice.sliceName, max: slice.max, actual: count },
              ruleId: `slice-max-${slice.sliceName}`,
              details: { sliceName: slice.sliceName },
            }));
          }
        }

        // Validate slice content constraints (fixed/pattern values in nested elements)
        for (let i = 0; i < matchedElements.length; i++) {
          const contentIssues = this.validateSliceContentConstraints(
            matchedElements[i],
            slice,
            `${elementPath}[${i}]`,
            profileSD
          );
          issues.push(...contentIssues);

          // Report missing required / mustSupport direct children of the
          // matched slice element so the tree viewer can render ghosts for
          // them (e.g. name:name exists but lacks required family/given).
          const childIssues = this.emitMatchedSliceChildIssues(
            matchedElements[i],
            slice,
            `${elementPath}[${i}]`,
            profileSD
          );
          issues.push(...childIssues);
        }
      }

      // Check unmatched elements
      if (unmatchedElements.length > 0 && slicingInfo.slicing.rules === 'closed') {
        issues.push(createValidationIssue({
          code: 'profile-slice-closed-unmatched',
          path: elementPath,
          resourceType: 'Unknown',
          messageParams: { path: elementPath, count: unmatchedElements.length },
        }));
      }

      if (unmatchedElements.length > 0) {
        issues.push(...this.emitMissingDiscriminatorIssues(
          unmatchedElements,
          slicingInfo.slices,
          slicingInfo.slicing,
          elementPath,
          profileSD,
        ));
      }

      // Check ordering if required
      if (slicingInfo.slicing.ordered && sliceMatches.size > 1) {
        const orderIssues = this.validateSliceOrdering(
          elements,
          slicingInfo.slices,
          sliceMatches,
          elementPath
        );
        issues.push(...orderIssues);
      }

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('[SlicingValidator] Error validating slicing:', error);
      issues.push(createValidationIssue({
        code: 'profile-slice-validation-error',
        path: elementPath,
        resourceType: 'Unknown',
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
    slicingDef: SlicingDefinition
  ): SliceDefinition | null {
    // Try to match element against each slice
    for (const slice of slices) {
      if (this.elementMatchesSlice(element, slice, slicingDef.discriminator || [], slices)) {
        return slice;
      }
    }

    return null;
  }

  /**
   * Check if element matches slice definition
   */
  private elementMatchesSlice(
    element: any,
    slice: SliceDefinition,
    discriminators: SlicingDiscriminator[],
    allSlices?: SliceDefinition[]
  ): boolean {
    // If no discriminators, we can't match
    if (discriminators.length === 0) {
      return false;
    }

    // All discriminators must match
    for (const discriminator of discriminators) {
      if (!this.matchDiscriminator(element, slice, discriminator, allSlices)) {
        return false;
      }
    }

    return true;
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
    allSlices?: SliceDefinition[]
  ): boolean {
    return externalMatchDiscriminator(
      element, slice, discriminator,
      this.referenceResolver ?? null,
      matchesPattern,
      codingMatchesBindingCodes,
      allSlices,
    );
  }
  private validateSliceOrdering(
    elements: any[],
    slices: SliceDefinition[],
    sliceMatches: Map<string, any[]>,
    elementPath: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Build expected order from slice definitions
    const sliceOrder = slices.map(s => s.sliceName);

    // Track which slice each element belongs to
    const elementSliceOrder: string[] = [];
    for (const element of elements) {
      const matchedSlice = this.matchElementToSlice(element, slices, { discriminator: slices[0].discriminator });
      if (matchedSlice) {
        elementSliceOrder.push(matchedSlice.sliceName);
      }
    }

    // Check if elements are in correct order
    let lastSliceIndex = -1;
    for (const sliceName of elementSliceOrder) {
      const currentSliceIndex = sliceOrder.indexOf(sliceName);
      if (currentSliceIndex < lastSliceIndex) {
        issues.push(createValidationIssue({
          code: 'profile-slice-ordering-violation',
          path: elementPath,
          resourceType: 'Unknown',
          messageParams: { path: elementPath, sliceName },
        }));
        break;
      }
      lastSliceIndex = currentSliceIndex;
    }

    return issues;
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
    profileSD: StructureDefinition
  ) {
    return externalExtractSlicingInfo(
      elementPath, profileSD,
      this.typeProfileResolver,
      this.getValueSetLoader(),
    );
  }
  /**
   * Validate content constraints within a matched slice element
   * 
   * Checks fixed/pattern values defined in nested element definitions
   * for a specific slice (e.g., identifier.assigner.identifier.system).
   */
  private validateSliceContentConstraints(
    element: any,
    slice: SliceDefinition,
    elementPath: string,
    profileSD: StructureDefinition
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const elements = profileSD.snapshot?.element || profileSD.differential?.element || [];

    // Nested slice elements in real FHIR snapshots carry the slice marker in
    // `id` (e.g. `Patient.identifier:gkv.assigner.identifier.system`) while
    // `path` stays on the base. Match either; tests sometimes embed the
    // slice marker in `path` directly.
    const slicePrefix = `${slice.path}:${slice.sliceName}`;

    for (const elementDef of elements) {
      const id = elementDef.id;
      const path = elementDef.path;

      let relativePath: string | null = null;
      if (id && id.startsWith(slicePrefix + '.')) {
        relativePath = id.substring(slicePrefix.length + 1);
      } else if (path.startsWith(slicePrefix + '.')) {
        relativePath = path.substring(slicePrefix.length + 1);
      }
      if (relativePath === null) continue;

      // Skip further-nested slices within this slice — those are handled
      // by their own slicing definitions.
      if (relativePath.includes(':')) continue;

      // Check for fixed values
      const fixedValue = extractFixedValue(elementDef);
      if (fixedValue !== undefined) {
        const actualValue = getValueAtPath(element, relativePath);

        if (actualValue === undefined || actualValue === null) {
          // Fixed value is required but element doesn't have it
          issues.push(createValidationIssue({
            code: 'profile-slice-fixed-value-missing',
            path: `${elementPath}.${relativePath}`,
            resourceType: 'Unknown',
            customMessage: `Slice '${slice.sliceName}' requires fixed value '${JSON.stringify(fixedValue)}' at ${relativePath}`,
            details: {
              sliceName: slice.sliceName,
              relativePath,
              expectedValue: fixedValue,
              actualValue: null,
            },
          }));
        } else if (!valuesMatch(actualValue, fixedValue)) {
          // Fixed value mismatch
          issues.push(createValidationIssue({
            code: 'profile-slice-fixed-value-mismatch',
            path: `${elementPath}.${relativePath}`,
            resourceType: 'Unknown',
            customMessage: `Slice '${slice.sliceName}' requires '${relativePath}' to be '${fixedValue}', found: '${actualValue}'`,
            details: {
              sliceName: slice.sliceName,
              relativePath,
              expectedValue: fixedValue,
              actualValue,
            },
          }));
        }
      }

      // Check for pattern values
      const patternValue = extractPatternValue(elementDef);
      if (patternValue !== undefined) {
        const actualValue = getValueAtPath(element, relativePath);

        if (actualValue !== undefined && actualValue !== null) {
          // For patterns, the actual value must contain all pattern properties
          if (!matchesPattern(actualValue, patternValue)) {
            issues.push(createValidationIssue({
              code: 'profile-slice-pattern-mismatch',
              path: `${elementPath}.${relativePath}`,
              resourceType: 'Unknown',
              customMessage: `Slice '${slice.sliceName}' pattern mismatch at ${relativePath}`,
              details: {
                sliceName: slice.sliceName,
                relativePath,
                expectedPattern: patternValue,
                actualValue,
              },
            }));
          }
        }
      }
    }

    return issues;
  }

  /**
   * Emit required-element / mustSupport issues for the direct children of a
   * missing slice. Profile snapshots distinguish slice children via the
   * element `id` (e.g. `Patient.identifier:VersichertenId-GKV.type`) while
   * the `path` stays on the base (`Patient.identifier.type`) — so we match
   * on `id` prefix, not path.
   */
  private emitMissingSliceChildren(
    slice: SliceDefinition,
    elementPath: string,
    profileSD: StructureDefinition
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const snapshot = profileSD.snapshot?.element;
    if (!snapshot?.length) return issues;

    const idPrefix = `${slice.path}:${slice.sliceName}.`;

    for (const elementDef of snapshot) {
      const id = elementDef.id;
      if (!id || !id.startsWith(idPrefix)) continue;

      // Direct children only — skip deeper grandchildren and nested slices
      const relative = id.substring(idPrefix.length);
      if (relative.includes('.') || relative.includes(':')) continue;

      const isRequired = (elementDef.min ?? 0) >= 1;
      const isMustSupport = elementDef.mustSupport === true;
      if (!isRequired && !isMustSupport) continue;

      const childPath = `${elementPath}:${slice.sliceName}.${relative}`;

      if (isRequired) {
        issues.push(createValidationIssue({
          code: 'required-element-missing',
          path: childPath,
          resourceType: 'Unknown',
          messageParams: { element: childPath },
          details: { sliceName: slice.sliceName, parentMissing: true },
        }));
      } else if (isMustSupport) {
        issues.push(createValidationIssue({
          code: 'profile-mustsupport-missing',
          path: childPath,
          resourceType: 'Unknown',
          messageParams: { element: childPath },
          details: { sliceName: slice.sliceName, parentMissing: true },
        }));
      }
    }

    return issues;
  }

  /**
   * For each matched slice element, report direct children that are
   * required (min>=1) or mustSupport but missing. This is the slice
   * analogue of the structural executor's required/mustSupport pass —
   * the executor skips slice-scoped elements (id contains ':') so we
   * must own them here. Deep children are handled recursively through
   * nested slice elements with their own `emitMatchedSliceChildIssues`
   * calls further down the tree.
   */
  private emitMatchedSliceChildIssues(
    element: any,
    slice: SliceDefinition,
    elementPath: string,
    profileSD: StructureDefinition
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const snapshot = profileSD.snapshot?.element;
    if (!snapshot?.length) return issues;

    const idPrefix = `${slice.path}:${slice.sliceName}.`;

    for (const elementDef of snapshot) {
      const id = elementDef.id;
      if (!id || !id.startsWith(idPrefix)) continue;

      // Direct children only — skip grandchildren and nested slice markers
      const relative = id.substring(idPrefix.length);
      if (relative.includes('.') || relative.includes(':')) continue;

      const isRequired = (elementDef.min ?? 0) >= 1;
      const isMustSupport = elementDef.mustSupport === true;
      if (!isRequired && !isMustSupport) continue;

      const actualValue = getValueAtPath(element, relative);
      const isPresent = actualValue !== undefined && actualValue !== null &&
        (!Array.isArray(actualValue) || actualValue.length > 0);
      if (isPresent) continue;

      const childPath = `${elementPath}:${slice.sliceName}.${relative}`;

      if (isRequired) {
        issues.push(createValidationIssue({
          code: 'required-element-missing',
          path: childPath,
          resourceType: 'Unknown',
          messageParams: { element: childPath },
          details: { sliceName: slice.sliceName },
        }));
      } else if (isMustSupport) {
        issues.push(createValidationIssue({
          code: 'profile-mustsupport-missing',
          path: childPath,
          resourceType: 'Unknown',
          messageParams: { element: childPath },
          details: { sliceName: slice.sliceName },
        }));
      }
    }

    return issues;
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
        resourceType: 'Unknown',
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
