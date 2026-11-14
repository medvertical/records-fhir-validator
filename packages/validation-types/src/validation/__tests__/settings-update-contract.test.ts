import { describe, expect, it } from 'vitest';
import { ValidationSettingsUpdateSchema } from '../settings-schema.js';

describe('settings update wire compatibility', () => {
  it.each([
    {},
    { aspects: { terminology: { enabled: false } } },
    { performance: { batchSize: 25 } },
    { resourceTypes: { includedTypes: ['Observation'] } },
    { mii: { allowHighVolumeOntoserver: false } },
    { recursiveReferenceValidation: { validateTargetProfiles: true } },
    { hapiConfig: { enabled: false } },
    { cacheConfig: { layers: { L1: 'disabled' }, ttl: { validation: 60 } } },
    { terminologyResolution: { snapshot: {}, serverDelegation: { validateCodes: true } } },
    { terminologyResolution: { twoPhaseExpansion: { logMismatches: true } } },
    { advancedTerminology: { hierarchyValidation: { enabled: true } } },
    { advancedTerminology: { crossMappingValidation: { checkPairs: [{ sourceSystem: 'urn:test' }] } } },
    { packageDownload: { workspaceTemplates: [{ id: 'template' }] } },
    { packageDownload: { serverBindings: [{ packageId: 'hl7.fhir.uv.ips', version: '2.0.1', checksumSha256: 'a'.repeat(64) }] } },
    { packageDownload: { serverBindings: [] } },
    { terminologyFallback: { local: 'cache' }, offlineConfig: { profileCachePath: 'profiles' } },
  ])('preserves a sparse update without inserting absent settings: %j', update => {
    expect(ValidationSettingsUpdateSchema.parse(update)).toEqual(update);
  });

  it.each([
    { unexpected: true },
    { aspects: { unexpected: { enabled: false } } },
    { performance: { batchSize: 0 } },
    { terminologyServers: [{ id: 'incomplete' }] },
    { circuitBreaker: { failureThreshold: 3 } },
    { profileSources: { simplifier: true } },
    { imposedProfiles: { policies: [{ resourceType: 'Patient' }] } },
    { advisorRules: [{ id: 'incomplete' }] },
    { packageDownload: { workspaceTemplates: Array.from({ length: 33 }, () => ({})) } },
    { packageDownload: { serverBindings: [{ packageId: 'hl7.fhir.uv.ips' }] } },
    { packageDownload: { serverBindings: [{ packageId: '../bad', version: 'latest', checksumSha256: 'a'.repeat(64) }] } },
  ])('retains strict keys, limits and atomic replacement objects: %j', update => {
    expect(ValidationSettingsUpdateSchema.safeParse(update).success).toBe(false);
  });
});
