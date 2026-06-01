/**
 * Fix Suggestions Catalog (Shared)
 *
 * Client-side lookup for validation fix suggestions.
 * Full catalog for tooltip display with structured why/fix/example/specUrl.
 *
 * Pattern: High Fidelity Presentation / Lean Data
 * - Backend sends only the code
 * - Frontend looks up structured suggestion locally
 *
 * The catalog data lives in focused modules under ./fix-suggestions/; this
 * file assembles them and exposes the lookup/format helpers. Existing
 * imports of `fix-suggestions` keep working unchanged.
 */

import type { FixSuggestion } from './fix-suggestions/types';
import { CATALOG_CORE } from './fix-suggestions/catalog-core';
import { CATALOG_REFERENCE_PROFILE } from './fix-suggestions/catalog-reference-profile';
import { CATALOG_INVARIANTS } from './fix-suggestions/catalog-invariants';
import { CATALOG_MISC } from './fix-suggestions/catalog-misc';
import { ASPECT_FALLBACKS, FIX_SUGGESTION_ALIASES } from './fix-suggestions/fallbacks';

export type { FixPatch, FixSuggestion } from './fix-suggestions/types';
export { ASPECT_FALLBACKS, FIX_SUGGESTION_ALIASES } from './fix-suggestions/fallbacks';

import type { FixPatch } from './fix-suggestions/types';

// ============================================================================
// Full Fix Suggestions Catalog
// ============================================================================

export const FixSuggestions: Record<string, FixSuggestion> = {
    ...CATALOG_CORE,
    ...CATALOG_REFERENCE_PROFILE,
    ...CATALOG_INVARIANTS,
    ...CATALOG_MISC,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get fix suggestion for a validation code.
 *
 * Resolution order:
 *   1. Exact match in `FixSuggestions`
 *   2. Alias match in `FIX_SUGGESTION_ALIASES` → `FixSuggestions`
 *   3. Prefix-stripping heuristic (e.g. `structural-foo` → `foo`)
 *   4. `undefined` (caller may then fall back to `getAspectFallback`)
 */
export function getFixSuggestion(code: string): FixSuggestion | undefined {
    if (!code) return undefined;

    const direct = FixSuggestions[code];
    if (direct) return direct;

    const aliased = FIX_SUGGESTION_ALIASES[code];
    if (aliased) {
        const suggestion = FixSuggestions[aliased];
        if (suggestion) return suggestion;
    }

    // Prefix-stripping heuristic: `structural-cardinality-min` → try
    // `cardinality-min` as a last resort. This is cheap and helps when
    // callers flip-flop between prefixed and unprefixed code naming.
    const dashIndex = code.indexOf('-');
    if (dashIndex > 0) {
        const suffix = code.slice(dashIndex + 1);
        const stripped = FixSuggestions[suffix];
        if (stripped) return stripped;
    }

    return undefined;
}

/**
 * Get a fallback suggestion based on aspect
 */
export function getAspectFallback(aspect: string | undefined): FixSuggestion | undefined {
    if (!aspect) return undefined;
    return ASPECT_FALLBACKS[aspect];
}

/**
 * Format fix suggestion as a single string for display
 */
export function formatFixSuggestion(code: string): string | undefined {
    const suggestion = getFixSuggestion(code);
    if (!suggestion) return undefined;

    let result = `**Why:** ${suggestion.why}\n**Fix:** ${suggestion.fix}`;
    if (suggestion.example) {
        result += `\n**Example:** ${suggestion.example}`;
    }
    return result;
}

/**
 * Resolve a patch template by interpolating {{key}} placeholders with values
 * from the issue's details object.
 *
 * Returns a new FixPatch with concrete values, or null if required
 * placeholders could not be resolved.
 */
export function resolvePatch(
    patch: FixPatch,
    details?: Record<string, unknown>,
): FixPatch | null {
    const interpolate = (template: string): string => {
        return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
            const val = details?.[key];
            if (val === undefined || val === null) return `{{${key}}}`;
            return typeof val === 'object' ? JSON.stringify(val) : String(val);
        });
    };

    const resolved: FixPatch = {
        action: patch.action,
        path: interpolate(patch.path),
    };
    if (patch.value !== undefined) {
        resolved.value = interpolate(patch.value);
    }

    // If any placeholder remains unresolved, the patch is incomplete
    const hasUnresolved = /\{\{\w+\}\}/.test(resolved.path)
        || (resolved.value !== undefined && /\{\{\w+\}\}/.test(resolved.value));
    return hasUnresolved ? null : resolved;
}
