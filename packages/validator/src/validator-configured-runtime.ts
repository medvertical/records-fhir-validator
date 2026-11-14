import type { PublicFhirVersion } from './public-validation-api.js';
import type { RecordsValidator } from './core/validator-engine.js';
import {
  configurePublicReleaseRuntime,
  preparePublicReleaseRuntime,
  settingsWithPublicRelease,
} from './public-release-runtime.js';
import type { RecordsBatchValidationOptions, RecordsValidatorRuntimeConfiguration } from './validator-singleton-types.js';
import type { RecordsValidatorConfig } from './core/validator-engine-config.js';

type RuntimeResolver = (key?: string, config?: RecordsValidatorConfig) => Promise<RecordsValidator>;

export function prepareConfiguredRecordsRuntime(
  fhirVersion: PublicFhirVersion,
  runtimeScopeKey?: string,
  runtime?: RecordsValidatorRuntimeConfiguration,
) {
  if (runtime?.fhirVersion && runtime.fhirVersion !== fhirVersion) {
    throw new Error(`Validator runtime configuration requires FHIR ${runtime.fhirVersion}`);
  }
  const key = runtime ? `${runtimeScopeKey ?? 'standalone'}:config:${runtime.key}` : runtimeScopeKey;
  return preparePublicReleaseRuntime(fhirVersion, key);
}

export async function resolveConfiguredRecordsRuntime(
  resolveRuntime: RuntimeResolver, fhirVersion: PublicFhirVersion = 'R4',
  runtimeScopeKey?: string, runtime?: RecordsValidatorRuntimeConfiguration,
) {
  const prepared = prepareConfiguredRecordsRuntime(fhirVersion, runtimeScopeKey, runtime);
  const instance = await resolveRuntime(prepared.runtimeScopeKey, runtime?.config);
  configurePublicReleaseRuntime(instance, prepared.context);
  return { ...prepared, instance };
}

export async function resolveConfiguredRecordsBatchRuntime(
  resolveRuntime: RuntimeResolver, options: RecordsBatchValidationOptions,
  runtime?: RecordsValidatorRuntimeConfiguration,
) {
  const { instance, context, runtimeScopeKey } = await resolveConfiguredRecordsRuntime(
    resolveRuntime, options.fhirVersion, options.runtimeScopeKey, runtime);
  return {
    instance,
    options: {
      ...options,
      fhirVersion: context.engineVersion,
      selectedRelease: options.selectedRelease === undefined ? context.publicVersion : options.selectedRelease,
      runtimeScopeKey,
      settings: settingsWithPublicRelease(options.settings, context),
    },
  };
}
