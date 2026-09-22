import type { RecordsValidator } from './core/validator-engine.js';
import type { FhirClientLike } from './core/profile-loader-utils.js';
import type {
  PublicBatchValidationOptions,
  PublicFhirVersion,
  PublicValidationInput,
  PublicValidationRequest,
  PublicValidationResult,
} from './public-validation-api.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import type { AnomalyDetectorConfig, AnomalyFinding } from './validators/anomaly-detector.js';
import type { TerminologyResolutionConfig } from './validators/valueset-validator.js';

export type RecordsBatchValidationOptions =
  Omit<NonNullable<Parameters<RecordsValidator['validateBatch']>[1]>, 'fhirVersion'> & {
    fhirVersion?: PublicFhirVersion;
  };

export interface RecordsValidatorRuntimeLease {
  ready(): Promise<void>;
  loadProfileWithSnapshot(
    profileUrl: string,
    fhirVersion?: PublicFhirVersion,
  ): ReturnType<RecordsValidator['loadProfileWithSnapshot']>;
  resetProfileWarmupState(): Promise<void>;
  release(): void;
}

export interface RecordsValidationRequest extends PublicValidationRequest {
  referenceResolver?: Parameters<RecordsValidator['validate']>[5];
  organizationId?: number;
  runtimeScopeKey?: string;
  serverId?: number;
}

export interface RecordsValidatorValidation {
  validateRequest(request: RecordsValidationRequest): Promise<ValidationIssue[]>;
  /** @deprecated Use validateRequest() so optional values cannot be shifted accidentally. */
  validate(
    resource: unknown,
    profileUrl?: string,
    fhirVersion?: PublicFhirVersion,
    settings?: ValidationSettings,
    fhirClient?: FhirClientLike,
    referenceResolver?: Parameters<RecordsValidator['validate']>[5],
    organizationId?: number,
    runtimeScopeKey?: string,
    serverId?: number,
  ): Promise<ValidationIssue[]>;
  validateMetadata(...args: Parameters<RecordsValidator['validateMetadata']>): ReturnType<RecordsValidator['validateMetadata']>;
  validateStructure(
    resource: unknown,
    fhirVersion?: PublicFhirVersion,
    recursionDepth?: number,
  ): ReturnType<RecordsValidator['validateStructure']>;
  validateBatch(
    resources: Parameters<RecordsValidator['validateBatch']>[0],
    options?: RecordsBatchValidationOptions,
  ): ReturnType<RecordsValidator['validateBatch']>;
  validateAspects(
    resource: Parameters<RecordsValidator['validateAspects']>[0],
    options: RecordsBatchValidationOptions,
  ): ReturnType<RecordsValidator['validateAspects']>;
  validateAll(inputs: PublicValidationInput[], options?: PublicBatchValidationOptions): Promise<PublicValidationResult[]>;
  detectAnomalies(resources: unknown[], config?: Partial<AnomalyDetectorConfig>): Promise<AnomalyFinding[]>;
}

export interface RecordsValidatorInspection {
  isCreated(): boolean;
  isInitialized(): Promise<boolean>;
  isAvailable(): boolean;
  isProfileSupported(
    profileUrl: string,
    fhirVersion?: PublicFhirVersion,
    runtimeScopeKey?: string,
  ): ReturnType<RecordsValidator['isProfileSupported']>;
  waitForInitialization(): ReturnType<RecordsValidator['waitForInitialization']>;
  getSdLoader(
    fhirVersion?: PublicFhirVersion,
    runtimeScopeKey?: string,
  ): Promise<ReturnType<RecordsValidator['getSdLoader']>>;
  loadProfileWithSnapshot(
    profileUrl: string,
    fhirVersion?: PublicFhirVersion,
    runtimeScopeKey?: string,
  ): ReturnType<RecordsValidator['loadProfileWithSnapshot']>;
  registerQuestionnaire(
    questionnaire: { item?: unknown },
    fhirVersion?: PublicFhirVersion,
    runtimeScopeKey?: string,
  ): Promise<boolean>;
  getQuestionnaire(
    canonicalOrRef: Parameters<RecordsValidator['getQuestionnaire']>[0],
    fhirVersion?: PublicFhirVersion,
    runtimeScopeKey?: string,
  ): Promise<ReturnType<RecordsValidator['getQuestionnaire']>>;
  getConstraintDiagnostics(): Promise<ReturnType<RecordsValidator['getConstraintDiagnostics']>>;
  getFHIRPathCacheStats(): ReturnType<RecordsValidator['getFHIRPathCacheStats']>;
  getPinnedCanonicalCount(): ReturnType<RecordsValidator['getPinnedCanonicalCount']>;
  getPinnedCanonicalFingerprint(): ReturnType<RecordsValidator['getPinnedCanonicalFingerprint']>;
}

export interface RecordsValidatorAdministration {
  configureTerminologyResolution(config: TerminologyResolutionConfig): Promise<ReturnType<RecordsValidator['configureTerminologyResolution']>>;
  /** Scoped invalidation retires matching runtimes; in-flight leases stay isolated on the old instances. */
  clearTerminologyCache(options?: { runtimeScopePrefix: string }): Promise<ReturnType<RecordsValidator['clearTerminologyCache']>>;
  registerTerminologyResource(
    resource: unknown,
    fhirVersion?: PublicFhirVersion,
    runtimeScopeKey?: string,
  ): Promise<ReturnType<RecordsValidator['registerTerminologyResource']>>;
  clearConstraintDiagnostics(): Promise<ReturnType<RecordsValidator['clearConstraintDiagnostics']>>;
  clearFHIRPathCaches(): Promise<void>;
  clearProfileCache(): Promise<ReturnType<RecordsValidator['clearProfileCache']> | undefined>;
  resetProfileWarmupState(): Promise<void>;
  evictProfile(
    profileUrl: string,
    fhirVersion?: PublicFhirVersion,
  ): ReturnType<RecordsValidator['evictProfile']> | undefined;
  setPinnedCanonicals(...args: Parameters<RecordsValidator['setPinnedCanonicals']>): Promise<ReturnType<RecordsValidator['setPinnedCanonicals']>>;
}

export interface RecordsValidatorSingleton
  extends RecordsValidatorValidation, RecordsValidatorInspection, RecordsValidatorAdministration {}
