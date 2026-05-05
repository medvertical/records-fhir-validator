/**
 * Reference Validator Boundary
 *
 * Re-exports the reference-validation subsystem. The implementations
 * live next to this file — physical extraction from
 * `server/services/validation/engine/reference/` happened during the
 * engine-extraction work. This index file is what other engine
 * modules and the server's per-aspect dispatcher import.
 */

export { ReferenceValidator } from './reference-validator-refactored';
export {
    BundleReferenceResolver,
    getBundleReferenceResolver,
    resetBundleReferenceResolver,
} from './bundle-reference-resolver';
export type {
    BundleEntry,
    BundleReferenceResolutionResult,
    BundleValidationResult,
} from './bundle-reference-resolver';

// Lower-level validators / helpers for callers that compose the
// reference subsystem at a finer grain than `ReferenceValidator`.
export { BatchedReferenceChecker, getBatchedReferenceChecker } from './batched-reference-checker';
export { ContainedReferenceResolver, getContainedReferenceResolver } from './contained-reference-resolver';
export { RecursiveReferenceValidator, getRecursiveReferenceValidator } from './recursive-reference-validator';
export { CanonicalReferenceValidator, getCanonicalReferenceValidator } from './canonical-reference-validator';
export { ReferenceTypeConstraintValidator, getReferenceTypeConstraintValidator } from './reference-type-constraint-validator';
export { VersionSpecificReferenceValidator, getVersionSpecificReferenceValidator } from './version-specific-reference-validator';
export { CircularReferenceDetector, getCircularReferenceDetector } from './circular-reference-detector';
export { ReferenceTypeExtractor } from './reference-type-extractor';
export { validateReferenceFormat, extractReferences } from './reference-format-validator';
export { initializeReferenceFields, getReferenceFields } from './reference-field-definitions';
export { createReferenceValidationIssue, getFieldValue } from './reference-utils';
