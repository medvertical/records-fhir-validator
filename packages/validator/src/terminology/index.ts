/**
 * Terminology Boundary
 *
 * Single re-export point for terminology-side helpers consumed by the
 * records-validator engine. Re-exports:
 *   - `CircuitBreaker` from `server/terminology/` (HTTP retry policy
 *     for terminology server calls)
 *   - FHIR type-mapping helpers from `engine/terminology/utils/`
 *     (primitive vs. complex classification, FHIRPath ↔ FHIR mapping)
 *
 * Other terminology primitives the engine needs (`ValueSetCache`,
 * `TerminologyResolutionConfig`) live inside the records-validator
 * subtree already and don't need this boundary.
 *
 * When the engine ships standalone, this file becomes the physical
 * home of these helpers and the server-side imports flip to point
 * here.
 */

export { CircuitBreaker } from './circuit-breaker';
export type {
    CircuitState,
    CircuitBreakerConfig,
    CircuitBreakerState,
    CircuitBreakerStats,
} from './circuit-breaker';

export {
    isFhirPrimitive,
    isFhirPathTypeUrl,
    fhirPathToFhirPrimitive,
    fhirPathToAllFhirPrimitives,
    normalizeFhirType,
    getTypeCategory,
    areTypesEquivalent,
    matchesAnyType,
    getTypeDescription,
    getNormalizedTypeList,
} from './fhir-type-mapper';
