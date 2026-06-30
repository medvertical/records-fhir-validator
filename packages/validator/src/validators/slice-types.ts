/**
 * Shared Slice Types — breaks the circular dependency between
 * slicing-validator.ts and slice-discriminator-matcher.ts.
 */

import type { SlicingDiscriminator, ElementDefinition } from '../core/structure-definition-types';

export type { SlicingDiscriminator, ElementDefinition } from '../core/structure-definition-types';

export interface SliceDefinition {
  sliceName: string;
  path: string;
  min: number;
  max: string;
  discriminator?: SlicingDiscriminator[];
  pattern?: any;
  fixed?: any;
  patternKind?: string;
  fixedKind?: string;
  type?: Array<{ code: string; profile?: string[]; targetProfile?: string[] }>;
  childPatterns?: Map<string, any>;
  childFixed?: Map<string, any>;
  childTypes?: Map<string, Array<{ code: string; profile?: string[]; targetProfile?: string[] }>>;
  nestedElements?: ElementDefinition[];
  bindingValueSet?: string;
  bindingCodes?: Set<string>;
}
