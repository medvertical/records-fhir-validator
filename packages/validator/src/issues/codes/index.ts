/**
 * Validation Message Codes - Central Registry
 * 
 * Re-exports all validation codes from aspect-specific modules.
 * Provides utility functions for code resolution and metadata lookup.
 */

// Re-export types
export type { ValidationCodeMetadata } from './validation-code-types';

// Re-export aspect-specific codes
export { TerminologyCodes, type TerminologyCode } from './terminology-codes';
export { MetadataCodes, type MetadataCode } from './metadata-codes';
export { ReferenceCodes, type ReferenceCode } from './reference-codes';
export { StructuralCodes, type StructuralCode } from './structural-codes';
export { ProfileCodes, type ProfileCode } from './profile-codes';
export { BusinessRuleCodes, type BusinessRuleCode } from './business-rule-codes';

// Import for internal use
import { TerminologyCodes } from './terminology-codes';
import { MetadataCodes } from './metadata-codes';
import { ReferenceCodes } from './reference-codes';
import { StructuralCodes } from './structural-codes';
import { ProfileCodes } from './profile-codes';
import { BusinessRuleCodes } from './business-rule-codes';
import type { ValidationCodeMetadata } from './validation-code-types';

// ============================================================================
// Unified Validation Codes Registry
// ============================================================================

export const ValidationCodes = {
    ...TerminologyCodes,
    ...MetadataCodes,
    ...ReferenceCodes,
    ...StructuralCodes,
    ...ProfileCodes,
    ...BusinessRuleCodes,
} as const;

export type ValidationCode = keyof typeof ValidationCodes;

// ============================================================================
// Code Aliases (lazy import to avoid circular deps)
// ============================================================================

let _codeAliases: Record<string, string> | null = null;
let _loadingPromise: Promise<Record<string, string>> | null = null;

async function loadCodeAliases(): Promise<Record<string, string>> {
    if (_codeAliases) {
        return _codeAliases;
    }
    if (_loadingPromise) {
        return _loadingPromise;
    }
    // Dynamic ESM import to avoid circular dependency
    _loadingPromise = import('./code-aliases.js').then(mod => {
        _codeAliases = mod.CodeAliases;
        return _codeAliases!;
    });
    return _loadingPromise;
}

function getCodeAliases(): Record<string, string> {
    // Return cached aliases, or empty object if not yet loaded
    // Callers should use loadCodeAliases() for guaranteed availability
    return _codeAliases || {};
}

// Export for initialization
export { loadCodeAliases };

// Eagerly load aliases at module import time (fire-and-forget)
// This ensures aliases are available by the time validation runs
loadCodeAliases().catch(() => {
    // Silently ignore errors during eager loading - will be retried on use
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Resolves a code to its canonical form, handling aliases.
 * Returns the original code if no alias exists.
 */
export function resolveCode(code: string): ValidationCode | string {
    const aliases = getCodeAliases();
    return aliases[code] || code;
}

/**
 * Gets metadata for a code, resolving aliases if necessary.
 */
export function getCodeMetadata(code: string): ValidationCodeMetadata | undefined {
    const resolved = resolveCode(code);
    return ValidationCodes[resolved as ValidationCode];
}

/**
 * Checks if a code is a known validation code (or alias).
 */
export function isKnownCode(code: string): boolean {
    const aliases = getCodeAliases();
    return code in ValidationCodes || code in aliases;
}
