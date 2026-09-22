import { prewarmQuestionnaireAnswerValueSets } from '../questionnaire-valueset-prewarm.js';
import type { FhirResourceRecord } from '../reference/bundle-reference-types.js';
import type { ValidationSettings } from '@records-fhir/validation-types';
import {
  AnomalyDetector,
  type AnomalyDetectorConfig,
  type AnomalyFinding,
} from '../validators/anomaly-detector.js';
import { combineFHIRPathCacheStats } from '../validators/fhirpath-cache-diagnostics.js';
import type { TerminologyResolutionConfig } from '../validators/valueset-validator.js';
import type { ProfileWarmupCoordinator } from './profile-warmup-coordinator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { RecordsValidatorComponents } from './validator-engine-components.js';
import {
  applyProfileLoadingSettings,
  buildTerminologyResolutionConfig,
} from './validator-runtime-settings.js';

type FhirVersion = 'R4' | 'R5' | 'R6';

/** Operational controls exposed by RecordsValidator, separate from validation execution. */
export class ValidatorRuntimeControls {
  constructor(
    private readonly components: RecordsValidatorComponents,
    private readonly profileWarmupCoordinator: ProfileWarmupCoordinator,
  ) {}

  applySettings(settings?: ValidationSettings): void {
    if (!settings) return;
    applyProfileLoadingSettings(this.components.sdLoader, settings);
    this.configureTerminologyResolution(buildTerminologyResolutionConfig(settings));
  }

  isProfileSupported(profileUrl: string, fhirVersion: FhirVersion): Promise<boolean> {
    return this.components.profileAdministration.isProfileSupported(profileUrl, fhirVersion);
  }

  getSupportedProfiles(): string[] {
    return this.components.profileAdministration.getSupportedProfiles();
  }

  getSdLoader(): StructureDefinitionLoader {
    return this.components.profileAdministration.getSdLoader();
  }

  loadProfileWithSnapshot(profileUrl: string, fhirVersion: FhirVersion) {
    return this.components.profileAdministration.loadProfileWithSnapshot(profileUrl, fhirVersion);
  }

  registerQuestionnaire(questionnaire: unknown): boolean {
    return this.components.questionnaireRegistry.register(questionnaire);
  }

  async prewarmQuestionnaireAnswerValueSets(questionnaire: unknown): Promise<void> {
    await prewarmQuestionnaireAnswerValueSets(
      questionnaire,
      valueSetUrl => this.components.valuesetValidator.prewarmValueSet(valueSetUrl),
    );
  }

  getQuestionnaire(canonicalOrRef: string | undefined | null): FhirResourceRecord | null {
    return this.components.questionnaireRegistry.get(canonicalOrRef);
  }

  configureTerminologyResolution(config: TerminologyResolutionConfig): void {
    this.components.terminologyAdministration.configure(config);
  }

  clearTerminologyCache(): void {
    this.components.terminologyAdministration.clearCache();
  }

  registerTerminologyResource(resource: unknown, fhirVersion: FhirVersion): boolean {
    return this.components.terminologyAdministration.registerExternalResource(resource, fhirVersion);
  }

  getConstraintDiagnostics(): ReturnType<RecordsValidatorComponents['constraintValidator']['getDiagnostics']> {
    return this.components.constraintValidator.getDiagnostics();
  }

  clearConstraintDiagnostics(): void {
    this.components.constraintValidator.clearDiagnostics();
  }

  getFHIRPathCacheStats() {
    return combineFHIRPathCacheStats(
      this.components.constraintValidator.getExpressionCacheStats(),
      this.components.sdFHIRPathExecutor.getExpressionCacheStats(),
    );
  }

  clearFHIRPathCaches(): void {
    this.components.constraintValidator.clearExpressionCache();
    this.components.sdFHIRPathExecutor.clearExpressionCache();
  }

  clearProfileCache(): void {
    this.components.profileAdministration.clearProfileCache();
  }

  resetProfileWarmupState(): void {
    this.profileWarmupCoordinator.reset();
  }

  evictProfile(profileUrl: string, fhirVersion: FhirVersion): void {
    this.components.profileAdministration.evictProfile(profileUrl, fhirVersion);
  }

  setPinnedCanonicals(pinned: Map<string, string>): void {
    this.components.profileAdministration.setPinnedCanonicals(pinned);
  }

  getPinnedCanonicalCount(): number {
    return this.components.profileAdministration.getPinnedCanonicalCount();
  }

  getPinnedCanonicalFingerprint(): ReturnType<StructureDefinitionLoader['getPinnedCanonicalFingerprint']> {
    return this.components.profileAdministration.getPinnedCanonicalFingerprint();
  }

  detectAnomalies(
    resources: unknown[],
    config?: Partial<AnomalyDetectorConfig>,
  ): AnomalyFinding[] {
    if (config) return new AnomalyDetector(config).detect(resources);
    return this.components.anomalyDetector.detect(resources);
  }
}
