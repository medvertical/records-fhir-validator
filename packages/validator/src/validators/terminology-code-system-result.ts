import { rejectedCodeSystemDisplayResult, verifiedCodeSystemResult } from './code-system-validation-evidence.js';
import { logger } from '../logger.js';
import type { CodeSystemValidationResult } from './terminology-api-types.js';
import { extractTerminologyIssues, mapOperationOutcomeIssues } from './terminology-api-outcome.js';
import {
    getOperationOutcomeIssueValues,
    getParametersEntries,
    isTerminologyResponseRecord,
} from './terminology-response-utils.js';
import { terminologyTargetMetadata } from '../utils/sensitive-logging-metadata.js';
import { operationOutcomeCannotResolveBinding } from './terminology-parameters.js';

const SNOMED_SYSTEM = 'http://snomed.info/sct';

function resolutionMessage(message: string | undefined, fallback: string): string {
    return message?.trim() || fallback;
}

export function isSnomedNationalExtensionCode(code: string): boolean {
    if (!/^\d{10,}$/.test(code)) return false;
    return /1000\d{3}|1002\d{3}/.test(code);
}

export function buildSnomedNationalExtensionUnverifiedResult(
    code: string,
    system: string,
): CodeSystemValidationResult {
    return {
        valid: true,
        reason: 'national-extension-unverified',
        message:
            `SNOMED national-extension code '${code}' in '${system}' was not verified because ` +
            'the configured terminology server does not provide the required national edition',
    };
}

export function parseCodeSystemValidationParameters(
    parameters: unknown,
    code: string,
    system: string,
    options: { authoritativeSnomedEdition?: boolean } = {},
): CodeSystemValidationResult {
    const entries = getParametersEntries(parameters);
    if (!entries) {
        return {
            valid: false,
            reason: 'system-unresolvable',
            message: `Terminology server returned a malformed $validate-code response for '${code}' in '${system}'`,
        };
    }

    const resultParameters = entries.filter(parameter => parameter.name === 'result');
    const resultParam = resultParameters[0];
    const messageParam = entries.find(parameter => parameter.name === 'message');
    const issues = extractTerminologyIssues(parameters);
    if (typeof resultParam?.valueBoolean !== 'boolean' || operationOutcomeCannotResolveBinding(parameters)) {
        // The server's own account names what it lacked (an unknown SNOMED
        // release comes with the releases it does hold).
        const serverMessage = typeof messageParam?.valueString === 'string' && messageParam.valueString.trim()
            ? messageParam.valueString
            : undefined;
        return { valid: false, reason: 'system-unresolvable',
            message: resolutionMessage(
                serverMessage ?? issues[0]?.message,
                `Terminology server could not verify '${code}' in '${system}'`,
            ), ...(issues.length > 0 ? { issues } : {}) };
    }
    const inactiveParam = entries.find(parameter => parameter.name === 'inactive');
    const displayParam = entries.find(parameter => parameter.name === 'display');
    const hasDisplayMismatch = issues.some(issue => issue.code === 'invalid-display');

    if (resultParam?.valueBoolean === true) {
        logger.debug(
            '[TerminologyApiClient] CodeSystem validation succeeded',
            terminologyTargetMetadata(system, code),
        );
        const result: CodeSystemValidationResult = {
            valid: true,
            message: typeof messageParam?.valueString === 'string' ? messageParam.valueString : undefined,
            issues,
            inactive: inactiveParam?.valueBoolean === true,
            display: typeof displayParam?.valueString === 'string' ? displayParam.valueString : undefined,
        };
        return resultParameters.length === 1 ? verifiedCodeSystemResult(result) : result;
    }

    const errorMessage = typeof messageParam?.valueString === 'string'
        ? messageParam.valueString
        : `Unknown code '${code}' in CodeSystem '${system}'`;
    if (isSnomedNationalExtensionSystemCode(system, code)
        && options.authoritativeSnomedEdition !== true) {
        logger.debug(
            '[TerminologyApiClient] SNOMED national-extension code unverified; failing open',
            terminologyTargetMetadata(system, code),
        );
        return buildSnomedNationalExtensionUnverifiedResult(code, system);
    }
    logger.debug(
        '[TerminologyApiClient] CodeSystem validation failed',
        terminologyTargetMetadata(system, code),
    );
    const result: CodeSystemValidationResult = {
        valid: false,
        message: errorMessage,
        reason: hasDisplayMismatch ? 'display-mismatch' : 'code-unknown',
        issues,
        inactive: inactiveParam?.valueBoolean === true,
        display: typeof displayParam?.valueString === 'string' ? displayParam.valueString : undefined,
    };
    return resultParameters.length === 1 ? verifiedCodeSystemResult(result) : result;
}

export function isSnomedNationalExtensionSystemCode(system: string, code: string): boolean {
    return system === SNOMED_SYSTEM && isSnomedNationalExtensionCode(code);
}

export function operationOutcomeToCodeSystemResult(
    opOutcome: unknown,
    code: string,
    system: string,
): CodeSystemValidationResult {
    if (operationOutcomeCannotResolveBinding(opOutcome)) {
        const issues = mapOperationOutcomeIssues(opOutcome);
        return { valid: false, reason: 'system-unresolvable',
            message: resolutionMessage(issues[0]?.message, `Terminology server could not resolve CodeSystem '${system}'`),
            ...(issues.length > 0 ? { issues } : {}) };
    }
    const issueValues = getOperationOutcomeIssueValues(opOutcome);
    if (issueValues && issueValues.length > 0) {
        const issues = mapOperationOutcomeIssues(opOutcome);
        const msg = issues[0]?.message || `Unknown code '${code}' in CodeSystem '${system}'`;
        const result: CodeSystemValidationResult = {
            valid: false,
            message: msg,
            reason: issues.some(issue => issue.code === 'invalid-display') ? 'display-mismatch' : 'code-unknown',
            issues,
        };
        const rejectsDisplay = isTerminologyResponseRecord(opOutcome) && opOutcome.resourceType === 'OperationOutcome'
            && issueValues.some((issue, index) => {
                if (issues[index]?.code !== 'invalid-display' || !isTerminologyResponseRecord(issue)
                    || (issue.severity !== 'error' && issue.severity !== 'warning' && issue.severity !== 'fatal')
                    || !isTerminologyResponseRecord(issue.details) || !Array.isArray(issue.details.coding)) return false;
                const codes = issue.details.coding.flatMap(coding => isTerminologyResponseRecord(coding)
                    && coding.system === 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type'
                    && typeof coding.code === 'string' ? [coding.code] : []);
                return codes.length > 0 && codes.every(code => code === 'invalid-display');
            });
        return rejectsDisplay ? rejectedCodeSystemDisplayResult(result) : result;
    }

    return { valid: false, message: `Unknown code '${code}' in CodeSystem '${system}'` };
}
