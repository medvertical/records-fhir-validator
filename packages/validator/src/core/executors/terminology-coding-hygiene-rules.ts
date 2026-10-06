import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../../issues/index.js';
import { UcumCodeValidator, ucumCodeHasAnnotation } from '../../validators/ucum-validator.js';
import { hasInvalidSnomedCheckDigit } from '../../validators/snomed-id-validator.js';
import { classifySnomedExpressionSyntax } from '../../validators/snomed-expression-syntax.js';
import {
  buildInvalidUcumIssueDetails,
  buildInvalidUcumMessage,
  buildUnverifiedUcumIssue,
} from './terminology-ucum-rules.js';

type CodingHygieneIssue = {
  severity: 'error' | 'warning' | 'information';
  code: string;
  message: string;
  path: string;
  details?: Record<string, unknown>;
  messageParams?: Record<string, unknown>;
};

function snomedCheckDigitIssue(value: Record<string, unknown>, path: string): CodingHygieneIssue | undefined {
  if (value.system !== 'http://snomed.info/sct' || typeof value.code !== 'string'
    || !hasInvalidSnomedCheckDigit(value.code)) return undefined;
  return {
    severity: 'error',
    code: 'terminology-code-invalid',
    message: `SNOMED CT identifier '${value.code}' has an invalid Verhoeff check digit`,
    path: `${path}.code`,
    details: {
      code: value.code,
      system: value.system,
      reason: 'snomed-check-digit',
      fixHint: 'Verify the intended concept against its source terminology; changing the check digit alone does not establish the intended clinical meaning.',
    },
  };
}

function snomedExpressionSyntaxIssue(value: Record<string, unknown>, path: string): CodingHygieneIssue | undefined {
  if (value.system !== 'http://snomed.info/sct' || typeof value.code !== 'string') return undefined;
  const result = classifySnomedExpressionSyntax(value.code);
  if (result.kind === 'named-id' || result.kind === 'expression') return undefined;
  const details = {
    code: value.code,
    system: value.system,
    syntaxOffset: result.offset,
  };
  if (result.kind === 'unverified') {
    return {
      severity: 'information',
      code: 'terminology-snomed-syntax-unverified',
      message: `SNOMED CT expression syntax could not be fully checked because the ${result.reason} was reached; syntax validation is incomplete.`,
      path: `${path}.code`,
      messageParams: { syntaxLimitReason: result.reason },
      details: {
        ...details,
        reason: 'snomed-expression-syntax-limit',
        syntaxLimitReason: result.reason,
        syntaxLimit: result.limit,
        validationComplete: false,
        validationStatus: 'incomplete',
      },
    };
  }
  return {
    severity: 'error',
    code: 'terminology-code-invalid',
    message: `Invalid SNOMED CT expression syntax at UTF-16 offset ${result.offset}: expected ${result.expected}.`,
    path: `${path}.code`,
    details: { ...details, reason: 'snomed-expression-syntax', syntaxExpected: result.expected },
  };
}

function isCodingHygienePath(path: string): boolean {
  return (
    /\.coding\[\d+\]$/.test(path) ||
    /\.(?:value|answer|pattern|fixed)Coding$/.test(path)
  );
}

export function isValidFhirCodePrimitive(code: string): boolean {
  return /^[^\s]+(?: [^\s]+)*$/.test(code);
}

function hasRawWhitespace(value: string): boolean {
  return /\s/.test(value);
}

export function missingCodingSystemSeverity(
  resourceType: string,
  path: string,
): 'warning' | 'information' {
  if (resourceType !== 'Questionnaire') return 'warning';

  const isQuestionnaireLocalChoiceCoding =
    /\.answerOption\[\d+\]\.valueCoding$/.test(path) ||
    /\.enableWhen\[\d+\]\.answerCoding$/.test(path) ||
    /\.extension\[\d+\](?:\.extension\[\d+\])?\.valueCoding$/.test(path) ||
    /\.extension\[\d+\](?:\.extension\[\d+\])?\.valueCodeableConcept\.coding\[\d+\]$/.test(path);

  return isQuestionnaireLocalChoiceCoding ? 'information' : 'warning';
}

export function validateCodingHygiene(
  resource: unknown,
  existingIssues: ValidationIssue[],
  ucumValidator: UcumCodeValidator = new UcumCodeValidator(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set(existingIssues.map(issue => `${issue.code}|${issue.path}`));
  const root = resourceTypeOf(resource);
  const visited = new WeakSet<object>();

  const pushCreatedOnce = (issue: ValidationIssue): void => {
    const key = `${issue.code}|${issue.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  const pushOnce = (issue: CodingHygieneIssue): void => {
    pushCreatedOnce(createValidationIssue({
      code: issue.code,
      path: issue.path,
      resourceType: root,
      aspectOverride: 'terminology',
      severityOverride: issue.severity,
      customMessage: issue.message,
      details: issue.details,
      messageParams: issue.messageParams,
    }));
  };

  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (!isRecord(value)) return;

    if (typeof value.code === 'string' && !value.system && isCodingHygienePath(path)) {
      const details: Record<string, unknown> = {
        code: value.code,
        fieldPath: path,
      };
      if (typeof value.display === 'string') {
        details.display = value.display;
      }

      pushOnce({
        severity: missingCodingSystemSeverity(root, path),
        code: 'terminology-coding-missing-system',
        message: 'Coding has no system. A code with no system has no defined meaning, and it cannot be validated. A system should be provided',
        path,
        details,
      });
    }

    if (typeof value.code === 'string' && isCodingHygienePath(path) && !isValidFhirCodePrimitive(value.code)) {
      pushOnce({
        severity: 'error',
        code: 'terminology-code-invalid',
        message: `The code '${value.code}' at ${path}.code is not valid (whitespace rules)`,
        path: `${path}.code`,
        details: {
          code: value.code,
          reason: 'code-whitespace',
          fieldPath: `${path}.code`,
        },
      });
    }

    if (typeof value.system === 'string' && isCodingHygienePath(path) && hasRawWhitespace(value.system)) {
      pushOnce({
        severity: 'error',
        code: 'terminology-code-invalid',
        message: `The system '${value.system}' at ${path}.system is not valid (whitespace rules)`,
        path: `${path}.system`,
        details: {
          code: typeof value.code === 'string' ? value.code : '',
          system: value.system,
          reason: 'system-whitespace',
          fieldPath: `${path}.system`,
          fixHint: `Remove whitespace from Coding.system '${value.system}'.`,
        },
      });
    }

    const snomedIssue = snomedCheckDigitIssue(value, path) ?? snomedExpressionSyntaxIssue(value, path);
    if (snomedIssue) pushOnce(snomedIssue);

    if (value.system === 'http://unitsofmeasure.org' && typeof value.code === 'string') {
      const result = ucumValidator.validate(value.code);
      const unchecked = buildUnverifiedUcumIssue(value.code, `${path}.code`, result);
      if (unchecked) {
        pushCreatedOnce(unchecked);
      } else if (result.valid && ucumCodeHasAnnotation(value.code)) {
        pushOnce({
          severity: 'information',
          code: 'terminology-ucum-annotation',
          message: `UCUM code '${value.code}' at ${path}.code contains a human-readable annotation. UCUM annotations are ignored semantically, so validation should not depend on them`,
          path: `${path}.code`,
        });
      } else if (!result.valid) {
        pushOnce({
          severity: 'error',
          code: 'terminology-code-invalid',
          message: buildInvalidUcumMessage(value.code, `${path}.code`, result.message, result.suggestion),
          path: `${path}.code`,
          details: buildInvalidUcumIssueDetails(value.code, `${path}.code`, result.message, result.suggestion),
        });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (root === 'Bundle' && key === 'resource' && /^Bundle\.entry\[\d+\]$/.test(path)) {
        continue;
      }
      visit(child, `${path}.${key}`);
    }
  };

  visit(resource, root);
  return issues;
}

function resourceTypeOf(value: unknown): string {
  return isRecord(value) && typeof value.resourceType === 'string'
    ? value.resourceType
    : 'Resource';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
