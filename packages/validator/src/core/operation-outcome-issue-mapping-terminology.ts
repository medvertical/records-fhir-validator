import type { Hl7IssueType } from './operation-outcome-issue-types.js';

// Lifecycle diagnostics must precede the general terminology fallback.
export const TERMINOLOGY_PREFIX_TO_HL7_ISSUE_TYPE: Array<[string, Hl7IssueType]> = [
  ['terminology-code-inactive', 'business-rule'],
  ['terminology-code-retired', 'business-rule'],
  ['terminology-code-deprecated', 'business-rule'],
  ['terminology-codesystem-url-not-absolute', 'invalid'],
  ['terminology-codesystem-unresolvable', 'not-found'],
  ['terminology-codesystem-undefined', 'invalid'],
  ['terminology-binding-extensible-no-code', 'code-invalid'],
  ['terminology-display-mismatch', 'invalid'],
  ['terminology-binding-', 'code-invalid'],
  ['terminology-valueset-', 'code-invalid'],
  ['terminology-', 'code-invalid'],
];
