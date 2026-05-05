/**
 * Diagnostic Formatter
 *
 * Enhanced formatting for validation diagnostics:
 * - LSP (Language Server Protocol) compatible output
 * - JSON path highlighting for IDE integration
 * - Quick fix suggestions with code actions
 * - CLI-friendly summary reports
 *
 * Provides machine-readable output for tooling integration.
 */

import type { ValidationIssue } from '../types';
import { getFixSuggestion } from '../issues';
import { buildJsonSourceMap, type JsonSourceMap } from './json-source-map';

// ============================================================================
// Types
// ============================================================================

export interface LSPDiagnostic {
    /** Severity: 1=Error, 2=Warning, 3=Information, 4=Hint */
    severity: 1 | 2 | 3 | 4;
    /** Range in the document */
    range: { start: LSPPosition; end: LSPPosition };
    /** Error message */
    message: string;
    /** Source identifier */
    source: string;
    /** Error code */
    code?: string;
    /** Code description with href */
    codeDescription?: { href: string };
    /** Related information */
    relatedInformation?: LSPRelatedInfo[];
    /** Tags (deprecated, unnecessary) */
    tags?: number[];
    /** Data for code actions */
    data?: any;
}

export interface LSPPosition {
    line: number;
    character: number;
}

export interface LSPRelatedInfo {
    location: { uri: string; range: { start: LSPPosition; end: LSPPosition } };
    message: string;
}

export interface QuickFix {
    /** Title shown in IDE */
    title: string;
    /** Kind of fix (quickfix, refactor, etc.) */
    kind: 'quickfix' | 'refactor' | 'source';
    /** Diagnostic this fix applies to */
    diagnosticCode: string;
    /** Edit to apply */
    edit?: { path: string; newValue: any };
    /** Command to execute */
    command?: { command: string; arguments: any[] };
}

export interface CLISummary {
    resourceType: string;
    resourceId?: string;
    totalIssues: number;
    errors: number;
    warnings: number;
    information: number;
    isValid: boolean;
    issues: CLIIssue[];
}

export interface CLIIssue {
    severity: string;
    path: string;
    code: string;
    message: string;
    fix?: string;
}

// ============================================================================
// Severity Mapping
// ============================================================================

const SEVERITY_TO_LSP: Record<string, 1 | 2 | 3 | 4> = {
    'error': 1,
    'fatal': 1,
    'warning': 2,
    'information': 3,
    'info': 3,
    'hint': 4,
};

const SEVERITY_EMOJI: Record<string, string> = {
    'error': '❌',
    'fatal': '💀',
    'warning': '⚠️',
    'information': 'ℹ️',
    'info': 'ℹ️',
};

// ============================================================================
// FHIR Path → JSON Path Conversion
// ============================================================================

/**
 * Convert a FHIR path expression to a JSON-Pointer-style path the source map
 * can resolve. Examples:
 *   `Patient.name[0].given[1]`    → `name/0/given/1`
 *   `Observation.component[2].code` → `component/2/code`
 *   `Bundle.entry[3].resource.id` → `entry/3/resource/id`
 *
 * The leading resource type is stripped because the parsed JSON document is
 * the resource itself (e.g. the root object is the Patient, not a wrapper).
 */
export function fhirPathToJsonPath(fhirPath: string): string {
    if (!fhirPath) return '';

    // Drop any leading resource type segment: `Patient.name` → `name`
    let path = fhirPath.replace(/^[A-Z][A-Za-z0-9]*(\.|$)/, '');

    // Convert `foo[3]` → `foo/3`
    path = path.replace(/\[(\d+)\]/g, '/$1');

    // Convert remaining `.` segment separators → `/`
    path = path.replace(/\./g, '/');

    // Trim stray leading/trailing slashes
    return path.replace(/^\/+|\/+$/g, '');
}

// ============================================================================
// Diagnostic Formatter Class
// ============================================================================

export class DiagnosticFormatter {
    private specBaseUrl: string = 'https://www.hl7.org/fhir';
    private currentSourceMap: JsonSourceMap | null = null;

    /**
     * Set base URL for FHIR spec links
     */
    setSpecBaseUrl(url: string): void {
        this.specBaseUrl = url;
    }

    // ==========================================================================
    // LSP Format
    // ==========================================================================

    /**
     * Convert validation issues to LSP diagnostics.
     *
     * Pass `jsonSource` (the raw JSON text the resource was parsed from) to
     * enable accurate line/character ranges. Without it, ranges default to
     * line 0 (the legacy behaviour, kept for backward compatibility).
     *
     * The active source map is saved/restored around the call so nested
     * invocations of the formatter do not leak state between documents.
     */
    toLSPDiagnostics(
        issues: ValidationIssue[],
        documentUri?: string,
        jsonSource?: string,
    ): LSPDiagnostic[] {
        const previousMap = this.currentSourceMap;
        this.currentSourceMap = jsonSource ? buildJsonSourceMap(jsonSource) : null;
        try {
            return issues.map(issue => this.issueToLSP(issue, documentUri));
        } finally {
            this.currentSourceMap = previousMap;
        }
    }

    /**
     * Convert single issue to LSP format
     */
    private issueToLSP(
        issue: ValidationIssue,
        _documentUri?: string,
    ): LSPDiagnostic {
        const severity = SEVERITY_TO_LSP[issue.severity || 'error'] || 1;

        // Resolve the FHIR path to an LSP range using the active source map
        // (if any). When no source map is available we fall back to line 0.
        const range = this.pathToRange(issue.path || '');

        const diagnostic: LSPDiagnostic = {
            severity,
            range,
            message: issue.message || 'Validation error',
            source: 'fhir-validator',
            code: issue.code,
        };

        // Add code description with spec link
        if (issue.code) {
            const specUrl = this.getSpecUrl(issue.code, issue.resourceType);
            if (specUrl) {
                diagnostic.codeDescription = { href: specUrl };
            }
        }

        // Add data for code actions
        const fix = getFixSuggestion(issue.code || '');
        if (fix) {
            diagnostic.data = {
                quickFix: fix,
                path: issue.path,
                resourceType: issue.resourceType,
            };
        }

        return diagnostic;
    }

    /**
     * Convert a FHIR path (e.g. `Patient.name[0].given[1]`) to an LSP range.
     *
     * When a source map is active (populated by `toLSPDiagnostics` with a
     * `jsonSource` argument) this resolves the actual line/character position
     * by walking the JSON token positions. If no source map is available, or
     * the path cannot be resolved, the range falls back to line 0 so callers
     * still receive a valid LSP diagnostic.
     */
    private pathToRange(path: string): { start: LSPPosition; end: LSPPosition } {
        if (!path) {
            return {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
            };
        }

        if (this.currentSourceMap) {
            const jsonPath = fhirPathToJsonPath(path);
            const range = this.currentSourceMap.lookup(jsonPath);
            if (range) {
                return {
                    start: { line: range.start.line, character: range.start.character },
                    end: { line: range.end.line, character: range.end.character },
                };
            }
        }

        // No source map (or path not found) → return line 0 as a safe default
        return {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        };
    }

    /**
     * Get FHIR spec URL for a code
     */
    private getSpecUrl(code: string, resourceType?: string): string | undefined {
        if (code.startsWith('structural-')) {
            return `${this.specBaseUrl}/validation.html`;
        }
        if (code.startsWith('terminology-')) {
            return `${this.specBaseUrl}/terminologies.html`;
        }
        if (code.startsWith('profile-')) {
            return `${this.specBaseUrl}/profiling.html`;
        }
        if (resourceType) {
            return `${this.specBaseUrl}/${resourceType.toLowerCase()}.html`;
        }
        return undefined;
    }

    // ==========================================================================
    // Quick Fixes
    // ==========================================================================

    /**
     * Generate quick fixes for issues
     */
    generateQuickFixes(issues: ValidationIssue[]): QuickFix[] {
        const fixes: QuickFix[] = [];

        for (const issue of issues) {
            const suggestion = getFixSuggestion(issue.code || '');
            if (!suggestion) continue;

            // Generate fix based on code type
            const fix = this.createQuickFix(issue, suggestion);
            if (fix) {
                fixes.push(fix);
            }
        }

        return fixes;
    }

    /**
     * Create a quick fix for an issue
     */
    private createQuickFix(issue: ValidationIssue, suggestion: { fix: string; example?: string }): QuickFix | null {
        const code = issue.code || '';

        // Common quick fixes
        if (code === 'structural-required-element-missing') {
            return {
                title: `Add required element`,
                kind: 'quickfix',
                diagnosticCode: code,
                command: {
                    command: 'fhir.addElement',
                    arguments: [issue.path, null]
                }
            };
        }

        if (code.includes('missing-type')) {
            return {
                title: 'Add Bundle.type',
                kind: 'quickfix',
                diagnosticCode: code,
                edit: { path: 'Bundle.type', newValue: 'collection' }
            };
        }

        // Generic fix with suggestion
        return {
            title: suggestion.fix.substring(0, 50) + '...',
            kind: 'quickfix',
            diagnosticCode: code,
        };
    }

    // ==========================================================================
    // CLI Format
    // ==========================================================================

    /**
     * Generate CLI summary for validation results
     */
    toCLISummary(resource: any, issues: ValidationIssue[]): CLISummary {
        const errors = issues.filter(i => i.severity === 'error').length;
        const warnings = issues.filter(i => i.severity === 'warning').length;
        const information = issues.filter(i => i.severity === 'info').length;

        return {
            resourceType: resource?.resourceType || 'Unknown',
            resourceId: resource?.id,
            totalIssues: issues.length,
            errors,
            warnings,
            information,
            isValid: errors === 0,
            issues: issues.map(i => this.issueToCLI(i))
        };
    }

    /**
     * Convert issue to CLI format
     */
    private issueToCLI(issue: ValidationIssue): CLIIssue {
        const suggestion = getFixSuggestion(issue.code || '');

        return {
            severity: issue.severity || 'error',
            path: issue.path || '',
            code: issue.code || 'unknown',
            message: issue.message || '',
            fix: suggestion?.fix
        };
    }

    /**
     * Format CLI summary as string
     */
    formatCLISummary(summary: CLISummary): string {
        const lines: string[] = [];

        // Header
        const status = summary.isValid ? '✅ VALID' : '❌ INVALID';
        lines.push(`\n${status} ${summary.resourceType}${summary.resourceId ? `/${summary.resourceId}` : ''}`);
        lines.push(`   Errors: ${summary.errors} | Warnings: ${summary.warnings} | Info: ${summary.information}`);
        lines.push('');

        // Issues
        for (const issue of summary.issues) {
            const emoji = SEVERITY_EMOJI[issue.severity] || '•';
            lines.push(`${emoji} [${issue.code}] ${issue.path}`);
            lines.push(`   ${issue.message}`);
            if (issue.fix) {
                lines.push(`   💡 Fix: ${issue.fix}`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Format batch validation as CLI report
     */
    formatBatchReport(results: Map<any, ValidationIssue[]>): string {
        const lines: string[] = [];
        let totalErrors = 0;
        let totalWarnings = 0;
        let totalValid = 0;

        lines.push('\n╔════════════════════════════════════════════════════════════╗');
        lines.push('║           FHIR Validation Report                           ║');
        lines.push('╚════════════════════════════════════════════════════════════╝\n');

        for (const [resource, issues] of results) {
            const summary = this.toCLISummary(resource, issues);

            if (summary.isValid) {
                totalValid++;
                lines.push(`✅ ${summary.resourceType}/${summary.resourceId || '?'}`);
            } else {
                lines.push(`❌ ${summary.resourceType}/${summary.resourceId || '?'} (${summary.errors} errors)`);
                for (const issue of summary.issues.filter(i => i.severity === 'error').slice(0, 3)) {
                    lines.push(`   • ${issue.message.substring(0, 60)}...`);
                }
            }

            totalErrors += summary.errors;
            totalWarnings += summary.warnings;
        }

        lines.push('\n────────────────────────────────────────────────────────────');
        lines.push(`Total: ${results.size} resources | Valid: ${totalValid} | Errors: ${totalErrors} | Warnings: ${totalWarnings}`);
        lines.push('');

        return lines.join('\n');
    }
}

// Singleton
export const diagnosticFormatter = new DiagnosticFormatter();
