/**
 * Shared Slice Types — breaks the circular dependency between
 * slicing-validator.ts and slice-discriminator-matcher.ts.
 */

import type { SlicingDiscriminator, ElementDefinition } from '../core/structure-definition-types.js';

export type { SlicingDiscriminator, ElementDefinition } from '../core/structure-definition-types.js';

/**
 * Resolves an in-memory FHIR reference for slicing discriminators.
 *
 * Keeping this contract with the other shared slicing types prevents policy
 * helpers from depending on the concrete `SlicingValidator` implementation.
 */
export type ReferenceResolver = (reference: string) => unknown | null;

export type ResolvedCodeElementMatch = (
  | { state: 'matched'; slice: SliceDefinition; matchedSlices: SliceDefinition[] }
  | { state: 'nonmember' | 'unknown'; slice: null }
  | { state: 'ambiguous'; slice: null; possibleSlices: SliceDefinition[]; conflictingSlices: SliceDefinition[]; certainAncestorSlices: SliceDefinition[] }
) & { hasUnresolvedCodeMetadata: boolean; unknownSlices: SliceDefinition[] };

export interface ResolvedCodeDiscriminatorEvidence {
  fixedValues: unknown[];
  patterns: unknown[];
  complete: boolean;
}

export interface SliceDefinition {
  sliceName: string;
  /** Invocation-local TYPE membership from the selected target definition, not conformance. */
  resolvedTypeEvidence?: (element: unknown) => 'matched' | 'nonmember' | 'unknown';
  validatedProfileConformance?: (value: unknown, profiles: string[]) => boolean | undefined;
  /** Scoped explicit conformance evidence; declaration/type fallbacks do not populate it. */
  validatedProfileConformanceEvidence?: (value: unknown, profiles: string[]) => boolean | undefined;
  path: string;
  min: number;
  max: string;
  discriminator?: SlicingDiscriminator[];
  pattern?: unknown;
  fixed?: unknown;
  patternKind?: string;
  fixedKind?: string;
  type?: Array<{ code: string; profile?: string[]; targetProfile?: string[] }>;
  resolvedCodeDiscriminators?: Map<string, ResolvedCodeDiscriminatorEvidence>;
  /** Constraints declared on this slice before merging individual profile alternatives. */
  localProfileDiscriminatorElements?: ElementDefinition[];
  childPatterns?: Map<string, unknown>;
  childFixed?: Map<string, unknown>;
  childMin?: Map<string, number>;
  childMax?: Map<string, number>;
  childTypes?: Map<string, Array<{ code: string; profile?: string[]; targetProfile?: string[] }>>;
  childBindingValueSets?: Map<string, string>;
  childBindingCodes?: Map<string, Set<string>>;
  nestedElements?: ElementDefinition[];
  bindingValueSet?: string;
  bindingCodes?: Set<string>;
  /**
   * The profile gives this slice a `$this` pattern or value discriminator but
   * no pattern, fixed value or required binding, so it can claim no element.
   */
  undiscriminated?: true;
}
