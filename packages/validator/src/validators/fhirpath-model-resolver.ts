/**
 * FHIRPath Model Resolver
 *
 * Maps FHIR version to the correct fhirpath.js model context.
 * Single source of truth — used by constraint-validator, sd-fhirpath-executor,
 * and custom-rule-executor instead of hardcoding fhirpath_r4.
 */

export { getFhirPathModel } from '../core/fhirpath-context.js';
export type { FhirPathModel } from '../core/fhirpath-context.js';
