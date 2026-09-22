/**
 * OperationOutcome Converter
 *
 * Converts Records' internal ValidationIssue[] to HL7 FHIR OperationOutcome
 * resources. This is the output-boundary converter for HL7 conformance —
 * internal types remain unchanged.
 *
 * Reference: https://www.hl7.org/fhir/operationoutcome.html
 * Issue-type ValueSet: https://www.hl7.org/fhir/valueset-issue-type.html
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { computeValidationIssueId } from '@records-fhir/validation-types';
import { getCodeMetadata } from '../issues/message-catalog.js';
import {
  HL7_ISSUE_TYPE_SYSTEM,
  RECORDS_CODE_SYSTEM,
  mapToHl7IssueType,
  normalizeToHl7Severity,
} from './operation-outcome-issue-mapping.js';

export { mapToHl7IssueType, normalizeToHl7Severity } from './operation-outcome-issue-mapping.js';

// ============================================================================
// FHIR OperationOutcome Types (minimal, spec-conformant)
// ============================================================================

export interface FhirOperationOutcome {
  resourceType: 'OperationOutcome';
  issue: FhirOperationOutcomeIssue[];
}

export interface FhirOperationOutcomeIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  code: string;
  details?: {
    coding?: Array<{
      system: string;
      code: string;
      display?: string;
    }>;
    text?: string;
  };
  diagnostics?: string;
  location?: string[];
  expression?: string[];
}

/**
 * Convert a single ValidationIssue to an HL7 OperationOutcome.issue entry.
 */
export function issueToOperationOutcomeIssue(
  issue: ValidationIssue
): FhirOperationOutcomeIssue {
  const constraintKey = issue.details && typeof issue.details === 'object' && !Array.isArray(issue.details)
    ? (issue.details as Record<string, unknown>).constraintKey
    : undefined;
  // Java reports dom-3 as an invalid contained-resource relationship rather
  // than as the generic invariant category used for most FHIRPath failures.
  const hl7Code = constraintKey === 'dom-3'
    ? 'invalid'
    : mapToHl7IssueType(issue.code);

  const result: FhirOperationOutcomeIssue = {
    severity: normalizeToHl7Severity(issue.severity),
    code: hl7Code,
  };

  // details.coding — both HL7 issue-type and Records-specific code
  const codings: FhirOperationOutcomeIssue['details'] = {
    coding: [
      {
        system: HL7_ISSUE_TYPE_SYSTEM,
        code: hl7Code,
      },
    ],
  };

  // Add Records-specific code as second coding for traceability
  if (issue.code) {
    codings.coding!.push({
      system: RECORDS_CODE_SYSTEM,
      code: issue.code,
    });
  }

  // details.text — human-readable message
  if (issue.humanReadable || issue.message) {
    codings.text = issue.humanReadable || issue.message;
  }

  result.details = codings;

  // diagnostics — technical message
  if (issue.message) {
    result.diagnostics = issue.message;
  }

  // expression — FHIRPath (preferred by HL7)
  const fhirPath = issue.expression || issue.path;
  if (fhirPath) {
    result.expression = [fhirPath];
  }

  // location — deprecated but still expected by some consumers
  if (issue.path) {
    result.location = [issue.path];
  }

  return result;
}

/**
 * Convert Records ValidationIssue[] to a FHIR OperationOutcome resource.
 *
 * This is the main entry point for HL7-conformant output. The resulting
 * OperationOutcome can be:
 * - Returned from a $validate endpoint
 * - Diffed against fhir-test-cases java baseline
 * - Consumed by HL7 tooling (IG Publisher, Inferno, etc.)
 */
export function toOperationOutcome(
  issues: ValidationIssue[]
): FhirOperationOutcome {
  return {
    resourceType: 'OperationOutcome',
    issue: issues.map(issueToOperationOutcomeIssue),
  };
}

/**
 * Convert a FHIR OperationOutcome back to ValidationIssue[].
 * Inverse of toOperationOutcome() — used for parsing external validator output.
 */
export function fromOperationOutcome(
  outcome: unknown,
): ValidationIssue[] {
  const outcomeRecord = asRecord(outcome);
  if (!outcomeRecord || !Array.isArray(outcomeRecord.issue)) return [];

  return outcomeRecord.issue.flatMap(candidate => {
    const ooIssue = asRecord(candidate);
    if (!ooIssue) return [];
    return [operationOutcomeIssueToValidationIssue(ooIssue)];
  });
}

/**
 * Convert a DetailedValidationResult (from the service layer) to OperationOutcome.
 *
 * Accepts any object with an `issues` array of ValidationIssue-compatible items.
 * This decouples from the concrete type to avoid import-chain issues between
 * the schema and service layer DetailedValidationResult variants.
 */
export function detailedResultToOperationOutcome(
  result: unknown,
): FhirOperationOutcome {
  const resultRecord = asRecord(result);
  if (!resultRecord || !Array.isArray(resultRecord.issues)) {
    return { resourceType: 'OperationOutcome', issue: [] };
  }

  const mapped: ValidationIssue[] = resultRecord.issues.flatMap(candidate => {
    const issue = asRecord(candidate);
    if (!issue) return [];
    return [{
      aspect: stringValue(issue.aspect) ?? 'structural',
      severity: normalizeImportedSeverity(issue.severity),
      message: stringValue(issue.message) ?? '',
      path: stringValue(issue.path),
      code: stringValue(issue.code),
      expression: stringValue(issue.expression),
      humanReadable: stringValue(issue.humanReadable),
    }];
  });

  return toOperationOutcome(mapped);
}

function operationOutcomeIssueToValidationIssue(
  ooIssue: Record<string, unknown>,
): ValidationIssue {
  const details = asRecord(ooIssue.details);
  const recordsCode = getRecordsCode(details?.coding);
  const hl7Code = stringValue(ooIssue.code) ?? 'processing';
  const aspect = recordsCode
    ? mapRecordsCodeToAspect(recordsCode, hl7Code)
    : mapHl7CodeToAspect(hl7Code);
  const severity = normalizeImportedSeverity(ooIssue.severity);
  const message = stringValue(ooIssue.diagnostics) ?? stringValue(details?.text) ?? '';
  const expression = firstString(ooIssue.expression);
  const path = expression ?? firstString(ooIssue.location) ?? '';
  const code = recordsCode ?? hl7Code;
  const humanReadable = stringValue(details?.text);

  return {
    id: computeValidationIssueId({
      aspect,
      severity,
      code,
      message,
      path,
    }),
    aspect,
    severity,
    code,
    message,
    path,
    expression,
    humanReadable,
    timestamp: new Date(),
  };
}

function getRecordsCode(codingValue: unknown): string | undefined {
  if (!Array.isArray(codingValue)) return undefined;
  for (const candidate of codingValue) {
    const coding = asRecord(candidate);
    if (
      coding?.system === RECORDS_CODE_SYSTEM &&
      typeof coding.code === 'string' &&
      coding.code.length > 0
    ) {
      return coding.code;
    }
  }
  return undefined;
}

function mapRecordsCodeToAspect(code: string, hl7Code: string): string {
  const catalogAspect = getCodeMetadata(code)?.aspect;
  if (catalogAspect) return catalogAspect;
  if (/^(profile|constraint|slice|extension)-/.test(code)) return 'profile';
  if (/^(terminology|binding|valueset|codesystem)-/.test(code)) return 'terminology';
  if (code.startsWith('reference-')) return 'reference';
  if (code.startsWith('metadata-')) return 'metadata';
  if (/^(business|custom-rule)-/.test(code)) return 'custom_rule';
  if (code.startsWith('invariant-')) return 'invariant';
  if (/^(structural|bundle)-/.test(code)) return 'structural';
  return mapHl7CodeToAspect(hl7Code);
}

function normalizeImportedSeverity(value: unknown): ValidationIssue['severity'] {
  switch (value) {
    case 'fatal':
    case 'error':
    case 'warning':
    case 'info':
      return value;
    case 'information':
    default:
      return 'info';
  }
}

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.find(candidate => typeof candidate === 'string') as string | undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Map HL7 issue-type code to Records aspect (best effort).
 */
function mapHl7CodeToAspect(code: string): string {
  switch (code) {
    case 'structure':
    case 'required':
      return 'structural';
    case 'invariant':
      return 'invariant';
    case 'code-invalid':
      return 'terminology';
    case 'not-found':
    case 'timeout':
      return 'reference';
    case 'extension':
      return 'profile';
    case 'business-rule':
      return 'custom_rule';
    case 'value':
    case 'invalid':
    default:
      return 'structural';
  }
}
