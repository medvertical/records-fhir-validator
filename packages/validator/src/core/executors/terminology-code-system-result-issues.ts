import { displayUnverifiedIssue } from '../../validators/valueset-display-authority.js';
import { createTerminologyIssue } from '../../terminology/terminology-issue.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type {
  CodeSystemValidationIssue,
  CodeSystemValidationResult,
} from '../../validators/terminology-api-types.js';
import { hasAuthoritativeDisplayMismatch, sourceDisplaysEquivalent } from '../../validators/valueset-display-evidence.js';
import {
  buildDisplayMismatchFixHint,
  extractAcceptedDisplays,
  extractExpectedDisplay,
  uniqueAcceptedDisplays,
} from './terminology-display-rules.js';

export interface CodingValue {
  system: string;
  code: string;
  display?: string;
  version?: string;
}

interface LoincCheckDigitDiagnostic {
  actualCheckDigit: string;
  expectedCheckDigit: string;
  suggestedCode: string;
  fixHint: string;
}

export function buildCodeSystemResultIssues(
  coding: CodingValue,
  result: CodeSystemValidationResult,
  path: string,
  index: number,
  isArrayInput: boolean,
  includeUnverified = true,
): ValidationIssue[] {
  const serverIssues = result.issues ?? [];
  return [
    ...(includeUnverified ? buildUnverifiedIssues(coding, result, path, index, isArrayInput) : []),
    ...serverIssues.filter(issue => issue.code === 'display-unverified').map(issue =>
      displayUnverifiedIssue(coding, resultPath(path, index, isArrayInput, 'display'), issue.message,
        issue.severity === 'information' ? 'information' : 'warning', result.displayLanguage)),
    ...buildDisplayIssues(coding, result, serverIssues, path, index, isArrayInput),
    ...buildInactiveIssues(coding, result, serverIssues, path, index, isArrayInput),
    ...buildRetiredIssues(coding, serverIssues, path, index, isArrayInput),
    ...buildDeprecatedIssues(coding, serverIssues, path, index, isArrayInput),
    ...buildInvalidCodeIssues(coding, result, path, index, isArrayInput),
  ];
}

function buildUnverifiedIssues(
  coding: CodingValue,
  result: CodeSystemValidationResult,
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  if (!['remote-budget-exhausted', 'national-extension-unverified', 'delegation-disabled', 'no-server', 'circuit-open'].includes(result.reason ?? '')) {
    return [];
  }
  const codingPath = resultPath(path, index, isArrayInput, 'code');
  const nationalExtension = result.reason === 'national-extension-unverified';
  const delegationDisabled = result.reason === 'delegation-disabled';
  const unavailable = result.reason === 'no-server' || result.reason === 'circuit-open';
  return [createTerminologyIssue({
    severity: 'information',
    code: 'terminology-codesystem-unverified',
    message: unavailable
      ? result.message ?? 'CodeSystem membership was not verified because no eligible terminology server could be asked.'
      : delegationDisabled
      ? result.message ?? 'CodeSystem membership was not verified because terminology code validation delegation is disabled.'
      : nationalExtension
      ? result.message
        ?? `SNOMED national-extension code ${coding.system}#${coding.code} was not verified against the required national edition`
      : `Remote CodeSystem validation budget was exhausted; ${coding.system}#${coding.code} `
        + 'was not verified against the terminology server',
    path: codingPath,
    details: {
      code: coding.code,
      system: coding.system,
      ...(coding.display ? { display: coding.display } : {}),
      reason: result.reason,
      validationComplete: false,
      validationStatus: 'incomplete',
      ...(coding.version ? { codeSystemVersion: coding.version } : {}),
      fixHint: unavailable
        ? 'Provide a complete local CodeSystem, or configure an enabled terminology server for this FHIR release and validate again when it is available.'
        : delegationDisabled
        ? 'Provide a complete local CodeSystem or explicitly enable terminology code validation delegation.'
        : nationalExtension
        ? 'Configure a terminology server that contains the required SNOMED national edition.'
        : 'Increase maxRemoteCodeSystemValidations for deeper remote terminology evidence, or provide a local CodeSystem package/cache.',
    },
  })];
}

function buildDisplayIssues(
  coding: CodingValue,
  result: CodeSystemValidationResult,
  serverIssues: CodeSystemValidationIssue[],
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  const displayIssue = serverIssues.find(issue => issue.code === 'invalid-display' && issue.severity === 'error')
    ?? serverIssues.find(issue => issue.code === 'invalid-display');
  if (!coding.display) return [];
  const expectedDisplay = result.display ?? extractExpectedDisplay(displayIssue?.message ?? result.message);
  // Unversioned compatibility hints cannot overrule this source's display evidence.
  const acceptedDisplays = uniqueAcceptedDisplays([
    ...(result.display ? [result.display] : []),
    ...extractAcceptedDisplays(displayIssue?.message ?? result.message),
  ]);
  if (
    !displayIssue
    || (!hasAuthoritativeDisplayMismatch(result) && (
      (expectedDisplay ? sourceDisplaysEquivalent(expectedDisplay, coding.display, coding) : false)
      || acceptedDisplays.some(display => sourceDisplaysEquivalent(display, coding.display!, coding))
    ))
  ) return [];

  // A wrong display is an error, as the reference validator and the server
  // itself grade it, unless the server was asked to report displays as warnings.
  return [createTerminologyIssue({
    severity: displayIssue.severity === 'warning' ? 'warning' : 'error',
    code: 'terminology-display-mismatch',
    message: displayIssue.message
      || result.message
      || `Wrong Display Name '${coding.display}' for ${coding.system}#${coding.code}`,
    path: resultPath(path, index, isArrayInput, 'display'),
    details: {
      code: coding.code,
      system: coding.system,
      display: coding.display,
      ...(expectedDisplay ? { expectedDisplay } : {}),
      ...(acceptedDisplays.length > 0 ? { acceptedDisplays } : {}),
      fixHint: buildDisplayMismatchFixHint(coding.system, coding.code, coding.display),
    },
  })];
}

function buildInactiveIssues(
  coding: CodingValue,
  result: CodeSystemValidationResult,
  serverIssues: CodeSystemValidationIssue[],
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  const inactiveIssue = serverIssues.find(issue =>
    issue.code === 'code-comment'
    && (issue.source === 'local-code-system' || /inactive/i.test(issue.message ?? ''))
  );
  if (!result.inactive && !inactiveIssue) return [];
  return [createTerminologyIssue({
    severity: 'warning',
    code: 'terminology-code-inactive',
    message: inactiveIssue?.message
      || result.message
      || `The concept '${coding.code}' is inactive and its use should be reviewed`,
    path: inactiveIssue?.source === 'local-code-system'
      ? (isArrayInput ? `${path}[${index}]` : path)
      : resultPath(path, index, isArrayInput, 'code'),
    details: {
      code: coding.code,
      system: coding.system,
      ...(result.display ? { display: result.display } : {}),
      ...(inactiveIssue?.source === 'local-code-system' ? {
        terminologySource: inactiveIssue.source,
        lifecyclePolicy: 'fhir-validator-6.9.11-properties',
        conceptPropertyPaths: inactiveIssue.expression,
      } : {}),
    },
  })];
}

function buildRetiredIssues(
  coding: CodingValue,
  serverIssues: CodeSystemValidationIssue[],
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  const retired = serverIssues.find(issue => issue.code === 'code-retired');
  if (!retired) return [];
  return [createTerminologyIssue({
    severity: 'warning',
    code: 'terminology-code-retired',
    message: retired.message,
    path: isArrayInput ? `${path}[${index}]` : path,
    details: {
      code: coding.code,
      system: coding.system,
      conceptStatus: 'retired',
      ...(retired.source ? { terminologySource: retired.source } : {}),
      ...(retired.source === 'local-code-system' ? {
        lifecyclePolicy: 'fhir-validator-6.9.11-properties',
        conceptPropertyPaths: retired.expression,
      } : {}),
    },
  })];
}

function buildDeprecatedIssues(
  coding: CodingValue,
  serverIssues: CodeSystemValidationIssue[],
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  const deprecated = serverIssues.find(issue => issue.code === 'code-deprecated');
  if (!deprecated) return [];
  return [createTerminologyIssue({
    severity: 'warning',
    code: 'terminology-code-deprecated',
    message: deprecated.message,
    path: isArrayInput ? `${path}[${index}]` : path,
    details: { code: coding.code, system: coding.system },
  })];
}

function buildInvalidCodeIssues(
  coding: CodingValue,
  result: CodeSystemValidationResult,
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  if (result.valid || result.reason === 'display-mismatch') return [];
  const systemUnresolvable = result.reason === 'system-unresolvable';
  const loinc = getLoincCheckDigitDiagnostic(coding.system, coding.code);
  return [createTerminologyIssue({
    severity: systemUnresolvable || result.incompleteCodeSystem ? 'warning' : 'error',
    code: systemUnresolvable ? 'terminology-codesystem-unresolvable' : 'terminology-code-invalid',
    message: buildInvalidCodeMessage(coding, result, loinc),
    // An unresolvable system is a remark about `Coding.system`, not about the
    // code: nothing was found to check the code against. The other producer of
    // this issue code already anchors it there, and so does the reference
    // validator, so the same finding used to land on two different elements.
    path: resultPath(path, index, isArrayInput, systemUnresolvable ? 'system' : 'code'),
    details: {
      code: coding.code,
      system: coding.system,
      ...(coding.display ? { display: coding.display } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(systemUnresolvable || result.incompleteCodeSystem ? {
        validationComplete: false,
        validationStatus: 'incomplete',
        ...(coding.version ? { codeSystemVersion: coding.version } : {}),
      } : {}),
      ...(loinc ? {
        loincCheckDigitStatus: 'invalid',
        expectedCheckDigit: loinc.expectedCheckDigit,
        actualCheckDigit: loinc.actualCheckDigit,
        suggestedCode: loinc.suggestedCode,
        fixHint: loinc.fixHint,
      } : {}),
    },
  })];
}

function resultPath(path: string, index: number, isArrayInput: boolean, field: string): string {
  return isArrayInput ? `${path}[${index}].${field}` : `${path}.${field}`;
}

function buildInvalidCodeMessage(
  coding: CodingValue,
  result: CodeSystemValidationResult,
  loinc?: LoincCheckDigitDiagnostic,
): string {
  const base = result.message || `Unknown code '${coding.code}' in CodeSystem '${coding.system}'`;
  return loinc
    ? `${base}. LOINC check digit '${loinc.actualCheckDigit}' is invalid; expected '${loinc.expectedCheckDigit}' for '${loinc.suggestedCode}'`
    : base;
}

function getLoincCheckDigitDiagnostic(
  system: unknown,
  code: unknown,
): LoincCheckDigitDiagnostic | undefined {
  if (system !== 'http://loinc.org' || typeof code !== 'string') return undefined;
  const match = code.match(/^(\d+)-(\d)$/);
  if (!match) return undefined;
  const [, stem, actualCheckDigit] = match;
  const expectedCheckDigit = calculateLoincCheckDigit(stem);
  if (actualCheckDigit === expectedCheckDigit) return undefined;
  const suggestedCode = `${stem}-${expectedCheckDigit}`;
  return {
    actualCheckDigit,
    expectedCheckDigit,
    suggestedCode,
    fixHint: `LOINC code '${code}' has an invalid check digit. If the numeric stem '${stem}' is intended, replace it with '${suggestedCode}'.`,
  };
}

function calculateLoincCheckDigit(stem: string): string {
  let sum = 0;
  let doubleDigit = true;
  for (let index = stem.length - 1; index >= 0; index--) {
    const product = Number(stem[index]) * (doubleDigit ? 2 : 1);
    sum += Math.floor(product / 10) + (product % 10);
    doubleDigit = !doubleDigit;
  }
  return String((10 - (sum % 10)) % 10);
}
