/**
 * Validation Fix Suggestions
 *
 * Re-exports from the canonical shared catalog.
 * The full catalog lives in shared/fix-suggestions.ts to avoid duplication
 * between the server and client.
 */

export {
    type FixSuggestion,
    FixSuggestions,
    getFixSuggestion,
    formatFixSuggestion,
} from '@records-fhir/validation-types/fix-suggestions';
