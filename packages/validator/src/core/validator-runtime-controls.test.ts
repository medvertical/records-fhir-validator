import { describe, expect, it, vi } from 'vitest';
import type { ValidationSettings } from '@records-fhir/validation-types';
import type { RecordsValidatorComponents } from './validator-engine-components';
import type { ProfileWarmupCoordinator } from './profile-warmup-coordinator';
import { ValidatorRuntimeControls } from './validator-runtime-controls';

const constraintStats = {
  hits: 2,
  misses: 1,
  compileErrors: 1,
  hitRate: '66.7%',
  size: 3,
};
const sdStats = {
  hits: 3,
  misses: 4,
  compileErrors: 0,
  hitRate: '42.9%',
  size: 5,
};

function createHarness() {
  const sdLoader = {
    isAutoDownloadEnabled: vi.fn(() => false),
    setAutoDownload: vi.fn(),
    setProfileSourcesConfig: vi.fn(),
    setAllowedPackages: vi.fn(),
    setPackageVersionPins: vi.fn(),
  };
  const profileAdministration = {
    isProfileSupported: vi.fn(async () => true),
    getSupportedProfiles: vi.fn(() => ['profile-a']),
    getSdLoader: vi.fn(() => sdLoader),
    loadProfileWithSnapshot: vi.fn(async () => ({ resourceType: 'StructureDefinition' })),
    clearProfileCache: vi.fn(),
    evictProfile: vi.fn(),
    setPinnedCanonicals: vi.fn(),
    getPinnedCanonicalCount: vi.fn(() => 1),
    getPinnedCanonicalFingerprint: vi.fn(() => ({ count: 1, hash: 'fingerprint' })),
  };
  const terminologyAdministration = {
    configure: vi.fn(),
    clearCache: vi.fn(),
    registerExternalResource: vi.fn(() => true),
  };
  const questionnaire = { resourceType: 'Questionnaire', id: 'questionnaire-a' };
  const questionnaireRegistry = {
    register: vi.fn(() => true),
    get: vi.fn(() => questionnaire),
  };
  const constraintValidator = {
    getDiagnostics: vi.fn(() => ({ evaluated: 3 })),
    clearDiagnostics: vi.fn(),
    getExpressionCacheStats: vi.fn(() => constraintStats),
    clearExpressionCache: vi.fn(),
  };
  const sdFHIRPathExecutor = {
    getExpressionCacheStats: vi.fn(() => sdStats),
    clearExpressionCache: vi.fn(),
  };
  const valuesetValidator = { prewarmValueSet: vi.fn(async () => null) };
  const anomalyDetector = { detect: vi.fn(() => [{ type: 'duplicate' }]) };
  const profileWarmupCoordinator = { reset: vi.fn() };
  const components = {
    sdLoader,
    profileAdministration,
    terminologyAdministration,
    questionnaireRegistry,
    constraintValidator,
    sdFHIRPathExecutor,
    valuesetValidator,
    anomalyDetector,
  } as unknown as RecordsValidatorComponents;

  return {
    controls: new ValidatorRuntimeControls(
      components,
      profileWarmupCoordinator as unknown as ProfileWarmupCoordinator,
    ),
    sdLoader,
    profileAdministration,
    terminologyAdministration,
    questionnaireRegistry,
    constraintValidator,
    sdFHIRPathExecutor,
    valuesetValidator,
    anomalyDetector,
    profileWarmupCoordinator,
    questionnaire,
  };
}

describe('ValidatorRuntimeControls', () => {
  it('applies profile and terminology settings through administration boundaries', () => {
    const harness = createHarness();
    const settings = {
      packageDownload: {
        autoDownload: true,
        approvedPackages: ['example.fhir'],
        pinnedVersions: { 'example.fhir': '1.0.0' },
      },
      profileSources: { simplifier: false, packageRegistry: true },
      terminologyServers: [],
    } as ValidationSettings;

    harness.controls.applySettings(settings);

    expect(harness.sdLoader.setAutoDownload).toHaveBeenCalledWith(true);
    expect(harness.sdLoader.setProfileSourcesConfig).toHaveBeenCalledWith({
      simplifier: false,
      packageRegistry: true,
    });
    expect(harness.sdLoader.setAllowedPackages).toHaveBeenCalledWith(['example.fhir']);
    expect(harness.sdLoader.setPackageVersionPins).toHaveBeenCalledWith({
      'example.fhir': '1.0.0',
    });
    expect(harness.terminologyAdministration.configure).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'local-only' }),
    );
  });

  it('routes operational APIs and combines cache diagnostics', async () => {
    const harness = createHarness();
    const pins = new Map([['profile-a', 'profile-a|1.0.0']]);

    await expect(harness.controls.isProfileSupported('profile-a', 'R4')).resolves.toBe(true);
    expect(harness.controls.getSupportedProfiles()).toEqual(['profile-a']);
    expect(harness.controls.getSdLoader()).toBe(harness.sdLoader);
    await expect(harness.controls.loadProfileWithSnapshot('profile-a', 'R4'))
      .resolves.toMatchObject({ resourceType: 'StructureDefinition' });
    expect(harness.controls.registerQuestionnaire(harness.questionnaire)).toBe(true);
    expect(harness.controls.getQuestionnaire('Questionnaire/questionnaire-a'))
      .toBe(harness.questionnaire);
    await harness.controls.prewarmQuestionnaireAnswerValueSets({
      item: [{ answerValueSet: 'https://example.test/ValueSet/answer' }],
    });
    expect(harness.valuesetValidator.prewarmValueSet)
      .toHaveBeenCalledWith('https://example.test/ValueSet/answer');

    expect(harness.controls.getConstraintDiagnostics()).toEqual({ evaluated: 3 });
    expect(harness.controls.getFHIRPathCacheStats().combined).toEqual({
      hits: 5,
      misses: 5,
      compileErrors: 1,
      hitRate: '50.0%',
      size: 8,
    });
    harness.controls.clearTerminologyCache();
    expect(harness.controls.registerTerminologyResource({ resourceType: 'ValueSet' }, 'R4'))
      .toBe(true);
    harness.controls.clearConstraintDiagnostics();
    harness.controls.clearFHIRPathCaches();
    harness.controls.clearProfileCache();
    harness.controls.resetProfileWarmupState();
    harness.controls.evictProfile('profile-a', 'R4');
    harness.controls.setPinnedCanonicals(pins);

    expect(harness.constraintValidator.clearDiagnostics).toHaveBeenCalledOnce();
    expect(harness.terminologyAdministration.clearCache).toHaveBeenCalledOnce();
    expect(harness.terminologyAdministration.registerExternalResource)
      .toHaveBeenCalledWith({ resourceType: 'ValueSet' }, 'R4');
    expect(harness.constraintValidator.clearExpressionCache).toHaveBeenCalledOnce();
    expect(harness.sdFHIRPathExecutor.clearExpressionCache).toHaveBeenCalledOnce();
    expect(harness.profileAdministration.clearProfileCache).toHaveBeenCalledOnce();
    expect(harness.profileWarmupCoordinator.reset).toHaveBeenCalledOnce();
    expect(harness.profileAdministration.evictProfile).toHaveBeenCalledWith('profile-a', 'R4');
    expect(harness.profileAdministration.setPinnedCanonicals).toHaveBeenCalledWith(pins);
    expect(harness.controls.getPinnedCanonicalCount()).toBe(1);
    expect(harness.controls.getPinnedCanonicalFingerprint()).toEqual({
      count: 1,
      hash: 'fingerprint',
    });
  });

  it('uses the shared detector by default and an isolated detector for overrides', () => {
    const harness = createHarness();

    expect(harness.controls.detectAnomalies([])).toEqual([{ type: 'duplicate' }]);
    expect(harness.anomalyDetector.detect).toHaveBeenCalledWith([]);
    expect(harness.controls.detectAnomalies([], {})).toEqual([]);
    expect(harness.anomalyDetector.detect).toHaveBeenCalledOnce();
  });
});
