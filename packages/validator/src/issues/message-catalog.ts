/**
 * Validation Message Catalog
 *
 * Central registry of all validation message codes with metadata.
 * 
 * REFACTORED: This file now re-exports from the modular codes/ directory.
 * The codes are organized by aspect for better maintainability.
 * 
 * @see ./codes/index.ts for the implementation
 */

// Re-export types
export type {
    ValidationCodeMetadata,
    ValidationCode,
    TerminologyCode,
    MetadataCode,
    ReferenceCode,
    StructuralCode,
    ProfileCode,
    BusinessRuleCode,
} from './codes/index';

// Re-export values
export {
    // Unified registry
    ValidationCodes,

    // Aspect-specific codes
    TerminologyCodes,
    MetadataCodes,
    ReferenceCodes,
    StructuralCodes,
    ProfileCodes,
    BusinessRuleCodes,

    // Utility functions
    resolveCode,
    getCodeMetadata,
    isKnownCode,
} from './codes/index';

// Re-export aliases for backwards compatibility
export { CodeAliases } from './codes/code-aliases';
