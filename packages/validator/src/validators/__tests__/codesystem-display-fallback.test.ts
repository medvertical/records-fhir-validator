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

  it('does not use a fallback terminology server for another FHIR release', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://primary-r5.example/fhir',
      servers: [
        {
          id: 'primary-r5',
          url: 'https://primary-r5.example/fhir',
          enabled: true,
          fhirVersions: ['R5'],
        },
        {
          id: 'fallback-r4',
          url: 'https://fallback-r4.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
      ],
    });
    const validateCodeInCodeSystem = vi.fn().mockResolvedValue({
      valid: false,
      reason: 'display-mismatch',
      message: "Wrong Display Name 'Old label'. Valid display is 'Current label'",
    });
    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      '123456',
      'http://snomed.info/sct',
      'Old label',
      'R5',
    );

    expect(result.reason).toBe('display-mismatch');
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(1);
  });

  it('keeps SNOMED code-unknown results when an enabled preferred SNOMED server was used', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://primary.example/fhir',
      servers: [{
        id: 'snomed',
        url: 'https://primary.example/fhir',
        enabled: true,
        fhirVersions: ['R4'],
        preferredSystems: ['http://snomed.info/sct'],
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

  it('falls back from a generic server code-unknown result when another enabled server validates the code', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://generic.example/fhir',
      servers: [
        {
          id: 'generic',
          url: 'https://generic.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
        {
          id: 'tx-fhir-org-r4',
          url: 'https://tx.fhir.org/r4',
          enabled: true,
          fhirVersions: ['R4'],
        },
      ],
    });

    const validateCodeInCodeSystem = vi
      .fn()
      .mockResolvedValueOnce({
        valid: false,
        reason: 'code-unknown',
        message: "Unknown code '34117-2' in the CodeSystem 'http://loinc.org'",
      })
      .mockResolvedValueOnce({
        valid: true,
        display: 'History and physical note',
      });

    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      '34117-2',
      'http://loinc.org',
      'History and physical note',
    );

    expect(result.valid).toBe(true);
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(2);
    expect(validateCodeInCodeSystem).toHaveBeenNthCalledWith(
      1,
      '34117-2',
      'http://loinc.org',
      'History and physical note',
      undefined,
    );
    expect(validateCodeInCodeSystem).toHaveBeenNthCalledWith(
      2,
      '34117-2',
      'http://loinc.org',
      'History and physical note',
      { url: 'https://tx.fhir.org/r4', auth: undefined },
    );
  });

  it('keeps preferred-server code-unknown results even when fallback servers are configured', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://generic.example/fhir',
      servers: [
        {
          id: 'loinc-primary',
          url: 'https://loinc.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
          preferredSystems: ['http://loinc.org'],
        },
        {
          id: 'fallback',
          url: 'https://fallback.example/fhir',
          enabled: true,
          fhirVersions: ['R4'],
        },
      ],
    });

    const validateCodeInCodeSystem = vi.fn().mockResolvedValueOnce({
      valid: false,
      reason: 'code-unknown',
      message: "Unknown code 'BAD' in CodeSystem 'http://loinc.org'",
    });

    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      'BAD',
      'http://loinc.org',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('code-unknown');
    expect(validateCodeInCodeSystem).toHaveBeenCalledTimes(1);
    expect(validateCodeInCodeSystem).toHaveBeenCalledWith(
      'BAD',
      'http://loinc.org',
      undefined,
      { url: 'https://loinc.example/fhir', auth: undefined },
    );
  });

  it('treats SNOMED code-unknown as unverifiable when no preferred SNOMED server is configured', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://generic.example/fhir',
      servers: [{
        id: 'generic',
        url: 'https://generic.example/fhir',
        enabled: true,
        fhirVersions: ['R4'],
      }],
    });

    const validateCodeInCodeSystem = vi.fn().mockResolvedValue({
      valid: false,
      reason: 'code-unknown',
      message: "Unknown code '237600007' in CodeSystem 'http://snomed.info/sct'",
    });

    (validator as any).apiClient.validateCodeInCodeSystem = validateCodeInCodeSystem;

    const result = await validator.validateCodeInCodeSystem(
      '237600007',
      'http://snomed.info/sct',
      'Porphyria',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('system-unresolvable');
    expect(result.message).toContain('Could not verify SNOMED CT code');
  });

  it('treats unknown LOINC answer-list codes as unverifiable when the server lacks answer lists', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://loinc.example/fhir',
    });
    (validator as any).apiClient.validateCodeInCodeSystem = vi.fn().mockResolvedValue({
      valid: false,
      reason: 'code-unknown',
      message: "Unknown code 'LA33959-0' in CodeSystem 'http://loinc.org'",
    });

    const result = await validator.validateCodeInCodeSystem(
      'LA33959-0',
      'http://loinc.org',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('system-unresolvable');
    expect(result.message).toContain('answer-list code');
  });

  it('treats composite HGNC fusion notation as unverifiable by single-concept terminology servers', async () => {
    const validator = new ValueSetValidator();
    validator.setResolutionConfig({
      strategy: 'server-first',
      serverUrl: 'https://hgnc.example/fhir',
    });
    (validator as any).codeSystems.validateLocal = vi.fn().mockResolvedValue({
      valid: false,
      reason: 'code-unknown',
      message: "Unknown code 'HGNC:3689::HGNC:2697' in CodeSystem 'http://www.genenames.org/geneId'",
    });

    const result = await validator.validateCodeInCodeSystem(
      'HGNC:3689::HGNC:2697',
      'http://www.genenames.org/geneId',
      'FGFR2::DBP',
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('system-unresolvable');
    expect(result.message).toContain('composite HGNC fusion code');
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
