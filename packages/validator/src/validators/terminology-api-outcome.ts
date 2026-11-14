import type { CodeSystemValidationIssue } from './terminology-api-types.js';
import {
    getNestedString,
    getOperationOutcomeIssueValues,
    getParametersEntries,
    isTerminologyResponseRecord,
} from './terminology-response-utils.js';

function normalizeOutcomeSeverity(severity: unknown): CodeSystemValidationIssue['severity'] {
    if (severity === 'error' || severity === 'warning' || severity === 'information') return severity;
    if (severity === 'fatal') return 'error';
    if (severity === 'info') return 'information';
    return 'warning';
}

function extractIssueCode(issue: unknown): string {
    const details = isTerminologyResponseRecord(issue) && isTerminologyResponseRecord(issue.details)
        ? issue.details
        : null;
    const coding = details && Array.isArray(details.coding) ? details.coding : [];
    const codingCode = coding.find(candidate =>
        isTerminologyResponseRecord(candidate) &&
        candidate.system === 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type' &&
        typeof candidate.code === 'string'
    );
    if (isTerminologyResponseRecord(codingCode) && typeof codingCode.code === 'string') {
        return codingCode.code;
    }
    if (isTerminologyResponseRecord(issue) && typeof issue.code === 'string') return issue.code;
    return 'terminology-issue';
}

export function mapOperationOutcomeIssues(outcome: unknown): CodeSystemValidationIssue[] {
    const issueValues = getOperationOutcomeIssueValues(outcome);
    if (!issueValues) return [];

    return issueValues.map(issue => ({
        severity: normalizeOutcomeSeverity(
            isTerminologyResponseRecord(issue) ? issue.severity : undefined,
        ),
        code: extractIssueCode(issue),
        message:
            getNestedString(issue, 'details', 'text') ||
            getNestedString(issue, 'diagnostics') ||
            'Terminology server reported a code issue',
        ...(isTerminologyResponseRecord(issue) && Array.isArray(issue.expression)
            ? { expression: issue.expression.filter((value): value is string => typeof value === 'string') }
            : {}),
    }));
}

/** HTTP errors may describe the operation itself; only explicit code diagnostics reject a coding. */
export function operationOutcomeHasRejection(outcome: unknown, codes: readonly string[]): boolean {
    const issues = getOperationOutcomeIssueValues(outcome);
    if (!issues?.length || !isTerminologyResponseRecord(outcome) || outcome.implicitRules !== undefined
        || outcome.modifierExtension !== undefined || issues.some(issue => !isTerminologyResponseRecord(issue)
            || !['error', 'fatal', 'warning', 'information'].includes(String(issue.severity))
            || typeof issue.code !== 'string' || !issue.code.trim() || issue.modifierExtension !== undefined)) return false;
    return issues.some(issue => {
        if (!isTerminologyResponseRecord(issue)) return false;
        const code = extractIssueCode(issue);
        const details = isTerminologyResponseRecord(issue.details) ? issue.details : undefined;
        const types = Array.isArray(details?.coding) ? details.coding.filter(coding =>
            isTerminologyResponseRecord(coding) && coding.system === 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type') : [];
        if (types.some(coding => !isTerminologyResponseRecord(coding) || coding.code !== code)
            || code === 'invalid-display' && types.length === 0) return false;
        return codes.includes(code) && (issue.severity === 'error' || issue.severity === 'fatal'
            || code === 'invalid-display' && issue.severity === 'warning');
    });
}

export function extractTerminologyIssues(parameters: unknown): CodeSystemValidationIssue[] {
    const entries = getParametersEntries(parameters);
    const issuesResource = entries?.find(parameter => parameter.name === 'issues')?.resource;
    return mapOperationOutcomeIssues(issuesResource);
}
