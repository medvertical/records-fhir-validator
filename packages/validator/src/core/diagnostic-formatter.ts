import type { ValidationIssue } from '@records-fhir/validation-types';
import {
    isErrorValidationSeverity,
    isInformationValidationSeverity,
} from '@records-fhir/validation-types';
import { getFixSuggestion } from '../issues/index.js';
import { buildJsonSourceMap, type JsonSourceMap } from './json-source-map.js';

export interface LSPDiagnostic {
    severity: 1 | 2 | 3 | 4;
    range: { start: LSPPosition; end: LSPPosition };
    message: string;
    source: string;
    code?: string;
    codeDescription?: { href: string };
    relatedInformation?: LSPRelatedInfo[];
    tags?: number[];
    data?: Record<string, unknown>;
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
    title: string;
    kind: 'quickfix' | 'refactor' | 'source';
    diagnosticCode: string;
    edit?: { path: string; newValue: unknown };
    command?: { command: string; arguments: unknown[] };
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

export function fhirPathToJsonPath(fhirPath: string): string {
    if (!fhirPath) return '';

    let path = fhirPath.replace(/^[A-Z][A-Za-z0-9]*(\.|$)/, '');
    path = path.replace(/\[(\d+)\]/g, '/$1');
    path = path.replace(/\./g, '/');
    return path.replace(/^\/+|\/+$/g, '');
}

export class DiagnosticFormatter {
    private specBaseUrl: string = 'https://www.hl7.org/fhir';
    private currentSourceMap: JsonSourceMap | null = null;

    setSpecBaseUrl(url: string): void {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new TypeError('FHIR specification URL must use HTTP or HTTPS');
        }
        this.specBaseUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
    }

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

    private issueToLSP(
        issue: ValidationIssue,
        _documentUri?: string,
    ): LSPDiagnostic {
        const severity = SEVERITY_TO_LSP[issue.severity || 'error'] || 1;

        const range = this.pathToRange(issue.path || '');

        const diagnostic: LSPDiagnostic = {
            severity,
            range,
            message: issue.message || 'Validation error',
            source: 'fhir-validator',
            code: issue.code,
        };

        if (issue.code) {
            const specUrl = this.getSpecUrl(issue.code, issue.resourceType);
            if (specUrl) {
                diagnostic.codeDescription = { href: specUrl };
            }
        }

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

        return {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        };
    }

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
            if (!/^[A-Za-z][A-Za-z0-9]*$/.test(resourceType)) return undefined;
            return `${this.specBaseUrl}/${resourceType.toLowerCase()}.html`;
        }
        return undefined;
    }

    generateQuickFixes(issues: ValidationIssue[]): QuickFix[] {
        const fixes: QuickFix[] = [];

        for (const issue of issues) {
            const suggestion = getFixSuggestion(issue.code || '');
            if (!suggestion) continue;

            const fix = this.createQuickFix(issue, suggestion);
            if (fix) {
                fixes.push(fix);
            }
        }

        return fixes;
    }

    private createQuickFix(issue: ValidationIssue, suggestion: { fix: string; example?: string }): QuickFix | null {
        const code = issue.code || '';

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

        return {
            title: suggestion.fix.substring(0, 50) + '...',
            kind: 'quickfix',
            diagnosticCode: code,
        };
    }

    toCLISummary(resource: unknown, issues: ValidationIssue[]): CLISummary {
        const errors = issues.filter(i => isErrorValidationSeverity(i.severity)).length;
        const warnings = issues.filter(i => i.severity === 'warning').length;
        const information = issues.filter(i => isInformationValidationSeverity(i.severity)).length;

        return {
            resourceType: getResourceString(resource, 'resourceType') || 'Unknown',
            resourceId: getResourceString(resource, 'id'),
            totalIssues: issues.length,
            errors,
            warnings,
            information,
            isValid: errors === 0,
            issues: issues.map(i => this.issueToCLI(i))
        };
    }

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

    formatCLISummary(summary: CLISummary): string {
        const lines: string[] = [];

        const status = summary.isValid ? '✅ VALID' : '❌ INVALID';
        lines.push(`\n${status} ${summary.resourceType}${summary.resourceId ? `/${summary.resourceId}` : ''}`);
        lines.push(`   Errors: ${summary.errors} | Warnings: ${summary.warnings} | Info: ${summary.information}`);
        lines.push('');

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

    formatBatchReport(results: ReadonlyMap<unknown, ValidationIssue[]>): string {
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
                for (const issue of summary.issues.filter(i => isErrorValidationSeverity(i.severity)).slice(0, 3)) {
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

function getResourceString(resource: unknown, field: string): string | undefined {
    if (typeof resource !== 'object' || resource === null || Array.isArray(resource)) {
        return undefined;
    }
    const value = (resource as Record<string, unknown>)[field];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
