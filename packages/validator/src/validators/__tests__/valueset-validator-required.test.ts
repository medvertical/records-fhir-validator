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

  it('errors when Coding.display differs from a required binding CodeSystem concept display', async () => {
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
    expect(issues[0].severity).toBe('error');
    expect(issues[0].path).toBe('Condition.code.coding[0].display');
  });

  it('does not warn when Coding.display only differs in case or whitespace', async () => {
    const valueSetUrl = 'http://example.org/fhir/ValueSet/test';
    const systemUrl = 'http://example.org/fhir/CodeSystem/test';
    valueSetCache.setValueSetFile(valueSetUrl, {
      resourceType: 'ValueSet',
      url: valueSetUrl,
      status: 'active',
      compose: { include: [{ system: systemUrl }] },
    });
    valueSetCache.setExpandedCodes(valueSetUrl, new Set([`${systemUrl}|vital-signs`, 'vital-signs']));
    valueSetCache.setCodeSystem(systemUrl, {
      resourceType: 'CodeSystem',
      url: systemUrl,
      content: 'complete',
      concept: [{ code: 'vital-signs', display: 'Vital Signs' }],
    });

    const validator = new ValueSetValidator();

    const issues = await validator.validateBinding(
      {
        coding: [{
          system: systemUrl,
          code: 'vital-signs',
          display: '  vital   signs ',
        }],
      },
      {
        strength: 'required',
        valueSet: valueSetUrl,
      },
      'Observation.category',
    );

    expect(issues).toHaveLength(0);
  });

  it('keeps unversioned ValueSet lookups isolated by requested FHIR version', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'local-only',
      serverUrl: undefined,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: false,
        cacheTTLSeconds: 0,
      },
    });

    const binding = {
      strength: 'extensible' as const,
      valueSet: 'http://hl7.org/fhir/ValueSet/provenance-activity-type',
    };
    const coding = {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation',
        code: 'CREATE',
      }],
    };

    const r5Issues = await validator.validateBinding(coding, binding, 'Provenance.activity', {
      fhirVersion: 'R5',
    });
    expect(r5Issues).toHaveLength(1);
    expect(r5Issues[0].code).toBe('terminology-binding-extensible');

    const r4Issues = await validator.validateBinding(coding, binding, 'Provenance.activity', {
      fhirVersion: 'R4',
    });
    expect(r4Issues).toHaveLength(0);
  });
});
