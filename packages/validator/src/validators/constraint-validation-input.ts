import type {
  Constraint,
  ElementDefinition,
} from '../core/structure-definition-types.js';
import type { BundleResourceInput } from './fhirpath-resolve-precheck.js';
import type { buildUserInvocationTable } from './fhirpath-custom-functions.js';
import { isRecord } from '../core/fhir-resource.js';
import type { FhirResource } from '../core/fhir-resource.js';
import type { ProfileConformanceLookup } from './sd-fhirpath-profile-conformance.js';
import type { ReferenceResolver } from './slice-types.js';

export { isFhirResource, isRecord } from '../core/fhir-resource.js';
export type { FhirResource } from '../core/fhir-resource.js';

export interface ConstraintValidationState {
  strictnessMode: 'standard' | 'strict';
  fhirVersion: 'R4' | 'R5' | 'R6';
  userInvocationTable: ReturnType<typeof buildUserInvocationTable>;
  bundle?: BundleResourceInput;
  rootResource?: FhirResource;
  focusResource?: FhirResource | null;
  referenceResolver?: ReferenceResolver | null;
  /** Resolved paths belong to this validation only; inputs may change between calls. */
  getEvaluationContext?: (path: string) => unknown;
}

export interface ConstraintValidationOptions {
  strictMode?: boolean;
  fhirVersion?: 'R4' | 'R5' | 'R6';
  bundle?: BundleResourceInput;
  referenceResolver?: ReferenceResolver | null;
  /**
   * Outermost FHIRPath %rootResource. Legacy callers also use it as %resource;
   * slice callers supply focusResource separately when an embedded resource
   * owns the node under test.
   */
  rootResource?: FhirResource;
  /** Explicit nearest %resource; null leaves it unbound instead of inventing an owner. */
  focusResource?: FhirResource | null;
  /** Conformance to the profiles conformsTo() names, established beforehand. */
  profileConformance?: ProfileConformanceLookup;
}

export function isElementWithConstraints(
  value: unknown,
): value is ElementDefinition & { constraint: unknown[] } {
  return isRecord(value) &&
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    Array.isArray(value.constraint) &&
    value.constraint.length > 0;
}

export function isConstraint(value: unknown): value is Constraint {
  return isRecord(value) &&
    typeof value.key === 'string' &&
    value.key.length > 0 &&
    (value.severity === 'error' || value.severity === 'warning') &&
    typeof value.human === 'string' &&
    (value.expression === undefined || typeof value.expression === 'string');
}
