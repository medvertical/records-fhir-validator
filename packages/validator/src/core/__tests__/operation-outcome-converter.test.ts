/**
 * Tests for OperationOutcome Converter
 *
 * Validates HL7-conformant conversion between Records' internal
 * ValidationIssue[] and FHIR OperationOutcome resources.
 */
import { describe, it, expect } from 'vitest';
import {
  toOperationOutcome,
  fromOperationOutcome,
  mapToHl7IssueType,
  normalizeToHl7Severity,
  issueToOperationOutcomeIssue,
  type FhirOperationOutcome,
} from '../operation-outcome-converter';
import type { ValidationIssue } from '../../types';

// ============================================================================
// mapToHl7IssueType
// ============================================================================

describe('mapToHl7IssueType', () => {
  it('maps structural codes to correct HL7 types', () => {
    expect(mapToHl7IssueType('structural-required-element')).toBe('structure');
    expect(mapToHl7IssueType('structural-missing-resource-type')).toBe('structure');
    expect(mapToHl7IssueType('structural-resource-type-mismatch')).toBe('value');
    expect(mapToHl7IssueType('structural-invalid-json')).toBe('structure');
    expect(mapToHl7IssueType('structural-cardinality')).toBe('structure');
    // Java emits 'structure' for type mismatches (see bb-obs-value-is-not-quantity baseline)
    expect(mapToHl7IssueType('structural-type-mismatch')).toBe('structure');
    expect(mapToHl7IssueType('structural-unknown-element')).toBe('structure');
    expect(mapToHl7IssueType('structural-invalid-id')).toBe('invalid');
    expect(mapToHl7IssueType('structural-empty-array')).toBe('invalid');
    expect(mapToHl7IssueType('structural-other-thing')).toBe('structure');
  });

  it('maps profile codes to correct HL7 types', () => {
    expect(mapToHl7IssueType('profile-constraint-violation')).toBe('invariant');
    expect(mapToHl7IssueType('profile-slice-matching')).toBe('structure');
    expect(mapToHl7IssueType('profile-extension-missing')).toBe('extension');
    expect(mapToHl7IssueType('profile-not-found')).toBe('structure');
    expect(mapToHl7IssueType('profile-download')).toBe('transient');
    expect(mapToHl7IssueType('profile-load-error')).toBe('transient');
    expect(mapToHl7IssueType('profile-other')).toBe('invalid');
  });

  it('maps terminology codes to code-invalid', () => {
    expect(mapToHl7IssueType('terminology-binding-strength')).toBe('code-invalid');
    expect(mapToHl7IssueType('terminology-valueset-expansion')).toBe('code-invalid');
    expect(mapToHl7IssueType('terminology-unknown')).toBe('code-invalid');
  });

  it('maps reference codes to correct HL7 types', () => {
    expect(mapToHl7IssueType('reference-empty')).toBe('structure');
    expect(mapToHl7IssueType('reference-invalid-format')).toBe('value');
    expect(mapToHl7IssueType('reference-type-mismatch')).toBe('value');
    expect(mapToHl7IssueType('reference-contained-not-found')).toBe('not-found');
    expect(mapToHl7IssueType('reference-not-found')).toBe('not-found');
    expect(mapToHl7IssueType('reference-circular')).toBe('invalid');
    expect(mapToHl7IssueType('reference-unresolved')).toBe('not-found');
    expect(mapToHl7IssueType('reference-recursive-timeout')).toBe('timeout');
    expect(mapToHl7IssueType('reference-bundle-entry')).toBe('structure');
    expect(mapToHl7IssueType('reference-other')).toBe('invalid');
  });

  it('maps metadata codes to correct HL7 types', () => {
    expect(mapToHl7IssueType('metadata-missing-id')).toBe('structure');
    expect(mapToHl7IssueType('metadata-invalid-url')).toBe('value');
    expect(mapToHl7IssueType('metadata-chronological-order')).toBe('business-rule');
    expect(mapToHl7IssueType('metadata-other')).toBe('value');
  });

  it('maps business-rule codes', () => {
    expect(mapToHl7IssueType('business-rule-custom')).toBe('business-rule');
    expect(mapToHl7IssueType('business-other')).toBe('business-rule');
  });

  it('maps invariant codes', () => {
    expect(mapToHl7IssueType('invariant-dom-6')).toBe('invariant');
  });

  it('preserves exact HL7 issue-type codes', () => {
    expect(mapToHl7IssueType('structure')).toBe('structure');
    expect(mapToHl7IssueType('duplicate')).toBe('duplicate');
    expect(mapToHl7IssueType('not-found')).toBe('not-found');
    expect(mapToHl7IssueType('business-rule')).toBe('business-rule');
  });

  it('maps bundle searchset rules to "invalid" (matches Java baselines)', () => {
    expect(mapToHl7IssueType('bundle-searchset-missing-self-link')).toBe('invalid');
    expect(mapToHl7IssueType('bundle-searchset-missing-search-mode')).toBe('invalid');
    expect(mapToHl7IssueType('bundle-searchset-entry-missing-id')).toBe('invalid');
    expect(mapToHl7IssueType('bundle-searchset-outcome-wrong-type')).toBe('invalid');
    // The generic bundle- prefix still maps to business-rule (bdl-11/12)
    expect(mapToHl7IssueType('bundle-document-first-entry-not-composition')).toBe('business-rule');
  });

  it('uses fallback heuristics for unknown codes', () => {
    expect(mapToHl7IssueType('some-error-code')).toBe('invalid');
    expect(mapToHl7IssueType('field-invalid-value')).toBe('invalid');
    expect(mapToHl7IssueType('field-missing-data')).toBe('structure');
    expect(mapToHl7IssueType('field-required-element')).toBe('structure');
    expect(mapToHl7IssueType('resource-not-found')).toBe('not-found');
    expect(mapToHl7IssueType('operation-timeout')).toBe('timeout');
  });

  it('returns "processing" for completely unknown codes', () => {
    expect(mapToHl7IssueType('xyz-abc-123')).toBe('processing');
  });

  it('returns "processing" for undefined/empty', () => {
    expect(mapToHl7IssueType(undefined)).toBe('processing');
    expect(mapToHl7IssueType('')).toBe('processing');
  });
});

// ============================================================================
// normalizeToHl7Severity
// ============================================================================

describe('normalizeToHl7Severity', () => {
  it('passes through HL7 severities unchanged', () => {
    expect(normalizeToHl7Severity('fatal')).toBe('fatal');
    expect(normalizeToHl7Severity('error')).toBe('error');
    expect(normalizeToHl7Severity('warning')).toBe('warning');
    expect(normalizeToHl7Severity('information')).toBe('information');
  });

  it('maps Records "info" to HL7 "information"', () => {
    expect(normalizeToHl7Severity('info')).toBe('information');
  });

  it('maps "inherit" to "warning" as safe default', () => {
    expect(normalizeToHl7Severity('inherit')).toBe('warning');
  });

  it('defaults to "information" for unknown/undefined', () => {
    expect(normalizeToHl7Severity(undefined)).toBe('information');
    expect(normalizeToHl7Severity('unknown')).toBe('information');
    expect(normalizeToHl7Severity('')).toBe('information');
  });
});

// ============================================================================
// issueToOperationOutcomeIssue
// ============================================================================

describe('issueToOperationOutcomeIssue', () => {
  const baseIssue: ValidationIssue = {
    aspect: 'structural',
    severity: 'error',
    message: 'Element is required but missing',
    code: 'structural-required-element',
    path: 'Patient.identifier',
  };

  it('converts severity and code correctly', () => {
    const result = issueToOperationOutcomeIssue(baseIssue);
    expect(result.severity).toBe('error');
    expect(result.code).toBe('structure');
  });

  it('includes both HL7 and Records coding in details', () => {
    const result = issueToOperationOutcomeIssue(baseIssue);
    expect(result.details?.coding).toHaveLength(2);
    expect(result.details?.coding?.[0]).toEqual({
      system: 'http://hl7.org/fhir/issue-type',
      code: 'structure',
    });
    expect(result.details?.coding?.[1]).toEqual({
      system: 'https://records.medvertical.com/fhir/issue-code',
      code: 'structural-required-element',
    });
  });

  it('sets details.text from humanReadable or message', () => {
    const withHumanReadable: ValidationIssue = {
      ...baseIssue,
      humanReadable: 'A required element is missing',
    };
    expect(issueToOperationOutcomeIssue(withHumanReadable).details?.text)
      .toBe('A required element is missing');

    // Falls back to message
    expect(issueToOperationOutcomeIssue(baseIssue).details?.text)
      .toBe('Element is required but missing');
  });

  it('sets diagnostics from message', () => {
    const result = issueToOperationOutcomeIssue(baseIssue);
    expect(result.diagnostics).toBe('Element is required but missing');
  });

  it('sets expression from expression field, falls back to path', () => {
    const withExpression: ValidationIssue = {
      ...baseIssue,
      expression: 'Patient.identifier.where(system = "http://example.com")',
    };
    const result = issueToOperationOutcomeIssue(withExpression);
    expect(result.expression).toEqual([
      'Patient.identifier.where(system = "http://example.com")',
    ]);

    // Without expression, uses path
    const result2 = issueToOperationOutcomeIssue(baseIssue);
    expect(result2.expression).toEqual(['Patient.identifier']);
  });

  it('sets location from path (deprecated but expected)', () => {
    const result = issueToOperationOutcomeIssue(baseIssue);
    expect(result.location).toEqual(['Patient.identifier']);
  });

  it('handles issue without path', () => {
    const noPath: ValidationIssue = {
      aspect: 'structural',
      severity: 'warning',
      message: 'General warning',
    };
    const result = issueToOperationOutcomeIssue(noPath);
    expect(result.expression).toBeUndefined();
    expect(result.location).toBeUndefined();
  });

  it('handles issue without code (only HL7 coding)', () => {
    const noCode: ValidationIssue = {
      aspect: 'structural',
      severity: 'error',
      message: 'Something went wrong',
    };
    const result = issueToOperationOutcomeIssue(noCode);
    expect(result.code).toBe('processing');
    expect(result.details?.coding).toHaveLength(1);
    expect(result.details?.coding?.[0].system).toBe('http://hl7.org/fhir/issue-type');
  });

  it('maps "info" severity to "information"', () => {
    const infoIssue: ValidationIssue = {
      aspect: 'structural',
      severity: 'info',
      message: 'Info message',
    };
    const result = issueToOperationOutcomeIssue(infoIssue);
    expect(result.severity).toBe('information');
  });
});

// ============================================================================
// toOperationOutcome (round-trip entry point)
// ============================================================================

describe('toOperationOutcome', () => {
  it('produces valid OperationOutcome structure', () => {
    const issues: ValidationIssue[] = [
      {
        aspect: 'structural',
        severity: 'error',
        message: 'Missing required element',
        code: 'structural-required-element',
        path: 'Patient.name',
      },
      {
        aspect: 'terminology',
        severity: 'warning',
        message: 'Code not in ValueSet',
        code: 'terminology-binding-required',
        path: 'Patient.gender',
      },
    ];

    const outcome = toOperationOutcome(issues);
    expect(outcome.resourceType).toBe('OperationOutcome');
    expect(outcome.issue).toHaveLength(2);
    expect(outcome.issue[0].severity).toBe('error');
    expect(outcome.issue[0].code).toBe('structure');
    expect(outcome.issue[1].severity).toBe('warning');
    expect(outcome.issue[1].code).toBe('code-invalid');
  });

  it('handles empty issue array', () => {
    const outcome = toOperationOutcome([]);
    expect(outcome.resourceType).toBe('OperationOutcome');
    expect(outcome.issue).toEqual([]);
  });
});

// ============================================================================
// fromOperationOutcome (inverse conversion)
// ============================================================================

describe('fromOperationOutcome', () => {
  it('extracts Records-specific code from details.coding', () => {
    const outcome: FhirOperationOutcome = {
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'required',
        details: {
          coding: [
            { system: 'http://hl7.org/fhir/issue-type', code: 'required' },
            { system: 'https://records.medvertical.com/fhir/issue-code', code: 'structural-required-element' },
          ],
          text: 'Required element missing',
        },
        diagnostics: 'Element Patient.name is required',
        expression: ['Patient.name'],
        location: ['Patient.name'],
      }],
    };

    const issues = fromOperationOutcome(outcome);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('structural-required-element');
    expect(issues[0].aspect).toBe('structural');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toBe('Element Patient.name is required');
    expect(issues[0].path).toBe('Patient.name');
    expect(issues[0].expression).toBe('Patient.name');
    expect(issues[0].humanReadable).toBe('Required element missing');
  });

  it('maps HL7 code to aspect when no Records code present', () => {
    const outcome: FhirOperationOutcome = {
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'warning',
        code: 'code-invalid',
        details: { text: 'Code not in ValueSet' },
      }],
    };

    const issues = fromOperationOutcome(outcome);
    expect(issues[0].aspect).toBe('terminology');
    expect(issues[0].code).toBe('code-invalid');
  });

  it('maps "information" severity back to "info"', () => {
    const outcome: FhirOperationOutcome = {
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'information',
        code: 'informational',
      }],
    };

    const issues = fromOperationOutcome(outcome);
    expect(issues[0].severity).toBe('info');
  });

  it('handles empty/null outcome', () => {
    expect(fromOperationOutcome({ resourceType: 'OperationOutcome', issue: [] })).toEqual([]);
    expect(fromOperationOutcome(null as any)).toEqual([]);
    expect(fromOperationOutcome(undefined as any)).toEqual([]);
  });

  it('uses location as path fallback when expression missing', () => {
    const outcome: FhirOperationOutcome = {
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'value',
        location: ['Bundle.entry[0].resource'],
      }],
    };

    const issues = fromOperationOutcome(outcome);
    expect(issues[0].path).toBe('Bundle.entry[0].resource');
  });
});

// ============================================================================
// Round-trip: toOperationOutcome → fromOperationOutcome
// ============================================================================

describe('round-trip conversion', () => {
  it('preserves key fields through round-trip', () => {
    const original: ValidationIssue[] = [
      {
        aspect: 'structural',
        severity: 'error',
        message: 'Required element missing',
        code: 'structural-required-element',
        path: 'Patient.identifier',
        humanReadable: 'The identifier element is required',
      },
      {
        aspect: 'terminology',
        severity: 'warning',
        message: 'Code XYZ not found in ValueSet',
        code: 'terminology-binding-required',
        path: 'Observation.code',
      },
      {
        aspect: 'reference',
        severity: 'info',
        message: 'Reference target not validated',
        code: 'reference-unresolved',
        path: 'Encounter.subject',
        expression: 'Encounter.subject.reference',
      },
    ];

    const outcome = toOperationOutcome(original);
    const restored = fromOperationOutcome(outcome);

    expect(restored).toHaveLength(3);

    // Issue 0
    expect(restored[0].code).toBe('structural-required-element');
    expect(restored[0].severity).toBe('error');
    expect(restored[0].message).toBe('Required element missing');
    expect(restored[0].path).toBe('Patient.identifier');
    expect(restored[0].humanReadable).toBe('The identifier element is required');

    // Issue 1
    expect(restored[1].code).toBe('terminology-binding-required');
    expect(restored[1].severity).toBe('warning');
    expect(restored[1].message).toBe('Code XYZ not found in ValueSet');

    // Issue 2 — info → information → info
    expect(restored[2].code).toBe('reference-unresolved');
    expect(restored[2].severity).toBe('info');
    expect(restored[2].expression).toBe('Encounter.subject.reference');
  });
});
