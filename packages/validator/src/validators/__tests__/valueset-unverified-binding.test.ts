import { beforeEach, describe, expect, it } from 'vitest';
import { ValueSetValidator } from '../valueset-validator';
import { valueSetCache } from '../valueset-cache';

beforeEach(() => {
  valueSetCache.clear();
});

/**
 * Gap P-3: a binding that cannot be expanded locally and is not confirmed by a
 * terminology server is "unverified", not "valid". Default behavior fails open
 * silently (precision-neutral); with `reportUnverifiedBindings` the skip is
 * surfaced as an informational issue.
 */
describe('ValueSetValidator unverified bindings (P-3)', () => {
  const valueSetUrl = 'http://example.org/fhir/ValueSet/unexpandable';
  const coding = {
    coding: [{ system: 'http://example.org/fhir/CodeSystem/cs', code: 'whatever' }],
  };

  it('stays silent by default when a binding cannot be verified', async () => {
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

    const issues = await validator.validateBinding(
      coding,
      { strength: 'extensible', valueSet: valueSetUrl },
      'Observation.code',
    );

    expect(issues).toHaveLength(0);
    expect(validator.getCacheStats().terminologyDiagnostics.unverifiedBindings).toEqual({
      total: 1,
      byReason: {
        'empty-expansion': 1,
        'unsupported-filter': 0,
        'unresolvable-snomed-extension-filter': 0,
        'validation-error': 0,
      },
    });
  });

  it('emits an informational issue when reportUnverifiedBindings is enabled', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'local-only',
      serverUrl: undefined,
      reportUnverifiedBindings: true,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: false,
        cacheTTLSeconds: 0,
      },
    });

    const issues = await validator.validateBinding(
      coding,
      { strength: 'extensible', valueSet: valueSetUrl },
      'Observation.code',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('terminology-binding-unverified');
    expect(issues[0].severity).toBe('information');
  });

  it('raises unverifiable required bindings to warning under strict policy', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'local-only',
      serverUrl: undefined,
      strictUnverifiedRequiredBindings: true,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: false,
        cacheTTLSeconds: 0,
      },
    });

    const issues = await validator.validateBinding(
      coding,
      { strength: 'required', valueSet: valueSetUrl },
      'Observation.code',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('terminology-binding-unverified');
    expect(issues[0].severity).toBe('warning');
  });

  it('keeps extensible bindings informational even under strict policy', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'local-only',
      serverUrl: undefined,
      strictUnverifiedRequiredBindings: true,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: false,
        cacheTTLSeconds: 0,
      },
    });

    const issues = await validator.validateBinding(
      coding,
      { strength: 'extensible', valueSet: valueSetUrl },
      'Observation.code',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('terminology-binding-unverified');
    expect(issues[0].severity).toBe('information');
  });

  it('does not downgrade a real local-expansion violation to unverified', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'local-only',
      serverUrl: undefined,
      reportUnverifiedBindings: true,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: false,
        cacheTTLSeconds: 0,
      },
    });

    // A non-empty local expansion is authoritative: an absent code is a real
    // violation, not "unverified".
    const issues = await validator.validateBinding(
      'invalid-code',
      {
        strength: 'required',
        valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1',
      },
      'Patient.gender',
    );

    expect(issues.some(issue => issue.code === 'terminology-binding-unverified')).toBe(false);
    expect(issues.some(issue => issue.code.startsWith('terminology-binding-required'))).toBe(true);
  });
});
