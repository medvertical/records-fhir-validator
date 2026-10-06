import { afterEach, describe, expect, it, vi } from 'vitest';

const logs = vi.hoisted(() => ({
  debug: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../logger', () => ({ logger: logs }));

import { handleSDFHIRPathEvaluationFailure } from './sd-fhirpath-evaluation-failure';

const constraint = {
  key: 'demo-1',
  severity: 'error' as const,
  human: 'Demo constraint',
  expression: 'name.exists()',
};

describe('StructureDefinition FHIRPath evaluation failure policy', () => {
  afterEach(() => vi.clearAllMocks());

  it('retains unchecked evidence for asynchronous capability limitations', () => {
    const issues = handleSDFHIRPathEvaluationFailure({
      constraint,
      error: new Error('asynchronous function memberOf is not allowed'),
      path: 'Patient.name',
      phase: 'matched',
      resourceType: 'Patient',
    });

    expect(issues).toEqual([expect.objectContaining({
      code: 'profile-constraint-evaluation-error', severity: 'information',
      details: expect.objectContaining({ validationComplete: false }),
    })]);
    expect(logs.debug).toHaveBeenCalledWith(
      '[SDFHIRPathExecutor] Skipping unsupported async function',
      expect.any(Object),
    );
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it('maps matched-element failures to unchecked diagnostics with debug telemetry', () => {
    const issues = handleSDFHIRPathEvaluationFailure({
      constraint,
      error: new Error('compile failed'),
      path: 'Patient.name',
      phase: 'matched',
      profileUrl: 'https://example.test/StructureDefinition/Patient',
      resourceType: 'Patient',
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'profile-constraint-evaluation-error',
        severity: 'information',
        ruleId: 'demo-1',
      }),
    ]);
    expect(logs.debug).toHaveBeenCalledWith(
      '[SDFHIRPathExecutor] Matched constraint evaluation failed',
      expect.any(Object),
    );
    expect(logs.warn).not.toHaveBeenCalled();
  });

  it('maps collected-constraint failures with warning telemetry', () => {
    const issues = handleSDFHIRPathEvaluationFailure({
      constraint,
      error: new Error('evaluation failed'),
      path: 'Patient',
      phase: 'collected',
      resourceType: 'Patient',
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'profile-constraint-evaluation-error',
        severity: 'information',
        ruleId: 'demo-1',
      }),
    ]);
    expect(logs.warn).toHaveBeenCalledWith(
      '[SDFHIRPathExecutor] Collected constraint evaluation failed',
      expect.any(Object),
    );
  });
});
