import type { RecordsValidator } from './core/validator-engine.js';
import {
  configurePublicReleaseRuntime,
  preparePublicReleaseRuntime,
  settingsWithPublicRelease,
} from './public-release-runtime.js';
import type { RecordsBatchValidationOptions } from './validator-singleton-types.js';

export async function resolveConfiguredRecordsBatchRuntime(
  resolveRuntime: (runtimeScopeKey?: string) => Promise<RecordsValidator>,
  options: RecordsBatchValidationOptions,
) {
  const prepared = preparePublicReleaseRuntime(
    options.fhirVersion ?? 'R4',
    options.runtimeScopeKey,
  );
  const instance = await resolveRuntime(prepared.runtimeScopeKey);
  configurePublicReleaseRuntime(instance, prepared.context);
  return {
    instance,
    options: {
      ...options,
      fhirVersion: prepared.context.engineVersion,
      runtimeScopeKey: prepared.runtimeScopeKey,
      settings: settingsWithPublicRelease(options.settings, prepared.context),
    },
  };
}
