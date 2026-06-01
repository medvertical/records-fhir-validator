import type { ValidationIssue } from '../types';
import type { StructureDefinition } from './structure-definition-types';

export interface AspectResult {
  aspect: string;
  issues: ValidationIssue[];
  validationTime: number;
  isValid: boolean;
}

export interface MultiAspectValidateResult {
  isValid: boolean;
  aspects: AspectResult[];
  structureDef?: StructureDefinition;
}

export type ValidateOneFn = (
  resource: unknown,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  enclosingBundle?: Record<string, unknown>,
  /** Suppress the reference target-profile-conformance pass to prevent cycles. */
  skipTargetProfileConformance?: boolean,
) => Promise<MultiAspectValidateResult>;
