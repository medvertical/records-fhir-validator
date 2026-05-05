/**
 * FHIRPath Version Context
 * ------------------------
 *
 * Centralises the fhirpath.js model-context import for R4, R5, and
 * (future) R6. Every file that compiles FHIRPath expressions should
 * call `getFhirPathModel(fhirVersion)` instead of hard-importing
 * `fhirpath/fhir-context/r4`.
 *
 * R6 currently falls back to R5 since fhirpath.js does not ship an
 * R6 context yet. Once it does, add the import here.
 */

import fhirpath_r4 from 'fhirpath/fhir-context/r4/index.js';
import fhirpath_r5 from 'fhirpath/fhir-context/r5/index.js';

/**
 * Return the fhirpath.js model context for a given FHIR version.
 */
export function getFhirPathModel(fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): any {
  switch (fhirVersion) {
    case 'R5':
      return fhirpath_r5;
    case 'R6':
      // R6 is still draft; fhirpath.js doesn't ship an R6 context.
      // Fall back to R5 which is the closest ancestor.
      return fhirpath_r5;
    case 'R4':
    default:
      return fhirpath_r4;
  }
}
