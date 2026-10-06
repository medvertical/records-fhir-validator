import axios from 'axios';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { RecordsValidator } from '../validator-engine.js';
import { ValueSetValidator } from '../../validators/valueset-validator.js';
import jurisdiction from '../../validators/__tests__/fixtures/unm49-jurisdiction-valueset.json';
import type { StructureDefinition } from '../structure-definition-types.js';
const system = 'http://unstats.un.org/unsd/methods/m49/m49.htm';
const originalSource = getProfileSource();
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); setProfileSource(originalSource); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function settings() {
  const result = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  for (const aspect of Object.values(result.aspects)) aspect.enabled = false;
  result.aspects.terminology.enabled = true; result.advisorRules = []; result.terminologyServers = [];
  result.profileSources = { simplifier: false, packageRegistry: false };
  if (result.packageDownload) result.packageDownload.autoDownload = false;
  result.terminologyResolution = { ...result.terminologyResolution, strategy: 'local-only' };
  return result;
}
// The caller profiles are derived controls; the jurisdiction ValueSet bytes are genuine HL7 R4 metadata.
function profile(type: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: `http://hl7.org/fhir/StructureDefinition/${type}`, name: type, status: 'draft',
    kind: 'resource', abstract: false, type, fhirVersion: '4.0.1', snapshot: { element: [{ id: type, path: type, min: 0, max: '*' },
      ...(type === 'Observation' ? [{ id: 'Observation.code', path: 'Observation.code', min: 0, max: '1', type: [{ code: 'CodeableConcept' }],
        binding: { strength: 'required' as const, valueSet: jurisdiction.url } }] : [])] } };
}
function child(code: string, display: string, language?: string, version?: string) {
  return { resourceType: 'Observation', ...(language ? { language } : {}), code: { coding: [{ system, code, display, ...(version ? { version } : {}) }] },
    extension: [{ url: 'https://example.test/independent', valueCoding: { system: 'urn:ietf:rfc:3986', code: 'relative/path' } }] };
}
for (const api of ['single', 'multi'] as const) describe(`${api} actual UN-M49 provider public owners`, () => {
  it('own code/class/display P/N/U survives same-instance repetition and parent language', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-unm49-public-')); roots.push(root);
    setProfileSource({ findCanonicalResource: async () => null, hasCodeSystem: async () => false });
    const get = vi.spyOn(axios, 'get').mockImplementation(async () => { throw new Error('Unexpected remote call'); });
    const instance = new RecordsValidator({ packageCachePath: join(root, 'cache'), bundledProfilesPath: null,
      terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false, enableCaching: false });
    await instance.waitForInitialization();
    for (const type of ['Observation', 'Bundle']) expect(instance.getSdLoader().registerExternalProfile(profile(type), 'R4')).toBe(true);
    expect(instance.registerTerminologyResource(jurisdiction, 'R4')).toBe(true);
    const binding = vi.spyOn(ValueSetValidator.prototype, 'validateBinding');
    const local = vi.spyOn(ValueSetValidator.prototype, 'validateCodeInLocalCodeSystemWithLanguage');
    const effectiveSettings = settings(); const beforeSettings = structuredClone(effectiveSettings);
    const body = { resourceType: 'Bundle', type: 'collection', language: 'de-DE', entry: [
      child('001', 'World'), child('004', 'Afghanistan (AFG)'), child('001', 'Incorrect', 'en'),
      child('001', 'World', 'fr'), child('999', 'Unknown'), child('001', 'World', undefined, '4.0.1'),
    ].map(resource => ({ resource })) };
    const before = structuredClone(body);
    for (let round = 0; round < 2; round++) {
      binding.mockClear(); local.mockClear();
      const url = 'http://hl7.org/fhir/StructureDefinition/Bundle';
      const issues = api === 'single' ? await instance.validate(body, url, 'R4', effectiveSettings)
        : (await instance.validateAspects(body, { aspects: ['terminology'], settings: effectiveSettings, fhirVersion: 'R4', profileUrl: url })).aspects.flatMap(aspect => aspect.issues);
      const own = (index: number) => issues.filter(issue => issue.details?.system === system && issue.path?.startsWith(`Bundle.entry[${index}]`));
      expect(own(0)).toEqual([]);
      expect(own(1).some(issue => issue.severity === 'error' && issue.details?.valueSet === jurisdiction.url)).toBe(true);
      expect(own(1).some(issue => issue.code.includes('unverified'))).toBe(false);
      expect(own(2).some(issue => issue.code === 'terminology-display-mismatch' || issue.details?.reason === 'display-mismatch')).toBe(true);
      expect(own(3).some(issue => issue.code === 'terminology-display-unverified' && issue.details?.displayLanguage === 'fr')).toBe(true);
      expect(own(3).some(issue => issue.code === 'terminology-binding-unverified')).toBe(false);
      for (const index of [4, 5]) {
        expect(own(index).some(issue => issue.code === 'terminology-binding-unverified')).toBe(true);
        expect(own(index).some(issue => issue.severity === 'error')).toBe(false);
      }
      for (let index = 0; index < 6; index++) expect(issues.some(issue => issue.code === 'terminology-code-invalid'
        && issue.details?.system === 'urn:ietf:rfc:3986' && issue.path?.startsWith(`Bundle.entry[${index}]`))).toBe(true);
      expect(binding.mock.calls.some(call => call[3]?.displayLanguage === 'fr')).toBe(true);
      expect(binding.mock.calls.some(call => call[3]?.displayLanguage === 'de-DE')).toBe(false);
      expect(local.mock.calls.some(call => call[5] === 'de-DE')).toBe(false);
      expect(body).toEqual(before); expect(effectiveSettings).toEqual(beforeSettings);
    }
    expect(get).not.toHaveBeenCalled();
  }, 20_000);
});
