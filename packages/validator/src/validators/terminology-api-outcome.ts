import type { CodeSystemValidationIssue } from './terminology-api-types';

function normalizeOutcomeSeverity(severity: unknown): CodeSystemValidationIssue['severity'] {
    if (severity === 'error' || severity === 'warning' || severity === 'information') return severity;
    if (severity === 'fatal') return 'error';
    if (severity === 'info') return 'information';
    return 'warning';
}

function extractIssueCode(issue: any): string {
    const codingCode = issue?.details?.coding?.find((coding: any) =>
        coding?.system === 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type' &&
        typeof coding?.code === 'string'
    )?.code;
    if (codingCode) return codingCode;
    if (typeof issue?.code === 'string') return issue.code;
    return 'terminology-issue';
}

export function mapOperationOutcomeIssues(outcome: any): CodeSystemValidationIssue[] {
    if (!outcome || outcome.resourceType !== 'OperationOutcome' || !Array.isArray(outcome.issue)) {
        return [];
    }

    return outcome.issue.map((issue: any) => ({
        severity: normalizeOutcomeSeverity(issue?.severity),
        code: extractIssueCode(issue),
        message: issue?.details?.text || issue?.diagnostics || 'Terminology server reported a code issue',
        ...(Array.isArray(issue?.expression) ? { expression: issue.expression } : {}),
    }));
}

export function extractTerminologyIssues(parameters: any): CodeSystemValidationIssue[] {
    const issuesResource = parameters?.parameter?.find((p: any) => p?.name === 'issues')?.resource;
    return mapOperationOutcomeIssues(issuesResource);
}
