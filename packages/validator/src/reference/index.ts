/**
 * Reference Validator Boundary
 *
 * Re-exports the reference-validation subsystem. The implementations
 * live next to this file. This index file is the public boundary for
 * package, server, and tests that compose reference validation.
 */

export { ReferenceValidator } from './reference-validator-refactored.js';
export {
    BundleReferenceResolver,
    getBundleReferenceResolver,
    resetBundleReferenceResolver,
} from './bundle-reference-resolver.js';
export type {
    BundleEntry,
    BundleReferenceResolutionResult,
    BundleValidationResult,
} from './bundle-reference-types.js';

// Lower-level validators / helpers for callers that compose the
// reference subsystem at a finer grain than `ReferenceValidator`.
export { BatchedReferenceChecker, getBatchedReferenceChecker, resetBatchedReferenceChecker } from './batched-reference-checker.js';
export { ContainedReferenceResolver, getContainedReferenceResolver, resetContainedReferenceResolver } from './contained-reference-resolver.js';
export {
    RecursiveReferenceValidator,
    getRecursiveReferenceValidator,
    resetRecursiveReferenceValidator,
    type RecursiveValidationConfig,
} from './recursive-reference-validator.js';
export { CanonicalReferenceValidator, getCanonicalReferenceValidator, resetCanonicalReferenceValidator } from './canonical-reference-validator.js';
export {
    ReferenceTypeConstraintValidator,
    getReferenceTypeConstraintValidator,
    resetReferenceTypeConstraintValidator,
} from './reference-type-constraint-validator.js';
export {
    VersionSpecificReferenceValidator,
    getVersionSpecificReferenceValidator,
    resetVersionSpecificReferenceValidator,
} from './version-specific-reference-validator.js';
export { CircularReferenceDetector, getCircularReferenceDetector, resetCircularReferenceDetector } from './circular-reference-detector.js';
export {
    ReferenceTypeExtractor,
    extractResourceType,
    parseReference,
    isValidReference,
    getKnownResourceTypes,
} from './reference-type-extractor.js';
export { validateReferenceFormat, extractReferences } from './reference-format-validator.js';
export { initializeReferenceFields, getReferenceFields } from './reference-field-definitions.js';
export { createReferenceValidationIssue, getFieldValue } from './reference-utils.js';
