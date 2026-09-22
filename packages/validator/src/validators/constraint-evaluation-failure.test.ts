import { afterEach, describe, expect, it, vi } from 'vitest';

const logs = vi.hoisted(() => ({
  debug: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../logger', () => ({ logger: logs }));

import { handleConstraintEvaluationFailure } from './constraint-evaluation-failure';

const constraint = {
  key: 'demo-1',
  severity: 'error' as const,
  human: 'Demo constraint',
  expression: 'name.exists()',
};

describe('constraint evaluation failure policy', () => {
  afterEach(() => vi.clearAllMocks());

  it('records and skips explicit engine capability limitations', () => {
    const record = vi.fn();

    const issues = handleConstraintEvaluationFailure({
      constraint,
      diagnosticTracker: { record },
      elementPath: 'Patient.name',
      error: new Error('asynchronous function memberOf is not allowed'),
      profileUrl: 'https://example.test/StructureDefinition/Patient',
      resourceType: 'Patient',
    });

    expect(issues).toEqual([]);
    expect(record).toHaveBeenCalledWith(
      'async-function',
      constraint,
      'https://example.test/StructureDefinition/Patient',
      'Patient.name',
      'asynchronous function memberOf is not allowed',
    );
    expect(logs.debug).toHaveBeenCalledWith(
      '[ConstraintValidator] Skipping unsupported FHIRPath function',
      expect.objectContaining({ skipReason: 'async-function' }),
    );
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it('maps other failures to unchecked diagnostics with warning telemetry', () => {
    const record = vi.fn();

    const issues = handleConstraintEvaluationFailure({
      constraint,
      diagnosticTracker: { record },
      elementPath: 'Patient.name',
      error: new Error('evaluation failed'),
      profileUrl: 'https://example.test/StructureDefinition/Patient',
      resourceType: 'Patient',
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'profile-constraint-evaluation-error',
        severity: 'information',
        ruleId: 'demo-1',
        details: expect.objectContaining({ validationStatus: 'incomplete' }),
      }),
    ]);
    expect(logs.warn).toHaveBeenCalledWith(
      '[ConstraintValidator] Constraint evaluation failed',
      expect.any(Object),
    );
  });

  // A FHIRPath 3.0 function fhirpath.js does not implement crashes the
  // compiler with a message no classifier can read. The constraint still
  // produced no verdict, so the skip count has to include it.
  it('counts a failure it cannot name', () => {
    const record = vi.fn();

    handleConstraintEvaluationFailure({
      constraint,
      diagnosticTracker: { record },
      elementPath: 'CodeSystem.concept',
      error: new TypeError("Cannot read properties of undefined (reading '0')"),
      profileUrl: 'http://hl7.org/fhir/StructureDefinition/CodeSystem',
      resourceType: 'CodeSystem',
    });

    expect(record).toHaveBeenCalledWith(
      'evaluation-error',
      constraint,
      'http://hl7.org/fhir/StructureDefinition/CodeSystem',
      'CodeSystem.concept',
      "Cannot read properties of undefined (reading '0')",
    );
  });
});
