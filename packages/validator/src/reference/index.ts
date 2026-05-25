/**
 * Reference Validator Boundary
 *
 * Re-exports the reference-validation subsystem. The implementations
 * live next to this file. This index file is the public boundary for
 * package, server, and tests that compose reference validation.
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
export { BatchedReferenceChecker, getBatchedReferenceChecker, resetBatchedReferenceChecker } from './batched-reference-checker';
export { ContainedReferenceResolver, getContainedReferenceResolver, resetContainedReferenceResolver } from './contained-reference-resolver';
export {
    RecursiveReferenceValidator,
    getRecursiveReferenceValidator,
    resetRecursiveReferenceValidator,
    type RecursiveValidationConfig,
} from './recursive-reference-validator';
export { CanonicalReferenceValidator, getCanonicalReferenceValidator, resetCanonicalReferenceValidator } from './canonical-reference-validator';
export {
    ReferenceTypeConstraintValidator,
    getReferenceTypeConstraintValidator,
    resetReferenceTypeConstraintValidator,
} from './reference-type-constraint-validator';
export {
    VersionSpecificReferenceValidator,
    getVersionSpecificReferenceValidator,
    resetVersionSpecificReferenceValidator,
} from './version-specific-reference-validator';
export { CircularReferenceDetector, getCircularReferenceDetector, resetCircularReferenceDetector } from './circular-reference-detector';
export {
    ReferenceTypeExtractor,
    extractResourceType,
    parseReference,
    isValidReference,
    getKnownResourceTypes,
} from './reference-type-extractor';
export { validateReferenceFormat, extractReferences } from './reference-format-validator';
export { initializeReferenceFields, getReferenceFields } from './reference-field-definitions';
export { createReferenceValidationIssue, getFieldValue } from './reference-utils';
