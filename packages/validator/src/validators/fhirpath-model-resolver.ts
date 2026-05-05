/**
 * FHIRPath Model Resolver
 *
 * Maps FHIR version to the correct fhirpath.js model context.
 * Single source of truth — used by constraint-validator, sd-fhirpath-executor,
 * and custom-rule-executor instead of hardcoding fhirpath_r4.
 */

import fhirpath_r4 from 'fhirpath/fhir-context/r4/index.js';
import fhirpath_r5 from 'fhirpath/fhir-context/r5/index.js';

type FhirVersion = 'R4' | 'R5' | 'R6';

/**
 * Get the fhirpath.js model for a given FHIR version.
 * R6 uses the R5 model (no dedicated R6 model exists yet).
 */
export function getFhirPathModel(fhirVersion?: FhirVersion): any {
  switch (fhirVersion) {
    case 'R5':
    case 'R6':
      return fhirpath_r5;
    case 'R4':
    default:
      return fhirpath_r4;
  }
}
