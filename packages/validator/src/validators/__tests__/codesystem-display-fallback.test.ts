import { describe, expect, it, vi } from 'vitest';
import { ValueSetValidator } from '../valueset-validator';

describe('ValueSetValidator CodeSystem display fallback', () => {
  it('suppresses a primary display mismatch when another enabled terminology server accepts the display', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://primary.example/fhir',
      servers: [
        {
          id: 'primary',
          url: 'https://primary.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
        {
          id: 'secondary',
          url: 'https://secondary.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
      ],
    });

    const validateCodeInCodeSystem = vi
      .fn()
      .mockResolvedValueOnce({
        valid: false,
        reason: 'display-mismatch',
        message: "Wrong Display Name 'Opioid abuse (disorder)' for http://snomed.info/sct#5602001",
        issues: [{
          severity: 'error',
          code: 'invalid-display',
          message: "Wrong Display Name 'Opioid abuse (disorder)' for http://snomed.info/sct#5602001",
        }],
      })
      .mockResolvedValueOnce({ valid: true });

    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      '5602001',
      'http://snomed.info/sct',
      'Opioid abuse (disorder)',
    );

    expect(result.valid).toBe(true);
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(2);
    expect(validateCodeInCodeSystem).toHaveBeenNthCalledWith(
      1,
      '5602001',
      'http://snomed.info/sct',
      'Opioid abuse (disorder)',
      undefined,
    );
    expect(validateCodeInCodeSystem).toHaveBeenNthCalledWith(
      2,
      '5602001',
      'http://snomed.info/sct',
      'Opioid abuse (disorder)',
      { url: 'https://secondary.example/fhir', auth: undefined },
    );
  });

  it('keeps code-unknown results without fallback suppression', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://primary.example/fhir',
      servers: [{
        id: 'secondary',
        url: 'https://secondary.example/fhir',
        enabled: true,
        fhirVersions: ['R4'],
      }],
    });

    const validateCodeInCodeSystem = vi.fn().mockResolvedValue({
      valid: false,
      reason: 'code-unknown',
      message: "Unknown code 'bad-code' in CodeSystem 'http://snomed.info/sct'",
    });

    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      'bad-code',
      'http://snomed.info/sct',
      'Bad display',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('code-unknown');
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(1);
  });

  it('suppresses CodeSystem display mismatches that differ only in case or whitespace', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://primary.example/fhir',
      servers: [{
        id: 'primary',
        url: 'https://primary.example/fhir',
        enabled: true,
        fhirVersions: ['R4'],
      }],
    });

    const validateCodeInCodeSystem = vi.fn().mockResolvedValueOnce({
      valid: false,
      reason: 'display-mismatch',
      message: "Wrong Display Name '  stretching   exercises ' for http://snomed.info/sct#229070002. Valid display is 'Stretching exercises'",
      issues: [{
        severity: 'error',
        code: 'invalid-display',
        message: "Wrong Display Name '  stretching   exercises ' for http://snomed.info/sct#229070002. Valid display is 'Stretching exercises'",
      }],
    });

    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      '229070002',
      'http://snomed.info/sct',
      '  stretching   exercises ',
    );

    expect(result.valid).toBe(true);
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(1);
  });

  it('keeps CodeSystem display mismatches when the display is a different clinical label', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://primary.example/fhir',
      servers: [{
        id: 'primary',
        url: 'https://primary.example/fhir',
        enabled: true,
        fhirVersions: ['R4'],
      }],
    });

    const validateCodeInCodeSystem = vi.fn().mockResolvedValueOnce({
      valid: false,
      reason: 'display-mismatch',
      message: "Wrong Display Name 'Hypertension' for http://snomed.info/sct#59621000. Valid display is 'Essential hypertension'",
      issues: [{
        severity: 'error',
        code: 'invalid-display',
        message: "Wrong Display Name 'Hypertension' for http://snomed.info/sct#59621000. Valid display is 'Essential hypertension'",
      }],
    });

    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      '59621000',
      'http://snomed.info/sct',
      'Hypertension',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('display-mismatch');
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(1);
  });

  it('suppresses primary inactive warnings when another enabled terminology server reports the code as active', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://primary.example/fhir',
      servers: [
        {
          id: 'primary',
          url: 'https://primary.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
        {
          id: 'secondary',
          url: 'https://secondary.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
      ],
    });

    const validateCodeInCodeSystem = vi
      .fn()
      .mockResolvedValueOnce({
        valid: true,
        inactive: true,
        message: "The concept '315639002' has a status of inactive and its use should be reviewed",
        display: 'Initial patient assessment',
        issues: [{
          severity: 'warning',
          code: 'code-comment',
          message: "The concept '315639002' has a status of inactive and its use should be reviewed",
        }],
      })
      .mockResolvedValueOnce({
        valid: true,
        inactive: false,
        display: 'Initial patient assessment',
      });

    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      '315639002',
      'http://snomed.info/sct',
      'Initial patient assessment',
    );

    expect(result.valid).toBe(true);
    expect(result.inactive).toBe(false);
    expect(result.message).toBeUndefined();
    expect(result.issues).toBeUndefined();
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(2);
    expect(validateCodeInCodeSystem).toHaveBeenNthCalledWith(
      2,
      '315639002',
      'http://snomed.info/sct',
      undefined,
      { url: 'https://secondary.example/fhir', auth: undefined },
    );
  });

  it('suppresses primary inactive warnings when another terminology server omits the inactive flag', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://primary.example/fhir',
      servers: [
        {
          id: 'primary',
          url: 'https://primary.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
        {
          id: 'secondary',
          url: 'https://secondary.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
      ],
    });

    const validateCodeInCodeSystem = vi
      .fn()
      .mockResolvedValueOnce({
        valid: true,
        inactive: true,
        message: "The concept '394701000' has a status of inactive and its use should be reviewed",
        display: 'Asthma follow-up',
        issues: [{
          severity: 'warning',
          code: 'code-comment',
          message: "The concept '394701000' has a status of inactive and its use should be reviewed",
        }],
      })
      .mockResolvedValueOnce({
        valid: true,
        display: 'Asthma follow-up (regime/therapy)',
      });

    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      '394701000',
      'http://snomed.info/sct',
      'Asthma follow-up',
    );

    expect(result.valid).toBe(true);
    expect(result.inactive).toBe(false);
    expect(result.message).toBeUndefined();
    expect(result.issues).toBeUndefined();
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(2);
  });

  it('keeps inactive warnings when all terminology servers report the code as inactive', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://primary.example/fhir',
      servers: [
        {
          id: 'primary',
          url: 'https://primary.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
        {
          id: 'secondary',
          url: 'https://secondary.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
      ],
    });

    const inactiveResult = {
      valid: true,
      inactive: true,
      message: "The concept '713106006' has a status of inactive and its use should be reviewed",
      display: 'Screening for drug abuse',
      issues: [{
        severity: 'warning',
        code: 'code-comment',
        message: "The concept '713106006' has a status of inactive and its use should be reviewed",
      }],
    };
    const validateCodeInCodeSystem = vi.fn()
      .mockResolvedValueOnce(inactiveResult)
      .mockResolvedValueOnce(inactiveResult);

    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      '713106006',
      'http://snomed.info/sct',
    );

    expect(result.valid).toBe(true);
    expect(result.inactive).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(2);
  });
});
