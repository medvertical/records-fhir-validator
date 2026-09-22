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

export function extractTerminologyIssues(parameters: unknown): CodeSystemValidationIssue[] {
    const entries = getParametersEntries(parameters);
    const issuesResource = entries?.find(parameter => parameter.name === 'issues')?.resource;
    return mapOperationOutcomeIssues(issuesResource);
}
