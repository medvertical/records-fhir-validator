import { logger } from '../logger';
import type { CodeSystemValidationResult } from './terminology-api-types';
import { extractTerminologyIssues, mapOperationOutcomeIssues } from './terminology-api-outcome';

const SNOMED_SYSTEM = 'http://snomed.info/sct';

export function isSnomedNationalExtensionCode(code: string): boolean {
    if (!/^\d{10,}$/.test(code)) return false;
    return /1000\d{3}|1002\d{3}/.test(code);
}

export function parseCodeSystemValidationParameters(
    parameters: any,
    code: string,
    system: string,
): CodeSystemValidationResult {
    if (parameters.resourceType !== 'Parameters' || !parameters.parameter) {
        return { valid: true };
    }

    const resultParam = parameters.parameter.find((p: any) => p.name === 'result');
    const messageParam = parameters.parameter.find((p: any) => p.name === 'message');
    const inactiveParam = parameters.parameter.find((p: any) => p.name === 'inactive');
    const displayParam = parameters.parameter.find((p: any) => p.name === 'display');
    const issues = extractTerminologyIssues(parameters);
    const hasDisplayMismatch = issues.some(issue => issue.code === 'invalid-display');

    if (resultParam?.valueBoolean === true) {
        logger.debug(`[TerminologyApiClient] Code '${code}' is valid in ${system}`);
        return {
            valid: true,
            message: messageParam?.valueString,
            issues,
            inactive: inactiveParam?.valueBoolean === true,
            display: displayParam?.valueString,
        };
    }

    const errorMessage = messageParam?.valueString || `Unknown code '${code}' in CodeSystem '${system}'`;
    if (isSnomedNationalExtensionSystemCode(system, code)) {
        logger.debug(`[TerminologyApiClient] Code '${code}' is a SNOMED national-extension SCTID — failing open (server has International Edition only)`);
        return { valid: true };
    }
    logger.debug(`[TerminologyApiClient] Code '${code}' is INVALID in ${system}: ${errorMessage}`);
    return {
        valid: false,
        message: errorMessage,
        reason: hasDisplayMismatch ? 'display-mismatch' : 'code-unknown',
        issues,
        inactive: inactiveParam?.valueBoolean === true,
        display: displayParam?.valueString,
    };
}

export function isSnomedNationalExtensionSystemCode(system: string, code: string): boolean {
    return system === SNOMED_SYSTEM && isSnomedNationalExtensionCode(code);
}

export function operationOutcomeToCodeSystemResult(
    opOutcome: any,
    code: string,
    system: string,
): CodeSystemValidationResult {
    if (opOutcome?.resourceType === 'OperationOutcome' && opOutcome.issue?.[0]) {
        const msg = opOutcome.issue[0].details?.text || opOutcome.issue[0].diagnostics || `Unknown code '${code}' in CodeSystem '${system}'`;
        const issues = mapOperationOutcomeIssues(opOutcome);
        return {
            valid: false,
            message: msg,
            reason: issues.some(issue => issue.code === 'invalid-display') ? 'display-mismatch' : 'code-unknown',
            issues,
        };
    }

    return { valid: false, message: `Unknown code '${code}' in CodeSystem '${system}'` };
}
