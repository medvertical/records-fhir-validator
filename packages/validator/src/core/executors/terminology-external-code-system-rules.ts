import type { ValidationIssue } from '@records-fhir/validation-types';
import { createTerminologyIssue } from '../../terminology/terminology-issue.js';
import { buildInvalidUcumIssueDetails, buildInvalidUcumMessage } from './terminology-ucum-rules.js';
import { UcumCodeValidator } from '../../validators/ucum-validator.js';
import { isValidFhirCodePrimitive, missingCodingSystemSeverity } from './terminology-coding-hygiene-rules.js';
import { CodeSystemReferenceLookupCache, validateCodeSystemReference } from './terminology-code-system-reference-rules.js';
import type { ProfileSourceContext } from '../../persistence/index.js';
import { ValueSetCache } from '../../validators/valueset-cache.js';
import { buildCodeSystemResultIssues, type CodingValue } from './terminology-code-system-result-issues.js';
import type { TerminologyCodeSystemValidationPort } from './terminology-validation-port.js';

export async function validateExternalCodeSystems(
  value: unknown,
  path: string,
  valuesetValidator: Pick<TerminologyCodeSystemValidationPort, 'validateCodeInCodeSystem'>,
  fhirVersion?: 'R4' | 'R5' | 'R6',
  sourceContext?: ProfileSourceContext,
  cache: ValueSetCache = new ValueSetCache(),
  lookupCache: CodeSystemReferenceLookupCache = new CodeSystemReferenceLookupCache(),
  ucumValidator: UcumCodeValidator = new UcumCodeValidator(),
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const codings = Array.isArray(value) ? value : [value];

  for (let i = 0; i < codings.length; i++) {
    const candidate = codings[i];
    const isArrayInput = Array.isArray(value);
    if (isRecord(candidate) && isNonEmptyString(candidate.code) && isMissingSystem(candidate.system)) {
      const codingPath = isArrayInput ? `${path}[${i}]` : path;
      const resourceType = resourceTypeFromPath(codingPath);
      issues.push(
        createTerminologyIssue({
          severity: missingCodingSystemSeverity(resourceType, codingPath),
          code: 'terminology-coding-missing-system',
          message:
            'Coding has no system. A code with no system has no defined meaning, and it cannot be validated. A system should be provided',
          path: codingPath,
          resourceType,
          details: {
            code: candidate.code,
            ...(isNonEmptyString(candidate.display) ? { display: candidate.display } : {}),
          },
        }),
      );
      continue;
    }

    const coding = asCodingValue(candidate);
    if (!coding) continue;

    issues.push(
      ...(await validateCodeSystemReference(
        coding,
        path,
        i,
        isArrayInput,
        'syntax',
        fhirVersion,
        sourceContext,
        cache,
        lookupCache,
      )),
    );
    if (!isValidFhirCodePrimitive(coding.code)) continue;
    // Resource.meta.tag is explicitly an application tagging mechanism. Its
    // system identifies a tag namespace and does not need to resolve to a
    // published FHIR CodeSystem. Keep URI/datatype hygiene above, but do not
    // emit clinical terminology lookup noise for operational tags.
    if (isMetaTagPath(path)) continue;
    issues.push(...validateUcumCoding(coding, path, i, isArrayInput, ucumValidator));
    issues.push(...(await validateExternalCoding(coding, path, i, isArrayInput, valuesetValidator, fhirVersion)));
    issues.push(
      ...(await validateCodeSystemReference(
        coding,
        path,
        i,
        isArrayInput,
        'not-found',
        fhirVersion,
        sourceContext,
        cache,
        lookupCache,
      )),
    );
  }

  return issues;
}

function isMetaTagPath(path: string): boolean {
  return /(?:^|\.)meta\.tag(?:$|\.|\[)/.test(path);
}

export async function validateLocalCodeSystemCoding(
  value: unknown,
  path: string,
  valuesetValidator: Pick<TerminologyCodeSystemValidationPort, 'validateCodeInLocalCodeSystemOnly'>,
  fhirVersion?: 'R4' | 'R5' | 'R6',
  _sourceContext?: ProfileSourceContext,
): Promise<ValidationIssue[]> {
  const coding = asCodingValue(value);
  if (!coding || /\/ValueSet\//i.test(coding.system)) return [];

  const display = typeof coding.display === 'string' ? coding.display : undefined;
  const result = coding.version
    ? await valuesetValidator.validateCodeInLocalCodeSystemOnly(
        coding.code, coding.system, display, fhirVersion, coding.version,
      )
    : await valuesetValidator.validateCodeInLocalCodeSystemOnly(
        coding.code, coding.system, display, fhirVersion,
      );
  if (!result) return [];

  return buildCodeSystemResultIssues(coding, result, path, 0, false, false);
}

function resourceTypeFromPath(path: string): string {
  const [resourceType] = path.split('.');
  return resourceType || 'Resource';
}

function validateUcumCoding(
  coding: CodingValue,
  path: string,
  index: number,
  isArrayInput: boolean,
  ucumValidator: UcumCodeValidator,
): ValidationIssue[] {
  if (coding.system !== 'http://unitsofmeasure.org') return [];

  const result = ucumValidator.validate(coding.code);
  if (result.valid) return [];

  const codingPath = isArrayInput ? `${path}[${index}].code` : `${path}.code`;
  return [
    createTerminologyIssue({
      severity: 'error',
      code: 'terminology-code-invalid',
      message: buildInvalidUcumMessage(coding.code, codingPath, result.message, result.suggestion),
      path: codingPath,
      details: buildInvalidUcumIssueDetails(coding.code, codingPath, result.message, result.suggestion),
    }),
  ];
}

async function validateExternalCoding(
  coding: CodingValue,
  path: string,
  index: number,
  isArrayInput: boolean,
  valuesetValidator: Pick<TerminologyCodeSystemValidationPort, 'validateCodeInCodeSystem'>,
  fhirVersion?: 'R4' | 'R5' | 'R6',
): Promise<ValidationIssue[]> {
  if (/\/ValueSet\//i.test(coding.system)) return [];

  const display = typeof coding.display === 'string' ? coding.display : undefined;
  const result = coding.version
    ? await valuesetValidator.validateCodeInCodeSystem(
        coding.code, coding.system, display, fhirVersion, coding.version,
      )
    : await valuesetValidator.validateCodeInCodeSystem(
        coding.code, coding.system, display, fhirVersion,
      );
  return buildCodeSystemResultIssues(coding, result, path, index, isArrayInput);
}

function asCodingValue(value: unknown): CodingValue | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.system) || !isNonEmptyString(value.code)) {
    return undefined;
  }

  return {
    system: value.system,
    code: value.code,
    ...(typeof value.display === 'string' ? { display: value.display } : {}),
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
  };
}

function isMissingSystem(value: unknown): boolean {
  return value == null || value === '';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
