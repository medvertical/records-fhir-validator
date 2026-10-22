import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  validateExternalCodeSystems as validateExternalWithCache,
  validateLocalCodeSystemCoding,
} from '../terminology-external-code-system-rules';
import { ValueSetCache } from '../../../validators/valueset-cache';
import { buildCodeSystemResultIssues } from '../terminology-code-system-result-issues';

const valueSetCache = new ValueSetCache();
const validateExternalCodeSystems = (
  value: unknown,
  targetPath: string,
  validator: Parameters<typeof validateExternalWithCache>[2],
  fhirVersion?: 'R4' | 'R5' | 'R6',
  sourceContext?: Parameters<typeof validateExternalWithCache>[4],
) => validateExternalWithCache(value, targetPath, validator, fhirVersion, sourceContext, valueSetCache);

describe('terminology external CodeSystem rules', () => {
  it('records a remote execution failure without rejecting the code or losing the requested edition', () => {
    const version = 'http://snomed.info/sct/900000000000207008/version/20260701';
    expect(buildCodeSystemResultIssues(
      { system: 'http://snomed.info/sct', code: '53741008', version },
      { valid: false, reason: 'server-failure', message: 'The terminology server request failed.' },
      'Observation.code.coding', 0, true,
    )).toMatchObject([{
      code: 'terminology-server-failure', severity: 'warning',
      path: 'Observation.code.coding[0].system',
      details: { checkOutcome: 'execution-failure', codeSystemVersion: version },
    }]);
    expect(buildCodeSystemResultIssues(
      { system: 'http://snomed.info/sct', code: '53741008', version },
      { valid: false, reason: 'system-unresolvable', message: 'Requested edition is unavailable.' },
      'Observation.code.coding', 0, true,
    )).toMatchObject([{
      code: 'terminology-codesystem-unresolvable', severity: 'warning',
      details: { codeSystemVersion: version },
    }]);
  });

  const originalPackageCachePath = process.env.FHIR_PACKAGE_CACHE_PATH;

  beforeEach(() => {
    valueSetCache.clear();
    process.env.FHIR_PACKAGE_CACHE_PATH = originalPackageCachePath;
  });

  afterEach(() => {
    valueSetCache.clear();
    process.env.FHIR_PACKAGE_CACHE_PATH = originalPackageCachePath;
  });

  it('surfaces remote CodeSystem budget exhaustion as an informational issue', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn().mockResolvedValue({
        valid: true,
        reason: 'remote-budget-exhausted',
        message: 'Remote CodeSystem validation budget exhausted',
      }),
    };

    const issues = await validateExternalCodeSystems(
      {
        system: 'http://loinc.org',
        code: '1234-5',
        display: 'Local label',
      },
      'Questionnaire.item.code',
      valuesetValidator,
      'R4',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      aspect: 'terminology',
      severity: 'information',
      code: 'terminology-codesystem-unverified',
      path: 'Questionnaire.item.code.code',
      details: {
        code: '1234-5',
        system: 'http://loinc.org',
        reason: 'remote-budget-exhausted',
      },
    });
  });

  it('surfaces unsupported SNOMED national editions as informational evidence', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn().mockResolvedValue({
        valid: true,
        reason: 'national-extension-unverified',
        message: 'The configured terminology server lacks the required national edition',
      }),
    };

    const issues = await validateExternalCodeSystems(
      {
        system: 'http://snomed.info/sct',
        code: '35901911000001104',
      },
      'MedicationRequest.medicationCodeableConcept.coding[0]',
      valuesetValidator,
      'R4',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'information',
      code: 'terminology-codesystem-unverified',
      details: {
        system: 'http://snomed.info/sct',
        code: '35901911000001104',
        reason: 'national-extension-unverified',
      },
    });
  });

  it('downgrades Questionnaire-local choice codings without system to informational', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn(),
    };

    const issues = await validateExternalCodeSystems(
      {
        code: 'yes',
        display: 'Yes',
      },
      'Questionnaire.item[0].answerOption[0].valueCoding',
      valuesetValidator,
      'R4',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      aspect: 'terminology',
      severity: 'information',
      code: 'terminology-coding-missing-system',
      path: 'Questionnaire.item[0].answerOption[0].valueCoding',
      details: {
        code: 'yes',
        display: 'Yes',
        fieldPath: 'Questionnaire.item[0].answerOption[0].valueCoding',
      },
    });
    expect(valuesetValidator.validateCodeInCodeSystem).not.toHaveBeenCalled();
  });

  it('downgrades Questionnaire enableWhen answerCoding without system to informational', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn(),
    };

    const issues = await validateExternalCodeSystems(
      { code: 'yes' },
      'Questionnaire.item[0].enableWhen[0].answerCoding',
      valuesetValidator,
      'R4',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'information',
      code: 'terminology-coding-missing-system',
      path: 'Questionnaire.item[0].enableWhen[0].answerCoding',
    });
    expect(valuesetValidator.validateCodeInCodeSystem).not.toHaveBeenCalled();
  });

  it('ignores malformed Coding shapes without misreporting a missing system', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn(),
    };

    const issues = await validateExternalCodeSystems(
      [
        null,
        42,
        [],
        {},
        { code: { nested: true } },
        { system: 42, code: 'valid-code' },
        { system: 'http://loinc.org', code: 42 },
      ],
      'Observation.code.coding',
      valuesetValidator,
      'R4',
    );

    expect(issues).toEqual([]);
    expect(valuesetValidator.validateCodeInCodeSystem).not.toHaveBeenCalled();
  });

  it('reports an empty system only for a structurally usable Coding', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn(),
    };

    const issues = await validateExternalCodeSystems(
      { system: '', code: 'yes', display: 42 },
      'Questionnaire.item[0].answerOption[0].valueCoding',
      valuesetValidator,
      'R4',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'terminology-coding-missing-system',
      details: {
        code: 'yes',
        fieldPath: 'Questionnaire.item[0].answerOption[0].valueCoding',
      },
    });
    expect(issues[0]?.details).not.toHaveProperty('display');
    expect(valuesetValidator.validateCodeInCodeSystem).not.toHaveBeenCalled();
  });

  it('keeps malformed local CodeSystem codings away from the local resolver', async () => {
    const valuesetValidator = {
      validateCodeInLocalCodeSystemOnly: vi.fn(),
    };

    await expect(
      validateLocalCodeSystemCoding(
        { system: 'http://loinc.org', code: { nested: true } },
        'Observation.code.coding',
        valuesetValidator,
        'R4',
      ),
    ).resolves.toEqual([]);

    expect(valuesetValidator.validateCodeInLocalCodeSystemOnly).not.toHaveBeenCalled();
  });

  it('does not call external CodeSystem validation for lexically invalid FHIR code values', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn().mockResolvedValue({
        valid: false,
        reason: 'system-unresolvable',
      }),
    };

    const issues = await validateExternalCodeSystems(
      {
        system: 'http://snomed.info/sct',
        code: ' 422650009',
        display: 'Social isolation (finding)',
      },
      'Condition.code.coding',
      valuesetValidator,
      'R4',
    );

    expect(issues).toEqual([]);
    expect(valuesetValidator.validateCodeInCodeSystem).not.toHaveBeenCalled();
  });

  it('adds actionable guidance for relative Coding.system mnemonics', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn().mockResolvedValue({ valid: true }),
    };

    const issues = await validateExternalCodeSystems(
      {
        system: 'GPI',
        code: '66100020000330',
        display: 'IBUPROFEN TAB 600MG',
      },
      'MedicationDispense.medicationCodeableConcept.coding',
      valuesetValidator,
      'R4',
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'terminology-codesystem-unresolvable',
        path: 'MedicationDispense.medicationCodeableConcept.coding.system',
        details: expect.objectContaining({
          expectedSystemType: 'absolute CodeSystem URI',
          fixHint: expect.stringContaining("Coding.system 'GPI'"),
        }),
      }),
    );
  });

  it('does not require application meta.tag namespaces to resolve as CodeSystems', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn().mockResolvedValue({
        valid: false,
        reason: 'system-unresolvable',
      }),
    };

    const issues = await validateExternalCodeSystems(
      {
        system: 'https://records.health/fhir/CodeSystem/dataset',
        code: 'synthetic-test-data',
      },
      'Patient.meta.tag',
      valuesetValidator,
      'R4',
    );

    expect(issues).toEqual([]);
    expect(valuesetValidator.validateCodeInCodeSystem).not.toHaveBeenCalled();
  });

  it('does not report not-found when local CodeSystem validation loads the package definition', async () => {
    const system = 'https://fhir.kbv.de/CodeSystem/KBV_CS_FOR_Section_Type';
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn().mockImplementation(async () => {
        valueSetCache.setCodeSystem(system, {
          resourceType: 'CodeSystem',
          url: system,
          status: 'active',
          content: 'complete',
          concept: [{ code: 'Patient' }],
        } as any);
        return { valid: true };
      }),
    };

    const issues = await validateExternalCodeSystems(
      {
        system,
        code: 'Patient',
      },
      'Composition.section[0].code.coding',
      valuesetValidator,
      'R4',
    );

    expect(valuesetValidator.validateCodeInCodeSystem).toHaveBeenCalledWith('Patient', system, undefined, 'R4');
    expect(issues.filter((issue) => issue.code === 'not-found')).toHaveLength(0);
  });

  it('does not report not-found when the CodeSystem exists in a local FHIR package', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'terminology-codesystem-'));
    const packageDir = path.join(root, 'kbv.ita.eau#1.1.0', 'package');
    await fs.mkdir(packageDir, { recursive: true });
    process.env.FHIR_PACKAGE_CACHE_PATH = root;

    const system = 'https://fhir.kbv.de/CodeSystem/KBV_CS_FOR_Section_Type';
    await fs.writeFile(
      path.join(packageDir, 'KBV_CS_FOR_Section_Type.json'),
      JSON.stringify({
        resourceType: 'CodeSystem',
        url: system,
        status: 'active',
        content: 'complete',
        concept: [{ code: 'ICD', display: 'ICD-Code' }],
      }),
    );

    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn().mockResolvedValue({ valid: true }),
    };

    const issues = await validateExternalCodeSystems(
      {
        system,
        code: 'ICD',
      },
      'Composition.section[0].code.coding',
      valuesetValidator,
      'R4',
    );

    expect(issues.filter((issue) => issue.code === 'not-found')).toHaveLength(0);
  });

  it('suggests urn:oid for bare OID Coding.system values', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn().mockResolvedValue({ valid: true }),
    };

    const issues = await validateExternalCodeSystems(
      {
        system: '2.16.840.1.113883.6.88',
        code: 'A',
      },
      'Observation.code.coding',
      valuesetValidator,
      'R4',
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'terminology-codesystem-unresolvable',
        details: expect.objectContaining({
          suggestedSystem: 'urn:oid:2.16.840.1.113883.6.88',
          fixHint: expect.stringContaining('urn:oid:2.16.840.1.113883.6.88'),
        }),
      }),
    );
  });

  // Core example Contract/C-123 types its asset as 'RicardianContract' in the URI system.
  it('takes only absolute URIs as codes of urn:ietf:rfc:3986', async () => {
    const valuesetValidator = {
      validateCodeInCodeSystem: vi.fn().mockResolvedValue({ valid: true }),
    };
    const validate = (code: string) => validateExternalCodeSystems(
      [{ system: 'urn:ietf:rfc:3986', code }],
      'Contract.term[0].asset[0].type[0].coding',
      valuesetValidator,
      'R4',
    );

    expect(await validate('RicardianContract')).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'terminology-code-invalid',
      path: 'Contract.term[0].asset[0].type[0].coding[0].code',
    }));
    expect((await validate('http://example.org/contracts/ricardian'))
      .filter(issue => issue.code === 'terminology-code-invalid')).toHaveLength(0);
    expect((await validate('urn:oid:1.2.3')).filter(issue => issue.code === 'terminology-code-invalid')).toHaveLength(0);
  });
});
