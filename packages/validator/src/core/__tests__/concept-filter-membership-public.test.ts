import axios from 'axios';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { RecordsValidator } from '../validator-engine.js';
import { ValueSetValidator } from '../../validators/valueset-validator.js';
import codeSystem from '../../validators/__tests__/fixtures/ips-contact-codesystem.json';
import valueSet from '../../validators/__tests__/fixtures/ips-contact-valueset.json';
import type { StructureDefinition } from '../structure-definition-types.js';

const originalSource = getProfileSource();
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); setProfileSource(originalSource);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
function settings() {
  const defaults = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  for (const aspect of Object.values(defaults.aspects)) aspect.enabled = false;
  defaults.aspects.terminology.enabled = true;
  defaults.advisorRules = [];
  defaults.terminologyServers = [];
  defaults.profileSources = { simplifier: false, packageRegistry: false };
  if (defaults.packageDownload) defaults.packageDownload.autoDownload = false;
  defaults.terminologyResolution = { ...defaults.terminologyResolution, strategy: 'local-only' };
  return defaults;
}
function profile(type: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: `http://hl7.org/fhir/StructureDefinition/${type}`,
    name: type, status: 'draft', kind: 'resource', abstract: false, type, fhirVersion: '4.0.1',
    snapshot: { element: [{ id: type, path: type, min: 0, max: '*' },
      ...(type === 'Observation' ? [{ id: 'Observation.code', path: 'Observation.code', min: 0, max: '1',
        type: [{ code: 'CodeableConcept' }], binding: { strength: 'required' as const, valueSet: valueSet.url,
          extension: [{ url: 'http://hl7.org/fhir/tools/StructureDefinition/additional-binding', extension: [
            { url: 'purpose', valueCode: 'required' }, { url: 'valueSet', valueCanonical: valueSet.url },
          ] }] } }] : [])] } };
}
function child(code: string, language?: string, version?: string) {
  return { resourceType: 'Observation', ...(language ? { language } : {}), code: { coding: [{ system: codeSystem.url, code, version,
    display: code === 'N' ? 'Next-of-Kin' : code === 'C' ? 'Emergency Contact' : 'Other' }] },
    extension: [{ url: 'https://example.test/independent', valueCoding: { system: 'urn:ietf:rfc:3986', code: 'relative/path' } }] };
}
for (const api of ['single', 'multi'] as const) {
  describe(`${api} selected concept-filter public owners`, () => {
    it.each([undefined, codeSystem.version])('Coding.version=%s retains own child P/N/U cold/warm', async version => {
      const root = await mkdtemp(join(tmpdir(), 'records-concept-filter-public-')); roots.push(root);
      setProfileSource({ findCanonicalResource: async () => null, hasCodeSystem: async () => false });
      const get = vi.spyOn(axios, 'get').mockImplementation(async () => { throw new Error('Unexpected remote call'); });
      const validator = new RecordsValidator({ packageCachePath: join(root, 'cache'), bundledProfilesPath: null,
        terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false, enableCaching: false, timeout: 30_000 });
      await validator.waitForInitialization();
      for (const type of ['Observation', 'Bundle']) expect(validator.getSdLoader().registerExternalProfile(profile(type), 'R4')).toBe(true);
      expect(validator.registerTerminologyResource(codeSystem, 'R4')).toBe(true);
      expect(validator.registerTerminologyResource(valueSet, 'R4')).toBe(true);
      const binding = vi.spyOn(ValueSetValidator.prototype, 'validateBinding');
      for (let round = 0; round < 2; round++) {
        binding.mockClear();
        const body = { resourceType: 'Bundle', language: 'de-DE', type: 'collection',
          entry: [child('N', undefined, version), child('C', undefined, version), child('O', undefined, version), child('N', 'fr-FR', version)].map(resource => ({ resource })) };
        const url = 'http://hl7.org/fhir/StructureDefinition/Bundle';
        const issues = api === 'single' ? await validator.validate(body, url, 'R4', settings())
          : (await validator.validateAspects(body, { aspects: ['terminology'], settings: settings(), fhirVersion: 'R4', profileUrl: url })).aspects.flatMap(aspect => aspect.issues);
        expect(issues.some(issue => issue.code === 'terminology-code-invalid' && issue.details?.system === 'urn:ietf:rfc:3986')).toBe(true);
        const unknowns = issues.filter(issue => issue.code === 'terminology-display-unverified');
        expect(unknowns.length).toBeGreaterThan(0);
        expect(unknowns.every(issue => issue.path?.startsWith('Bundle.entry[3]'))).toBe(true);
        expect(issues.some(issue => issue.code === 'terminology-binding-unverified')).toBe(false);
        expect(issues.some(issue => issue.severity === 'error' && issue.path?.startsWith('Bundle.entry[2]') && issue.details?.valueSet === valueSet.url)).toBe(true);
        expect(issues.some(issue => issue.code === 'terminology-display-mismatch')).toBe(false);
        for (const call of binding.mock.calls.filter(call => call[2].includes('.code'))) expect(call[3]?.displayLanguage === 'fr-FR' || call[3]?.displayLanguage === undefined).toBe(true);
      }
      expect(get).not.toHaveBeenCalled();
    }, 20_000);
  });
}
