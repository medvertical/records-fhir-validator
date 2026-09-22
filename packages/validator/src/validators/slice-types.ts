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

export interface SliceDefinition {
  sliceName: string;
  path: string;
  min: number;
  max: string;
  discriminator?: SlicingDiscriminator[];
  pattern?: unknown;
  fixed?: unknown;
  patternKind?: string;
  fixedKind?: string;
  type?: Array<{ code: string; profile?: string[]; targetProfile?: string[] }>;
  childPatterns?: Map<string, unknown>;
  childFixed?: Map<string, unknown>;
  childMin?: Map<string, number>;
  childTypes?: Map<string, Array<{ code: string; profile?: string[]; targetProfile?: string[] }>>;
  childBindingValueSets?: Map<string, string>;
  childBindingCodes?: Map<string, Set<string>>;
  nestedElements?: ElementDefinition[];
  bindingValueSet?: string;
  bindingCodes?: Set<string>;
}
