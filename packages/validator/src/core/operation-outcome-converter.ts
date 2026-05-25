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

import type { ValidationIssue } from '../types';
import {
  HL7_ISSUE_TYPE_SYSTEM,
  RECORDS_CODE_SYSTEM,
  mapToHl7IssueType,
  normalizeToHl7Severity,
} from './operation-outcome-issue-mapping';

export { mapToHl7IssueType, normalizeToHl7Severity } from './operation-outcome-issue-mapping';

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
  const hl7Code = mapToHl7IssueType(issue.code);

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
  outcome: FhirOperationOutcome
): ValidationIssue[] {
  if (!outcome?.issue) return [];

  return outcome.issue.map((ooIssue, index) => {
    // Try to extract Records-specific code from details.coding
    const recordsCode = ooIssue.details?.coding?.find(
      c => c.system === RECORDS_CODE_SYSTEM
    )?.code;

    // Determine aspect from code prefix or HL7 code
    const aspect = recordsCode
      ? (recordsCode.split('-')[0] as ValidationIssue['aspect']) || 'structural'
      : mapHl7CodeToAspect(ooIssue.code);

    return {
      id: `oo-${index}-${Date.now()}`,
      aspect,
      severity: ooIssue.severity === 'information' ? 'info' : ooIssue.severity,
      code: recordsCode || ooIssue.code,
      message: ooIssue.diagnostics || ooIssue.details?.text || '',
      path: ooIssue.expression?.[0] || ooIssue.location?.[0] || '',
      expression: ooIssue.expression?.[0],
      humanReadable: ooIssue.details?.text,
      timestamp: new Date(),
    } as ValidationIssue;
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
  result: { issues?: Array<Partial<ValidationIssue>> }
): FhirOperationOutcome {
  if (!result.issues?.length) {
    return { resourceType: 'OperationOutcome', issue: [] };
  }

  const mapped: ValidationIssue[] = result.issues.map(i => ({
    aspect: i.aspect || 'structural',
    severity: i.severity || 'info',
    message: i.message || '',
    path: i.path,
    code: i.code,
    expression: i.expression,
    humanReadable: i.humanReadable,
  }));

  return toOperationOutcome(mapped);
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
      return 'customRule';
    case 'value':
    case 'invalid':
    default:
      return 'structural';
  }
}
