import { describe, expect, it } from 'vitest';
import {
  extractSubsumptionOutcome,
  operationOutcomeCannotResolveBinding,
  validateCodeSucceeded,
  valueSetValidationOutcome,
} from './terminology-parameters';
import {
  extractTerminologyIssues,
  mapOperationOutcomeIssues,
} from './terminology-api-outcome';
import {
  operationOutcomeToCodeSystemResult,
  parseCodeSystemValidationParameters,
} from './terminology-code-system-result';

describe('terminology response boundaries', () => {
  it('treats unsupported CodeSystem wording as missing terminology coverage', () => {
    const message = 'The terminology server does not support this code system';
    expect(parseCodeSystemValidationParameters({ resourceType: 'Parameters', parameter: [
      { name: 'result', valueBoolean: false }, { name: 'message', valueString: message },
    ] }, 'code', 'http://example.org/system')).toMatchObject({ reason: 'system-unresolvable' });
    expect(operationOutcomeToCodeSystemResult({ resourceType: 'OperationOutcome', issue: [
      { code: 'exception', diagnostics: message },
    ] }, 'code', 'http://example.org/system')).toMatchObject({ reason: 'system-unresolvable' });
  });

  it.each([
    null,
    { resourceType: 'Parameters', parameter: [] },
    { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: 'false' }] },
    { resourceType: 'OperationOutcome', issue: [{ code: 'not-found' }] },
    { resourceType: 'Parameters', parameter: [
      { name: 'result', valueBoolean: false },
      { name: 'issues', resource: { resourceType: 'OperationOutcome', issue: [
        { code: 'not-found', details: { text: "A definition for the value Set '#nested-0' could not be found" } },
      ] } },
    ] },
    { resourceType: 'Parameters', parameter: [
      { name: 'result', valueBoolean: false },
      { name: 'message', valueString: 'ValueSet could not be resolved by this terminology server' },
    ] },
  ])('leaves incomplete ValueSet responses unverified: %j', response => {
    expect(valueSetValidationOutcome(response)).toBe('unverified');
  });

  it('preserves a definitive non-membership result', () => {
    expect(valueSetValidationOutcome({ resourceType: 'Parameters', parameter: [
      { name: 'result', valueBoolean: false },
      { name: 'issues', resource: { resourceType: 'OperationOutcome', issue: [
        { code: 'code-invalid', details: { text: "The provided code was not found in the value set 'https://example.org/vs'" } },
      ] } },
    ] })).toBe('invalid');
  });

  it('does not accept malformed Parameters as successful validation', () => {
    expect(validateCodeSucceeded(null)).toBe(false);
    expect(validateCodeSucceeded({ resourceType: 'Parameters', parameter: [null] })).toBe(false);

    expect(parseCodeSystemValidationParameters(
      { resourceType: 'Patient', parameter: [] },
      'code',
      'http://example.com/system',
    )).toMatchObject({
      valid: false,
      reason: 'system-unresolvable',
    });
  });

  it.each([
    { resourceType: 'Parameters', parameter: [] },
    { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: 'false' }] },
    { resourceType: 'Parameters', parameter: [
      { name: 'result', valueBoolean: false },
      { name: 'issues', resource: { resourceType: 'OperationOutcome', issue: [{ code: 'not-found' }] } },
    ] },
  ])('does not turn an incomplete CodeSystem response into an invalid code: %j', response => {
    expect(parseCodeSystemValidationParameters(response, 'code', 'http://example.com/system'))
      .toMatchObject({ valid: false, reason: 'system-unresolvable' });
  });

  it('distinguishes an unknown CodeSystem from a rejected code', () => {
    expect(operationOutcomeToCodeSystemResult({ resourceType: 'OperationOutcome',
      issue: [{ code: 'not-found' }] }, 'code', 'http://example.com/system'))
      .toMatchObject({ reason: 'system-unresolvable' });
    expect(parseCodeSystemValidationParameters({ resourceType: 'Parameters',
      parameter: [{ name: 'result', valueBoolean: false }] }, 'code', 'http://example.com/system'))
      .toMatchObject({ valid: false, reason: 'code-unknown' });
  });

  it('accepts only declared FHIR subsumption outcomes', () => {
    const response = (valueCode: unknown) => ({
      resourceType: 'Parameters',
      parameter: [{ name: 'outcome', valueCode }],
    });

    expect(extractSubsumptionOutcome(response('subsumes'))).toBe('subsumes');
    expect(extractSubsumptionOutcome(response('invented-outcome'))).toBeUndefined();
    expect(extractSubsumptionOutcome(response(42))).toBeUndefined();
  });

  it('reads cannot-resolve evidence only from structured string fields', () => {
    expect(operationOutcomeCannotResolveBinding({
      resourceType: 'OperationOutcome',
      issue: [{ details: { text: 'Unable to resolve the requested ValueSet' } }],
    })).toBe(true);
    expect(operationOutcomeCannotResolveBinding({
      resourceType: 'OperationOutcome',
      issue: [{ details: { text: { message: 'Unable to resolve' } } }],
    })).toBe(false);
  });

  it('normalizes malformed issue fields without leaking non-strings', () => {
    const outcome = {
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'fatal',
        code: 42,
        diagnostics: { text: 'not a string' },
        expression: ['Patient.code', 7],
      }],
    };

    expect(mapOperationOutcomeIssues(outcome)).toEqual([{
      severity: 'error',
      code: 'terminology-issue',
      message: 'Terminology server reported a code issue',
      expression: ['Patient.code'],
    }]);
    expect(operationOutcomeToCodeSystemResult(
      outcome,
      'code',
      'http://example.com/system',
    ).message).toBe('Terminology server reported a code issue');
  });

  it('extracts nested OperationOutcome issues only from Parameters entries', () => {
    expect(extractTerminologyIssues({
      resourceType: 'Parameters',
      parameter: [{
        name: 'issues',
        resource: {
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'warning', diagnostics: 'Check display' }],
        },
      }],
    })).toEqual([expect.objectContaining({
      severity: 'warning',
      message: 'Check display',
    })]);
  });
});
