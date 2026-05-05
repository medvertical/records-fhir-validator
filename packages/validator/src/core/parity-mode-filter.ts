/**
 * Parity Mode Filter
 * 
 * Filters validation issues to match HAPI validator output.
 * Suppresses Records-specific warnings that HAPI doesn't report.
 * 
 * Use this when you need strict parity comparison with HAPI validator.
 */

import type { ValidationIssue } from '../types';
import { logger } from '../logger';

// ============================================================================
// Suppression Rules
// ============================================================================

/**
 * Issue codes that Records reports but HAPI typically doesn't.
 * These are filtered out in parity mode.
 */
const PARITY_SUPPRESSED_CODES = new Set([
    // Best practice warnings HAPI doesn't report
    'best-practice-identifier-summary',
    'best-practice-missing-identifier',
    'best-practice-meta-lastUpdated',
    'best-practice-meta-profile',
    'best-practice-contact-details',

    // Informational messages
    'informational-no-narrative',
    'informational-empty-extension',

    // Structural details HAPI skips
    'structural-validation-error:name',
    'structural-empty-array',
    'structural-null-value',

    // Metadata checks HAPI doesn't do
    'metadata-missing-lastUpdated',
    'metadata-missing-versionId',
    'metadata-missing-source',
]);

/**
 * Message patterns that indicate Records-only issues
 */
const PARITY_SUPPRESSED_PATTERNS = [
    /best practice/i,
    /consider adding/i,
    /recommended to include/i,
    /should have a value/i,
    /informational:/i,
];

/**
 * Paths that are checked more strictly by Records
 */
const PARITY_LENIENT_PATHS = new Set([
    'name',
    'identifier',
    'meta.lastUpdated',
    'meta.versionId',
    'meta.source',
    'text',
    'text.div',
]);

// ============================================================================
// Parity Mode Filter
// ============================================================================

export interface ParityModeOptions {
    /** Enable parity mode filtering */
    enabled: boolean;
    /** Suppress informational severity issues */
    suppressInformational?: boolean;
    /** Suppress best-practice warnings */
    suppressBestPractice?: boolean;
    /** Additional codes to suppress */
    additionalSuppressedCodes?: string[];
    /** Custom suppression function */
    customFilter?: (issue: ValidationIssue) => boolean;
}

export class ParityModeFilter {
    private options: ParityModeOptions;
    private suppressedCount = 0;

    constructor(options?: Partial<ParityModeOptions>) {
        this.options = {
            enabled: false,
            suppressInformational: true,
            suppressBestPractice: true,
            ...options
        };
    }

    /**
     * Configure parity mode
     */
    setOptions(options: Partial<ParityModeOptions>): void {
        this.options = { ...this.options, ...options };
    }

    /**
     * Enable parity mode
     */
    enable(): void {
        this.options.enabled = true;
        logger.debug('[ParityMode] Enabled');
    }

    /**
     * Disable parity mode
     */
    disable(): void {
        this.options.enabled = false;
        logger.debug('[ParityMode] Disabled');
    }

    /**
     * Check if parity mode is enabled
     */
    isEnabled(): boolean {
        return this.options.enabled;
    }

    /**
     * Filter issues for HAPI parity
     * Returns only issues that HAPI would also report
     */
    filter(issues: ValidationIssue[]): ValidationIssue[] {
        if (!this.options.enabled) {
            return issues;
        }

        this.suppressedCount = 0;
        const filtered = issues.filter(issue => !this.shouldSuppress(issue));

        if (this.suppressedCount > 0) {
            logger.debug(`[ParityMode] Suppressed ${this.suppressedCount} Records-only issues`);
        }

        return filtered;
    }

    /**
     * Get count of suppressed issues from last filter call
     */
    getSuppressedCount(): number {
        return this.suppressedCount;
    }

    /**
     * Check if an issue should be suppressed
     */
    private shouldSuppress(issue: ValidationIssue): boolean {
        // Custom filter first
        if (this.options.customFilter && this.options.customFilter(issue)) {
            this.suppressedCount++;
            return true;
        }

        // Check code
        if (issue.code && PARITY_SUPPRESSED_CODES.has(issue.code)) {
            this.suppressedCount++;
            return true;
        }

        // Check additional codes
        if (this.options.additionalSuppressedCodes?.includes(issue.code || '')) {
            this.suppressedCount++;
            return true;
        }

        // Suppress informational severity
        if (this.options.suppressInformational && issue.severity === 'information') {
            this.suppressedCount++;
            return true;
        }

        // Suppress best-practice issues
        if (this.options.suppressBestPractice) {
            if (issue.code?.startsWith('best-practice-')) {
                this.suppressedCount++;
                return true;
            }
        }

        // Check message patterns
        const message = issue.message || issue.customMessage || '';
        for (const pattern of PARITY_SUPPRESSED_PATTERNS) {
            if (pattern.test(message)) {
                this.suppressedCount++;
                return true;
            }
        }

        // Check lenient paths (only suppress info/warning on these paths)
        if (issue.severity !== 'error' && issue.severity !== 'fatal') {
            const pathBase = this.getPathBase(issue.path || '');
            if (PARITY_LENIENT_PATHS.has(pathBase)) {
                this.suppressedCount++;
                return true;
            }
        }

        return false;
    }

    /**
     * Get base path without array indices and resource type
     */
    private getPathBase(path: string): string {
        return path
            .replace(/\[[0-9]+\]/g, '')  // Remove array indices
            .replace(/^[A-Z][a-zA-Z]+\./, '');  // Remove resource type prefix
    }

    /**
     * Get parity filtering stats
     */
    getStats(): {
        enabled: boolean;
        suppressedCodes: number;
        suppressedPatterns: number;
        lenientPaths: number;
    } {
        return {
            enabled: this.options.enabled,
            suppressedCodes: PARITY_SUPPRESSED_CODES.size,
            suppressedPatterns: PARITY_SUPPRESSED_PATTERNS.length,
            lenientPaths: PARITY_LENIENT_PATHS.size,
        };
    }
}

// Singleton
export const parityModeFilter = new ParityModeFilter();

/**
 * Convenience function to filter issues in parity mode
 */
export function filterForParity(
    issues: ValidationIssue[],
    enable = true
): ValidationIssue[] {
    if (!enable) return issues;
    parityModeFilter.enable();
    return parityModeFilter.filter(issues);
}
