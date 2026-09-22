/**
 * Evidence and conformance tooling surface for @records-fhir/validator.
 *
 * This subpath is for repository-owned quality gates, conformance runners,
 * parity harnesses, and package smoke tests. It keeps those tools off
 * internal source paths while making the non-product APIs explicit.
 */

export { RecordsValidator } from '../core/validator-engine.js';
export type { RecordsValidatorConfig, ValidationContext } from '../core/validator-engine.js';
export {
  issueToOperationOutcomeIssue,
  toOperationOutcome,
} from '../core/operation-outcome-converter.js';
export type {
  FhirOperationOutcome,
  FhirOperationOutcomeIssue,
} from '../core/operation-outcome-converter.js';
export { InvariantRegistry } from '../validators/invariant-registry.js';
export { ValueSetCache } from '../validators/valueset-cache.js';
export type { ServerExpansionEntry } from '../validators/valueset-cache.js';
export type {
  CodeSystem,
  TerminologyResolutionConfig,
  ValueSet,
} from '../validators/valueset-types.js';
export { setEngineLogger } from '../logger.js';
export type { EngineLogger } from '../logger.js';
export type {
  ValidationIssue,
  ValidationSettings,
} from '@records-fhir/validation-types';
