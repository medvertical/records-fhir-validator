import type { FHIRPathTerminologyResolver } from './fhirpath-async-terminology.js';
import type { FHIRPathBundleInput } from './fhirpath-functions.js';
import type { ReferenceResolver } from './slice-types.js';

export interface SDFHIRPathEvaluationScope {
  bundle?: FHIRPathBundleInput;
  fhirVersion: 'R4' | 'R5' | 'R6';
  profileUrl?: string;
  resource: unknown;
  resourceType: string;
  rootResource: unknown;
  /** %resource where it is not found along the element's own path. */
  focusResource?: unknown;
  terminologyResolver?: FHIRPathTerminologyResolver;
  userInvocationTable: unknown;
  referenceResolver?: ReferenceResolver | null;
}
