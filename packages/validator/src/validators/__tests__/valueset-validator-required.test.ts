import { beforeEach, describe, expect, it } from 'vitest';
import { ValueSetValidator } from '../valueset-validator';
import { valueSetCache } from '../valueset-cache';

beforeEach(() => {
  valueSetCache.clear();
});

describe('ValueSetValidator required primitive bindings', () => {
  it('rejects invalid administrative-gender codes from local expansion', async () => {
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      'invalid-code',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1',
      },
      'Patient.gender',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('terminology-binding-required-code');
    expect(issues[0].path).toBe('Patient.gender');
  });

  it('rejects invalid observation-status codes from local expansion', async () => {
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      'invalid-status',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/observation-status|4.0.1',
      },
      'Observation.status',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('terminology-binding-required-code');
    expect(issues[0].path).toBe('Observation.status');
  });

  it('accepts valid Device.deviceName.type codes from local expansion', async () => {
    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      'model-name',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/device-nametype|4.0.1',
      },
      'Device.deviceName.type',
    );

    expect(issues).toHaveLength(0);
  });

  it('warns when Coding.display differs from the local CodeSystem concept display', async () => {
    const valueSetUrl = 'http://example.org/fhir/ValueSet/test';
    const systemUrl = 'http://example.org/fhir/CodeSystem/test';
    valueSetCache.setValueSetFile(valueSetUrl, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      status: 'active',
      compose: { include: [{ system: systemUrl }] },
    });
    valueSetCache.setExpandedCodes(valueSetUrl, new Set([`${systemUrl}|code`, 'code']));
    valueSetCache.setCodeSystem(systemUrl, {
      resourceType: 'CodeSystem',
      url: systemUrl,
      content: 'complete',
      concept: [{ code: 'code', display: 'Expected Display' }],
    });

    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      {
        coding: [{
          system: systemUrl,
          code: 'code',
          display: 'Wrong Display',
        }],
      },
      {
        strength: 'required',
        valueSet: valueSetUrl,
      },
      'Condition.code',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('terminology-display-mismatch');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].path).toBe('Condition.code.coding[0].display');
  });
});
