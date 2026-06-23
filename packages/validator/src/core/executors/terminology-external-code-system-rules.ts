import type { ValidationIssue } from '../../types';
import { valueSetCache } from '../../validators/valueset-cache';
import type { ValueSetValidator } from '../../validators/valueset-validator';
import { displaysEquivalentForCodeInfo } from '../../validators/valueset-display-utils';
import { buildInvalidUcumIssueDetails, buildInvalidUcumMessage } from './terminology-ucum-rules';
import { validateUcumCode } from '../../validators/ucum-validator';
import {
  anyDisplayEquivalent,
  buildDisplayMismatchFixHint,
  extractAcceptedDisplays,
  extractExpectedDisplay,
  uniqueAcceptedDisplays,
} from './terminology-display-rules';

interface TerminologyServerIssue {
  code?: string;
  severity?: unknown;
  message?: string;
}

interface LoincCheckDigitDiagnostic {
  actualCheckDigit: string;
  expectedCheckDigit: string;
  suggestedCode: string;
  fixHint: string;
}

const LOINC_SYSTEM_URL = 'http://loinc.org';

export async function validateExternalCodeSystems(
  value: any,
  path: string,
  valuesetValidator: ValueSetValidator,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const codings = Array.isArray(value) ? value : [value];

  for (let i = 0; i < codings.length; i++) {
    const coding = codings[i];
    const isArrayInput = Array.isArray(value);
    if (coding && typeof coding === 'object' && coding.code && !coding.system) {
      issues.push({
        id: `terminology-coding-missing-system-${Date.now()}-${i}`,
        aspect: 'terminology',
        severity: 'warning',
        code: 'terminology-coding-missing-system',
        message: 'Coding has no system. A code with no system has no defined meaning, and it cannot be validated. A system should be provided',
        path: isArrayInput ? `${path}[${i}]` : path,
        timestamp: new Date(),
      });
      continue;
    }

    if (!coding || typeof coding !== 'object' || !coding.system || !coding.code) {
      continue;
    }

    issues.push(...validateCodeSystemReference(coding, path, i, isArrayInput));
    issues.push(...validateUcumCoding(coding, path, i, isArrayInput));
    issues.push(...await validateExternalCoding(coding, path, i, isArrayInput, valuesetValidator));
  }

  return issues;
}

function validateCodeSystemReference(
  coding: any,
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const systemPath = isArrayInput ? `${path}[${index}].system` : `${path}.system`;

  if (/\/ValueSet\//i.test(coding.system)) {
    issues.push({
      id: `terminology-codesystem-is-valueset-${Date.now()}-${index}`,
      aspect: 'terminology',
      severity: 'error',
      code: 'terminology-coding-system-valueset',
      message: `The Coding references a value set, not a code system ('${coding.system}')`,
      path: systemPath,
      timestamp: new Date(),
      details: {
        valueSetUrl: coding.system,
        fixHint: 'Replace Coding.system with the CodeSystem URL that defines the code; do not use a ValueSet URL as Coding.system.',
      },
    });
  }

  const systemValidation = validateCodeSystemUrl(coding.system);
  const cacheKnowsIt =
    valueSetCache.hasCodeSystem(coding.system) ||
    valueSetCache.hasCodeSystemFile(coding.system);
  if (!systemValidation.valid && !cacheKnowsIt) {
    issues.push({
      id: `terminology-codesystem-not-found-${Date.now()}-${index}`,
      aspect: 'terminology',
      severity: 'warning',
      code: 'not-found',
      message: `A definition for CodeSystem '${coding.system}' could not be found, so the code cannot be validated`,
      path: systemPath,
      timestamp: new Date(),
    });
  }

  return issues;
}

function validateUcumCoding(
  coding: any,
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  if (coding.system !== 'http://unitsofmeasure.org') return [];

  const result = validateUcumCode(coding.code);
  if (result.valid) return [];

  const codingPath = isArrayInput ? `${path}[${index}].code` : `${path}.code`;
  return [{
    id: `terminology-ucum-coding-invalid-${Date.now()}-${index}`,
    aspect: 'terminology',
    severity: 'error',
    code: 'terminology-code-invalid',
    message: buildInvalidUcumMessage(coding.code, codingPath, result.message, result.suggestion),
    path: codingPath,
    timestamp: new Date(),
    details: buildInvalidUcumIssueDetails(coding.code, codingPath, result.message, result.suggestion),
  }];
}

async function validateExternalCoding(
  coding: any,
  path: string,
  index: number,
  isArrayInput: boolean,
  valuesetValidator: ValueSetValidator,
): Promise<ValidationIssue[]> {
  if (/\/ValueSet\//i.test(coding.system)) return [];
  if (!valuesetValidator.isExternalCodeSystem(coding.system)) return [];

  const result = await valuesetValidator.validateCodeInCodeSystem(
    coding.code,
    coding.system,
    typeof coding.display === 'string' ? coding.display : undefined,
  );
  const issues: ValidationIssue[] = [];
  const terminologyServerIssues = result.issues ?? [];
  issues.push(...buildDisplayIssues(coding, result, terminologyServerIssues, path, index, isArrayInput));
  issues.push(...buildInactiveIssues(coding, result, terminologyServerIssues, path, index, isArrayInput));
  issues.push(...buildInvalidCodeIssues(coding, result, path, index, isArrayInput));

  return issues;
}

function buildDisplayIssues(
  coding: any,
  result: any,
  terminologyServerIssues: TerminologyServerIssue[],
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  const displayIssue = terminologyServerIssues.find(issue => issue.code === 'invalid-display');
  const expectedDisplay = result.display ?? extractExpectedDisplay(displayIssue?.message ?? result.message);
  const acceptedDisplays = uniqueAcceptedDisplays([
    ...(result.display ? [result.display] : []),
    ...extractAcceptedDisplays(displayIssue?.message ?? result.message),
  ]);
  if (
    !displayIssue ||
    (expectedDisplay ? displaysEquivalentForCodeInfo(expectedDisplay, coding.display, coding) : false) ||
    acceptedDisplays.some(display => displaysEquivalentForCodeInfo(display, coding.display, coding)) ||
    anyDisplayEquivalent(acceptedDisplays, coding.display)
  ) {
    return [];
  }

  const displayPath = isArrayInput ? `${path}[${index}].display` : `${path}.display`;
  return [{
    id: `terminology-codesystem-display-${Date.now()}-${index}`,
    aspect: 'terminology',
    severity: 'warning',
    code: 'terminology-display-mismatch',
    message: displayIssue.message || result.message || `Wrong Display Name '${coding.display}' for ${coding.system}#${coding.code}`,
    path: displayPath,
    timestamp: new Date(),
    details: {
      code: coding.code,
      system: coding.system,
      ...(coding.display ? { display: coding.display } : {}),
      ...(expectedDisplay ? { expectedDisplay } : {}),
      ...(acceptedDisplays.length > 0 ? { acceptedDisplays } : {}),
      fixHint: buildDisplayMismatchFixHint(coding.system, coding.code, coding.display),
    },
  }];
}

function buildInactiveIssues(
  coding: any,
  result: any,
  terminologyServerIssues: TerminologyServerIssue[],
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  const inactiveIssue = terminologyServerIssues.find(issue =>
    issue.code === 'code-comment' &&
    /inactive/i.test(issue.message ?? '')
  );
  if (!result.inactive && !inactiveIssue) return [];

  const codingPath = isArrayInput ? `${path}[${index}].code` : `${path}.code`;
  return [{
    id: `terminology-codesystem-inactive-${Date.now()}-${index}`,
    aspect: 'terminology',
    severity: 'warning',
    code: 'terminology-code-inactive',
    message: inactiveIssue?.message || result.message || `The concept '${coding.code}' is inactive and its use should be reviewed`,
    path: codingPath,
    timestamp: new Date(),
    details: {
      code: coding.code,
      system: coding.system,
      ...(result.display ? { display: result.display } : {}),
    },
  }];
}

function buildInvalidCodeIssues(
  coding: any,
  result: any,
  path: string,
  index: number,
  isArrayInput: boolean,
): ValidationIssue[] {
  if (result.valid || result.reason === 'display-mismatch') return [];

  const codingPath = isArrayInput ? `${path}[${index}].code` : `${path}.code`;
  const isSystemUnresolvable = result.reason === 'system-unresolvable';
  const loincCheckDigit = getLoincCheckDigitDiagnostic(coding.system, coding.code);
  return [{
    id: `terminology-codesystem-${isSystemUnresolvable ? 'unresolvable' : 'invalid'}-${Date.now()}-${index}`,
    aspect: 'terminology',
    severity: isSystemUnresolvable ? 'warning' : 'error',
    code: isSystemUnresolvable ? 'terminology-codesystem-unresolvable' : 'terminology-code-invalid',
    message: buildInvalidCodeMessage(coding, result, loincCheckDigit),
    path: codingPath,
    timestamp: new Date(),
    details: {
      code: coding.code,
      system: coding.system,
      ...(coding.display ? { display: coding.display } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(loincCheckDigit ? {
        loincCheckDigitStatus: 'invalid',
        expectedCheckDigit: loincCheckDigit.expectedCheckDigit,
        actualCheckDigit: loincCheckDigit.actualCheckDigit,
        suggestedCode: loincCheckDigit.suggestedCode,
        fixHint: loincCheckDigit.fixHint,
      } : {}),
    },
  }];
}

function buildInvalidCodeMessage(
  coding: any,
  result: any,
  loincCheckDigit?: LoincCheckDigitDiagnostic,
): string {
  const base = result.message || `Unknown code '${coding.code}' in CodeSystem '${coding.system}'`;
  if (!loincCheckDigit) return base;
  return `${base}. LOINC check digit '${loincCheckDigit.actualCheckDigit}' is invalid; expected '${loincCheckDigit.expectedCheckDigit}' for '${loincCheckDigit.suggestedCode}'`;
}

function getLoincCheckDigitDiagnostic(system: unknown, code: unknown): LoincCheckDigitDiagnostic | undefined {
  if (system !== LOINC_SYSTEM_URL || typeof code !== 'string') return undefined;

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
    const digit = Number(stem[index]);
    const product = doubleDigit ? digit * 2 : digit;
    sum += Math.floor(product / 10) + (product % 10);
    doubleDigit = !doubleDigit;
  }

  return String((10 - (sum % 10)) % 10);
}

function validateCodeSystemUrl(systemUrl: string): { valid: boolean; message?: string } {
  const knownPatterns = [
    /^http:\/\/hl7\.org\/fhir\//,
    /^http:\/\/terminology\.hl7\.org\//,
    /^http:\/\/loinc\.org\/?$/,
    /^https?:\/\/snomed\.info\/sct/,
    /^http:\/\/unitsofmeasure\.org\/?$/,
    /^http:\/\/www\.nlm\.nih\.gov\/research\/umls\/rxnorm/,
    /^urn:oid:/,
    /^urn:iso:/,
    /^urn:ietf:/,
    /^urn:uuid:/,
    /^http:\/\/hl7\.org\/fhir\/sid\/icd/,
    /^https?:\/\/id\.who\.int\/icd\//,
    /^http:\/\/www\.cms\.gov\/Medicare\/Coding\/ICD10\/?$/,
    /^http:\/\/www\.whocc\.no\/atc/,
    /^http:\/\/unstats\.un\.org\//,
    /^http:\/\/dicom\.nema\.org\//,
    /^http:\/\/www\.ama-assn\.org\/go\/cpt/,
    /^http:\/\/hl7\.org\/fhir\/sid\//,
    /^http:\/\/www\.iso\.org\//,
    /^http:\/\/ihe\.net\//,
    /^http:\/\/ihe-d\.de\//,
    /^http:\/\/nucc\.org\//,
    /^https?:\/\/www\.nubc\.org\//,
    /^http:\/\/fdasis\.nlm\.nih\.gov/,
    /^http:\/\/ncimeta\.nci\.nih\.gov/,
    /^http:\/\/varnomen\.hgvs\.org/,
    /^http:\/\/www\.genenames\.org/,
    /^http:\/\/clinicaltrials\.gov/,
    /^http:\/\/www\.ada\.org\/snodent/,
    /^http:\/\/cts2\.nlm\.nih\.gov/,
    /^http:\/\/standardterms\.edqm\.eu\/?$/,
    /^http:\/\/fhir\.de\//,
    /^http:\/\/fhir\.nl\//,
    /^http:\/\/fhir\.ch\//,
    /^https:\/\/fhir\.hl7\.org\.uk\//,
    /^https:\/\/hl7chile\.cl\/fhir\//,
    /^https?:\/\/fhir\.ee\//,
    /^https?:\/\/fhir\.bbmri\.de\//,
    /^http:\/\/fhir\.fi\//,
    /^https?:\/\/.*\.hl7\.org\//,
    /^urn:ietf:bcp:47$/,
    /^http:\/\/fhir\.synapxe\.sg\/CodeSystem\//,
  ];

  if (knownPatterns.some(pattern => pattern.test(systemUrl))) {
    return { valid: true };
  }

  if (!systemUrl.startsWith('http://') && !systemUrl.startsWith('https://') && !systemUrl.startsWith('urn:')) {
    return { valid: false, message: `CodeSystem URL should be an absolute URI: '${systemUrl}'` };
  }

  return { valid: false, message: `Unknown CodeSystem URL: ${systemUrl}` };
}
