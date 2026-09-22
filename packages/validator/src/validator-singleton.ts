import { RecordsValidator } from './core/validator-engine.js';
import type { FhirClientLike } from './core/profile-loader-utils.js';
import { fingerprintPinnedCanonicals } from './core/sd-loader-pinned-canonical.js';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { resolveFhirReleaseContext, validateAllResources, type PublicFhirVersion } from './public-validation-api.js';
import { logger } from './logger.js';
import type { TerminologyResolutionConfig } from './validators/valueset-validator.js';
import { ValidatorRuntimeRegistry } from './validator-runtime-registry.js';
import {
  configurePublicReleaseRuntime,
  preparePublicReleaseRuntime,
  settingsWithPublicRelease,
} from './public-release-runtime.js';
import type {
  RecordsValidationRequest,
  RecordsValidatorRuntimeLease,
  RecordsValidatorSingleton,
} from './validator-singleton-types.js';
import * as singletonDefaults from './validator-singleton-defaults.js';
export { resolveScopedProfileCacheMaxEntries } from './validator-singleton-defaults.js';
import { mergeConstraintDiagnostics } from './validator-constraint-diagnostics.js';
import { mergeFHIRPathCacheStats } from './validator-fhirpath-cache-stats.js';
import { snapshotTerminologyConfig } from './validators/terminology-config-snapshot.js';
import { resolveConfiguredRecordsBatchRuntime } from './validator-batch-runtime.js';
export type {
  RecordsValidationRequest,
  RecordsValidatorAdministration,
  RecordsValidatorInspection,
  RecordsValidatorRuntimeLease, RecordsValidatorSingleton,
  RecordsValidatorValidation,
} from './validator-singleton-types.js';

let globalTerminologyResolutionConfig: TerminologyResolutionConfig | undefined;
let globalPinnedCanonicals: Map<string, string> | undefined;

async function createRecordsValidator(scoped = false): Promise<RecordsValidator> {
  const instance = new RecordsValidator({
    enableCaching: true,
    strictMode: false,
    timeout: 30000,
    allowedPackages: [...singletonDefaults.defaultAllowedPackages],
    profileCacheMaxEntries: scoped ? singletonDefaults.resolveScopedProfileCacheMaxEntries() : undefined,
    prewarmProfileSource: !scoped,
  });
  if (globalTerminologyResolutionConfig) {
    instance.configureTerminologyResolution(globalTerminologyResolutionConfig);
  }
  if (globalPinnedCanonicals) {
    instance.setPinnedCanonicals(new Map(globalPinnedCanonicals));
  }
  logger.info('[RecordsValidator] Validator initialized');
  return instance;
}

const runtimeRegistry = new ValidatorRuntimeRegistry(
  createRecordsValidator,
  singletonDefaults.MAX_SCOPED_VALIDATOR_INSTANCES,
);

async function getRecordsValidator(runtimeScopeKey?: string): Promise<RecordsValidator> {
  return runtimeRegistry.get(runtimeScopeKey);
}

async function getConfiguredRecordsValidator(
  fhirVersion: PublicFhirVersion = 'R4',
  runtimeScopeKey?: string,
) {
  const prepared = preparePublicReleaseRuntime(fhirVersion, runtimeScopeKey);
  const instance = await getRecordsValidator(prepared.runtimeScopeKey);
  configurePublicReleaseRuntime(instance, prepared.context);
  return { context: prepared.context, instance };
}

function currentOrDefaultValidatorPromises(): Promise<RecordsValidator>[] {
  const current = runtimeRegistry.currentPromises();
  return current.length > 0 ? current : [getRecordsValidator()];
}

export function acquireRecordsValidatorRuntime(
  runtimeScopeKey?: string, fhirVersion: PublicFhirVersion = 'R4',
): RecordsValidatorRuntimeLease {
  const prepared = preparePublicReleaseRuntime(fhirVersion, runtimeScopeKey);
  const primaryLease = runtimeRegistry.acquire(prepared.runtimeScopeKey);
  const acquiredLeases = new Map<string | undefined, typeof primaryLease>([
    [prepared.runtimeScopeKey, primaryLease],
  ]);
  let released = false;

  function leaseForVersion(requestedVersion: PublicFhirVersion) {
    const requested = preparePublicReleaseRuntime(requestedVersion, runtimeScopeKey);
    let requestedLease = acquiredLeases.get(requested.runtimeScopeKey);
    if (!requestedLease) {
      requestedLease = runtimeRegistry.acquire(requested.runtimeScopeKey);
      acquiredLeases.set(requested.runtimeScopeKey, requestedLease);
    }
    return { lease: requestedLease, prepared: requested };
  }

  return {
    async ready() {
      const instance = await primaryLease.promise;
      await instance.waitForInitialization();
      configurePublicReleaseRuntime(instance, prepared.context);
    },
    async loadProfileWithSnapshot(profileUrl, requestedVersion = fhirVersion) {
      const requested = leaseForVersion(requestedVersion);
      const instance = await requested.lease.promise;
      await instance.waitForInitialization();
      configurePublicReleaseRuntime(instance, requested.prepared.context);
      return instance.loadProfileWithSnapshot(
        profileUrl,
        requested.prepared.context.engineVersion,
      );
    },
    async resetProfileWarmupState() {
      const instance = await primaryLease.promise;
      instance.resetProfileWarmupState();
    },
    release() {
      if (released) return;
      released = true;
      for (const acquired of acquiredLeases.values()) acquired.release();
    },
  };
}

async function validateRecordsRequest(
  request: RecordsValidationRequest,
): Promise<ValidationIssue[]> {
  const { context, instance } = await getConfiguredRecordsValidator(
    request.fhirVersion ?? 'R4',
    request.runtimeScopeKey,
  );
  return instance.validate(
    request.resource,
    request.profileUrl,
    context.engineVersion,
    settingsWithPublicRelease(request.settings, context),
    request.fhirClient,
    request.referenceResolver,
    request.organizationId,
    request.serverId,
  );
}

export const recordsValidator: RecordsValidatorSingleton = {
  validateRequest: validateRecordsRequest,
  async validate(
    resource: unknown,
    profileUrl?: string,
    fhirVersion?: PublicFhirVersion,
    settings?: ValidationSettings,
    fhirClient?: FhirClientLike,
    referenceResolver?: Parameters<RecordsValidator['validate']>[5],
    organizationId?: number,
    runtimeScopeKey?: string,
    serverId?: number,
  ) {
    return validateRecordsRequest({
      resource,
      profileUrl,
      fhirVersion,
      settings,
      fhirClient,
      referenceResolver,
      organizationId,
      runtimeScopeKey,
      serverId,
    });
  },
  async validateMetadata(...args) {
    const instance = await getRecordsValidator();
    return instance.validateMetadata(...args);
  },
  async validateStructure(resource, fhirVersion = 'R4', recursionDepth = 0) {
    const { context, instance } = await getConfiguredRecordsValidator(fhirVersion);
    return instance.validateStructure(resource, context.engineVersion, recursionDepth);
  },
  async validateBatch(resources, options = {}) {
    const configured = await resolveConfiguredRecordsBatchRuntime(getRecordsValidator, options);
    return configured.instance.validateBatch(resources, configured.options);
  },
  async validateAspects(resource, options) {
    const configured = await resolveConfiguredRecordsBatchRuntime(getRecordsValidator, options);
    return configured.instance.validateAspects(resource, configured.options);
  },
  async validateAll(inputs, options) {
    return validateAllResources({
      validate: (resource, profileUrl, releaseContext, settings, fhirClient) =>
        validateRecordsRequest({
          resource,
          profileUrl,
          fhirVersion: releaseContext.publicVersion,
          settings,
          fhirClient,
        }),
      validateBatch: async (resources, batchOptions, releaseContext) => {
        const prepared = preparePublicReleaseRuntime(releaseContext.publicVersion);
        const instance = await getRecordsValidator(prepared.runtimeScopeKey);
        configurePublicReleaseRuntime(instance, releaseContext);
        return instance.validateBatch(resources, {
          ...batchOptions,
          settings: settingsWithPublicRelease(batchOptions.settings, releaseContext),
        });
      },
    }, inputs, options);
  },
  isCreated() {
    return runtimeRegistry.currentInstances().length > 0;
  },
  async isInitialized() {
    return runtimeRegistry.currentInstances().some(instance => instance.isAvailable());
  },
  isAvailable() {
    return runtimeRegistry.currentInstances().length > 0;
  },
  async isProfileSupported(profileUrl, fhirVersion = 'R4', runtimeScopeKey) {
    const { context, instance } = await getConfiguredRecordsValidator(fhirVersion, runtimeScopeKey);
    return instance.isProfileSupported(profileUrl, context.engineVersion);
  },
  async waitForInitialization() {
    const instance = await getRecordsValidator();
    return instance.waitForInitialization();
  },
  async getSdLoader(fhirVersion = 'R4', runtimeScopeKey) {
    const { instance } = await getConfiguredRecordsValidator(fhirVersion, runtimeScopeKey);
    await instance.waitForInitialization();
    return instance.getSdLoader();
  },
  async loadProfileWithSnapshot(profileUrl, fhirVersion = 'R4', runtimeScopeKey) {
    const { context, instance } = await getConfiguredRecordsValidator(fhirVersion, runtimeScopeKey);
    await instance.waitForInitialization();
    return instance.loadProfileWithSnapshot(profileUrl, context.engineVersion);
  },
  async registerQuestionnaire(questionnaire, fhirVersion = 'R4', runtimeScopeKey) {
    const { instance } = await getConfiguredRecordsValidator(fhirVersion, runtimeScopeKey);
    await instance.waitForInitialization();
    const ok = instance.registerQuestionnaire(questionnaire);
    if (ok) await instance.prewarmQuestionnaireAnswerValueSets(questionnaire);
    return ok;
  },
  async getQuestionnaire(
    canonicalOrRef: string | undefined | null,
    fhirVersion: PublicFhirVersion = 'R4',
    runtimeScopeKey?: string,
  ) {
    const { instance } = await getConfiguredRecordsValidator(fhirVersion, runtimeScopeKey);
    await instance.waitForInitialization();
    return instance.getQuestionnaire(canonicalOrRef);
  },
  async configureTerminologyResolution(config) {
    const snapshot = snapshotTerminologyConfig(config);
    globalTerminologyResolutionConfig = snapshot;
    await Promise.all(currentOrDefaultValidatorPromises().map(async entry => {
      (await entry).configureTerminologyResolution(snapshotTerminologyConfig(snapshot));
    }));
  },
  async clearTerminologyCache(options) {
    if (options?.runtimeScopePrefix) {
      runtimeRegistry.retireScopes(options.runtimeScopePrefix);
      return;
    }
    await Promise.all(currentOrDefaultValidatorPromises().map(async entry => {
      (await entry).clearTerminologyCache();
    }));
  },
  async registerTerminologyResource(resource, fhirVersion = 'R4', runtimeScopeKey) {
    const { context, instance } = await getConfiguredRecordsValidator(fhirVersion, runtimeScopeKey);
    return instance.registerTerminologyResource(resource, context.engineVersion);
  },
  async getConstraintDiagnostics() {
    const reports = await Promise.all(currentOrDefaultValidatorPromises().map(async pending =>
      (await pending).getConstraintDiagnostics()));
    return mergeConstraintDiagnostics(reports);
  },
  getFHIRPathCacheStats() {
    return mergeFHIRPathCacheStats(
      runtimeRegistry.currentInstances().map(instance => instance.getFHIRPathCacheStats()),
    );
  },
  async clearConstraintDiagnostics() {
    await Promise.all(currentOrDefaultValidatorPromises().map(async pending => {
      (await pending).clearConstraintDiagnostics();
    }));
  },
  async clearFHIRPathCaches() {
    await Promise.all(runtimeRegistry.currentPromises().map(async pending => {
      (await pending).clearFHIRPathCaches();
    }));
  },
  async clearProfileCache() {
    await Promise.all(runtimeRegistry.currentPromises().map(async pending => {
      (await pending).clearProfileCache();
    }));
  },
  async resetProfileWarmupState() {
    await Promise.all(runtimeRegistry.currentPromises().map(async pending => {
      (await pending).resetProfileWarmupState();
    }));
  },
  evictProfile(profileUrl, fhirVersion = 'R4') {
    const engineVersion = resolveFhirReleaseContext(fhirVersion).engineVersion;
    runtimeRegistry.peekDefault()?.evictProfile(profileUrl, engineVersion);
    for (const entry of runtimeRegistry.currentScopedEntries()) {
      if (entry.instance) {
        entry.instance.evictProfile(profileUrl, engineVersion);
      } else {
        void entry.promise.then(instance => instance.evictProfile(profileUrl, engineVersion));
      }
    }
  },
  async setPinnedCanonicals(pinnedCanonicals) {
    const snapshot = new Map(pinnedCanonicals);
    globalPinnedCanonicals = snapshot;
    await Promise.all(currentOrDefaultValidatorPromises().map(async entry => {
      (await entry).setPinnedCanonicals(new Map(snapshot));
    }));
  },
  getPinnedCanonicalCount(): number {
    return globalPinnedCanonicals?.size ?? runtimeRegistry.peekDefault()?.getPinnedCanonicalCount() ?? 0;
  },
  getPinnedCanonicalFingerprint() {
    if (globalPinnedCanonicals) return fingerprintPinnedCanonicals(globalPinnedCanonicals);
    return runtimeRegistry.peekDefault()?.getPinnedCanonicalFingerprint()
      ?? singletonDefaults.emptyPinnedCanonicalFingerprint;
  },
  async detectAnomalies(resources, config) {
    const instance = await getRecordsValidator();
    return instance.detectAnomalies(resources, config);
  },
};

export function getCombinedFHIRPathCacheStats() {
  return recordsValidator.getFHIRPathCacheStats();
}

export async function ensureRecordsValidatorReady(): Promise<void> {
  const instance = await getRecordsValidator();
  await instance.waitForInitialization();
}

export async function getRecordsValidatorClass() {
  return RecordsValidator;
}
