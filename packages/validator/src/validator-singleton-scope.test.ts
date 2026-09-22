import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  configs: [] as Array<Record<string, unknown>>,
  validate: vi.fn().mockResolvedValue([]),
  validateBatch: vi.fn().mockResolvedValue(new Map()),
  validateStructure: vi.fn().mockResolvedValue([]),
  waitForInitialization: vi.fn().mockResolvedValue(undefined),
  loadProfileWithSnapshot: vi.fn().mockResolvedValue({ resourceType: 'StructureDefinition' }),
  resetProfileWarmupState: vi.fn(),
  registerQuestionnaire: vi.fn(() => true),
  prewarmQuestionnaireAnswerValueSets: vi.fn().mockResolvedValue(undefined),
  getQuestionnaire: vi.fn(() => ({ resourceType: 'Questionnaire' })),
  setPinnedCanonicals: vi.fn(),
  getConstraintDiagnostics: vi.fn(() => ({
    skippedConstraints: {
      total: 1,
      byReason: {
        'async-function': 0,
        'disallowed-function': 0,
        'unsupported-engine-capability': 1,
      },
      byConstraintKey: { 'r4b-test': 1 },
      byProfile: { 'https://profiles.example.test/R4B': 1 },
      samples: [],
    },
  })),
  clearConstraintDiagnostics: vi.fn(),
  getFHIRPathCacheStats: vi.fn(() => ({
    constraint: { hits: 1, misses: 1, compileErrors: 0, hitRate: '50.0%', size: 1 },
    sdExecutor: { hits: 2, misses: 0, compileErrors: 0, hitRate: '100.0%', size: 1 },
    combined: { hits: 3, misses: 1, compileErrors: 0, hitRate: '75.0%', size: 2 },
  })),
  getPackageVersionPins: vi.fn(() => ({})),
  setPackageVersionPins: vi.fn(),
  setSelectedCorePackage: vi.fn(),
  getAllowedPackages: vi.fn(() => [] as string[]),
  setAllowedPackages: vi.fn(),
  configureTerminologyResolution: vi.fn(),
  isAvailable: vi.fn(() => true),
}));

vi.mock('./core/validator-engine', () => ({
  RecordsValidator: class RecordsValidator {
    constructor(config: Record<string, unknown>) {
      mocks.constructor();
      mocks.configs.push(config);
    }

    validate = mocks.validate;
    validateBatch = mocks.validateBatch;
    validateStructure = mocks.validateStructure;
    waitForInitialization = mocks.waitForInitialization;
    loadProfileWithSnapshot = mocks.loadProfileWithSnapshot;
    resetProfileWarmupState = mocks.resetProfileWarmupState;
    registerQuestionnaire = mocks.registerQuestionnaire;
    prewarmQuestionnaireAnswerValueSets = mocks.prewarmQuestionnaireAnswerValueSets;
    getQuestionnaire = mocks.getQuestionnaire;
    setPinnedCanonicals = mocks.setPinnedCanonicals;
    getConstraintDiagnostics = mocks.getConstraintDiagnostics;
    clearConstraintDiagnostics = mocks.clearConstraintDiagnostics;
    getFHIRPathCacheStats = mocks.getFHIRPathCacheStats;
    getSdLoader = () => ({
      getPackageVersionPins: mocks.getPackageVersionPins,
      setPackageVersionPins: mocks.setPackageVersionPins,
      setSelectedCorePackage: mocks.setSelectedCorePackage,
      getAllowedPackages: mocks.getAllowedPackages,
      setAllowedPackages: mocks.setAllowedPackages,
    });
    configureTerminologyResolution = mocks.configureTerminologyResolution;
    isAvailable = mocks.isAvailable;
  },
}));

vi.mock('./logger', () => ({
  logger: { info: vi.fn() },
}));

import {
  acquireRecordsValidatorRuntime,
  recordsValidator,
} from './validator-singleton';

describe('Records validator runtime scope registry', () => {
  it('rotates only the requested tenant runtimes through terminology invalidation', async () => {
    const validate = (organizationId: number) => recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' }, fhirVersion: 'R4', organizationId,
      runtimeScopeKey: `${organizationId}:10:invalidation-test`,
    });
    await validate(991);
    await validate(992);
    expect(mocks.constructor).toHaveBeenCalledTimes(2);
    await recordsValidator.clearTerminologyCache({ runtimeScopePrefix: '991:' });
    await validate(992);
    expect(mocks.constructor).toHaveBeenCalledTimes(2);
    await validate(991);
    expect(mocks.constructor).toHaveBeenCalledTimes(3);
    await recordsValidator.clearTerminologyCache({ runtimeScopePrefix: '991:' });
    await recordsValidator.clearTerminologyCache({ runtimeScopePrefix: '992:' });
  });

  beforeEach(() => {
    mocks.constructor.mockClear();
    mocks.configs.length = 0;
    mocks.validate.mockClear();
    mocks.validateBatch.mockClear();
    mocks.validateStructure.mockClear();
    mocks.waitForInitialization.mockClear();
    mocks.loadProfileWithSnapshot.mockClear();
    mocks.resetProfileWarmupState.mockClear();
    mocks.registerQuestionnaire.mockClear();
    mocks.prewarmQuestionnaireAnswerValueSets.mockClear();
    mocks.getQuestionnaire.mockClear();
    mocks.setPinnedCanonicals.mockClear();
    mocks.getConstraintDiagnostics.mockClear();
    mocks.clearConstraintDiagnostics.mockClear();
    mocks.getFHIRPathCacheStats.mockClear();
    mocks.getPackageVersionPins.mockClear();
    mocks.setPackageVersionPins.mockClear();
    mocks.setSelectedCorePackage.mockClear();
    mocks.getAllowedPackages.mockClear();
    mocks.setAllowedPackages.mockClear();
    mocks.configureTerminologyResolution.mockClear();
    mocks.isAvailable.mockClear();
  });

  it('reports and aggregates active release runtimes without creating default R4', async () => {
    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4B',
      runtimeScopeKey: '71:10:r4b-diagnostics',
    });

    expect(recordsValidator.isCreated()).toBe(true);
    expect(recordsValidator.isAvailable()).toBe(true);
    await expect(recordsValidator.isInitialized()).resolves.toBe(true);

    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R5',
      runtimeScopeKey: '71:10:r5-diagnostics',
    });
    const constructorsAfterValidation = mocks.constructor.mock.calls.length;

    await expect(recordsValidator.getConstraintDiagnostics()).resolves.toMatchObject({
      skippedConstraints: {
        total: 2,
        byConstraintKey: { 'r4b-test': 2 },
      },
    });
    await recordsValidator.clearConstraintDiagnostics();
    expect(recordsValidator.getFHIRPathCacheStats()).toMatchObject({
      constraint: { hits: 2, misses: 2, hitRate: '50.0%', size: 2 },
      sdExecutor: { hits: 4, misses: 0, hitRate: '100.0%', size: 2 },
      combined: { hits: 6, misses: 2, hitRate: '75.0%', size: 4 },
    });

    expect(constructorsAfterValidation).toBe(2);
    expect(mocks.constructor).toHaveBeenCalledTimes(constructorsAfterValidation);
    expect(mocks.getConstraintDiagnostics).toHaveBeenCalledTimes(2);
    expect(mocks.clearConstraintDiagnostics).toHaveBeenCalledTimes(2);
    expect(mocks.getFHIRPathCacheStats).toHaveBeenCalledTimes(2);
  });

  it('reuses a validator within one immutable runtime scope', async () => {
    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4',
      organizationId: 1,
      runtimeScopeKey: '1:10:settings-a',
    });
    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4',
      organizationId: 1,
      runtimeScopeKey: '1:10:settings-a',
    });

    expect(mocks.constructor).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent cold starts for the same scope', async () => {
    await Promise.all(Array.from({ length: 20 }, () => recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4',
      organizationId: 5,
      runtimeScopeKey: '5:50:concurrent-settings',
    })));

    expect(mocks.constructor).toHaveBeenCalledTimes(1);
    expect(mocks.configs[0]).toMatchObject({
      prewarmProfileSource: false,
      profileCacheMaxEntries: 192,
      allowedPackages: expect.arrayContaining([
        'de.einwilligungsmanagement',
      ]),
    });
  });

  it('isolates validators for different tenant or settings scopes', async () => {
    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4',
      organizationId: 11,
      runtimeScopeKey: '11:10:settings-a',
    });
    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4',
      organizationId: 12,
      runtimeScopeKey: '12:10:settings-a',
    });
    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4',
      organizationId: 11,
      runtimeScopeKey: '11:10:settings-b',
    });

    expect(mocks.constructor).toHaveBeenCalledTimes(3);
  });

  it('pins one scoped instance across prepare, prewarm, and validation', async () => {
    const runtime = acquireRecordsValidatorRuntime('31:10:leased-settings');
    await runtime.ready();
    await runtime.loadProfileWithSnapshot(
      'https://profiles.example.test/Patient',
      'R5',
    );
    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R5',
      organizationId: 31,
      runtimeScopeKey: '31:10:leased-settings',
    });
    runtime.release();

    expect(mocks.constructor).toHaveBeenCalledTimes(1);
    expect(mocks.waitForInitialization).toHaveBeenCalledTimes(2);
    expect(mocks.loadProfileWithSnapshot).toHaveBeenCalledWith(
      'https://profiles.example.test/Patient',
      'R5',
    );
  });

  it('isolates R4B from the default R4 runtime and pins its core package', async () => {
    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4',
    });
    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4B',
    });

    expect(mocks.constructor).toHaveBeenCalledTimes(2);
    expect(mocks.validate).toHaveBeenLastCalledWith(
      { resourceType: 'Patient' },
      undefined,
      'R4',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(mocks.setPackageVersionPins).toHaveBeenCalledWith({
      'hl7.fhir.r4b.core': '4.3.0',
    });
    expect(mocks.setSelectedCorePackage).toHaveBeenCalledWith(undefined);
    expect(mocks.setSelectedCorePackage).toHaveBeenLastCalledWith('hl7.fhir.r4b.core');
  });

  it('routes a direct R4B batch through its release-scoped runtime', async () => {
    await recordsValidator.validateBatch([{ resourceType: 'Patient' }], {
      fhirVersion: 'R4B',
      runtimeScopeKey: '31:10:direct-batch',
    });

    expect(mocks.validateBatch).toHaveBeenLastCalledWith(
      [{ resourceType: 'Patient' }],
      expect.objectContaining({
        fhirVersion: 'R4',
        runtimeScopeKey: '31:10:direct-batch:release:R4B',
      }),
    );
    expect(mocks.setSelectedCorePackage).toHaveBeenLastCalledWith('hl7.fhir.r4b.core');
  });

  it('leases the requested R4B scope when prewarming through an R4 lease', async () => {
    const runtimeScopeKey = '41:10:release-aware-prewarm';
    const runtime = acquireRecordsValidatorRuntime(runtimeScopeKey, 'R4');
    await runtime.ready();
    await runtime.loadProfileWithSnapshot(
      'https://profiles.example.test/R4BPatient',
      'R4B',
    );
    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4B',
      runtimeScopeKey,
    });
    runtime.release();

    expect(mocks.constructor).toHaveBeenCalledTimes(2);
    expect(mocks.loadProfileWithSnapshot).toHaveBeenCalledWith(
      'https://profiles.example.test/R4BPatient',
      'R4',
    );
    expect(mocks.setPackageVersionPins).toHaveBeenCalledWith({
      'hl7.fhir.r4b.core': '4.3.0',
    });
  });

  it('reads a registered questionnaire from its R4B runtime scope', async () => {
    const runtimeScopeKey = '51:10:r4b-questionnaire';
    const questionnaire = {
      resourceType: 'Questionnaire',
      id: 'r4b-questionnaire',
    };
    await recordsValidator.registerQuestionnaire(questionnaire, 'R4B', runtimeScopeKey);
    const constructorsAfterRegistration = mocks.constructor.mock.calls.length;

    await expect(recordsValidator.getQuestionnaire(
      'Questionnaire/r4b-questionnaire',
      'R4B',
      runtimeScopeKey,
    )).resolves.toEqual({ resourceType: 'Questionnaire' });

    expect(mocks.constructor).toHaveBeenCalledTimes(constructorsAfterRegistration);
    expect(mocks.getQuestionnaire).toHaveBeenCalledWith(
      'Questionnaire/r4b-questionnaire',
    );
  });

  it('propagates canonical pins to a newly created R4B runtime', async () => {
    const pins = new Map([
      ['https://profiles.example.test/Patient', '1.2.3'],
    ]);
    await recordsValidator.setPinnedCanonicals(pins);
    const existingCalls = mocks.setPinnedCanonicals.mock.calls.length;

    expect(recordsValidator.getPinnedCanonicalCount()).toBe(1);
    expect(recordsValidator.getPinnedCanonicalFingerprint()).toMatchObject({
      algorithm: 'sha256-sorted-canonical-v1',
      count: 1,
    });

    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4B',
      runtimeScopeKey: '61:10:canonical-pins',
    });

    expect(mocks.setPinnedCanonicals).toHaveBeenCalledTimes(existingCalls + 1);
    expect(mocks.setPinnedCanonicals).toHaveBeenLastCalledWith(pins);
  });

  it('snapshots terminology configuration for runtimes created later', async () => {
    const config: Parameters<typeof recordsValidator.configureTerminologyResolution>[0] = {
      strategy: 'server-first',
      serverUrl: 'https://tx.example.test/r4',
      auth: { type: 'bearer', token: 'initial-token' },
      servers: [{
        id: 'primary',
        url: 'https://tx.example.test/r4',
        enabled: true,
        fhirVersions: ['R4'],
        preferredSystems: ['http://loinc.org'],
      }],
      serverDelegation: {
        expandValueSets: true,
        validateCodes: true,
        cacheResults: true,
        cacheTTLSeconds: 60,
      },
    };
    await recordsValidator.configureTerminologyResolution(config);
    const configuredRuntimeCount = mocks.configureTerminologyResolution.mock.calls.length;

    config.serverUrl = 'https://mutated.example.test/r4';
    config.auth!.token = 'mutated-token';
    config.servers![0].preferredSystems!.push('http://snomed.info/sct');
    config.serverDelegation!.cacheTTLSeconds = 999;

    await recordsValidator.validateRequest({
      resource: { resourceType: 'Patient' },
      fhirVersion: 'R4B',
      runtimeScopeKey: '81:10:terminology-snapshot',
    });

    expect(mocks.configureTerminologyResolution).toHaveBeenCalledTimes(
      configuredRuntimeCount + 1,
    );
    expect(mocks.configureTerminologyResolution).toHaveBeenLastCalledWith(expect.objectContaining({
      serverUrl: 'https://tx.example.test/r4',
      auth: { type: 'bearer', token: 'initial-token' },
      servers: [expect.objectContaining({
        preferredSystems: ['http://loinc.org'],
      })],
      serverDelegation: expect.objectContaining({ cacheTTLSeconds: 60 }),
    }));
  });
});
