import axios from 'axios';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { RecordsValidator } from '../validator-engine.js';
import { ValueSetValidator } from '../../validators/valueset-validator.js';
import { ValueSetPackageLoader } from '../../validators/valueset-package-loader.js';
import { ValueSetCache } from '../../validators/valueset-cache.js';
import codeSystem from '../../validators/__tests__/fixtures/ihe-property-codesystem.json';
import valueSet from '../../validators/__tests__/fixtures/hl7-format-valueset.json';
import type { StructureDefinition } from '../structure-definition-types.js';

const originalSource = getProfileSource();
const roots: string[] = [];
const active = 'urn:ihe:pcc:xphr:2007';
const deprecated = 'urn:ihe:qrph:mch:2009';
const excludedUrl = 'https://example.test/ValueSet/derived-explicit-exclusion';
afterEach(async () => {
  vi.restoreAllMocks(); setProfileSource(originalSource);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
function settings() {
  const defaults = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  for (const aspect of Object.values(defaults.aspects)) aspect.enabled = false;
  defaults.aspects.terminology.enabled = true;
  defaults.advisorRules = []; defaults.terminologyServers = [];
  defaults.profileSources = { simplifier: false, packageRegistry: false };
  if (defaults.packageDownload) defaults.packageDownload.autoDownload = false;
  defaults.terminologyResolution = { ...defaults.terminologyResolution, strategy: 'local-only' };
  return defaults;
}
// Caller profiles/compose exclusion are derived controls; the IHE/HL7 fixture bytes are upstream metadata.
function profile(type: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: `http://hl7.org/fhir/StructureDefinition/${type}`,
    name: type, status: 'draft', kind: 'resource', abstract: false, type, fhirVersion: '4.0.1',
    snapshot: { element: [{ id: type, path: type, min: 0, max: '*' },
      ...(type === 'Observation' ? ['code', 'method'].map(field => ({ id: `Observation.${field}`, path: `Observation.${field}`, min: 0, max: '1',
        type: [{ code: 'CodeableConcept' }], binding: { strength: 'required' as const, valueSet: field === 'code' ? valueSet.url : excludedUrl } })) : [])] } };
}
function child(code: string, language?: string, version?: string) {
  const coding = { system: codeSystem.url, code, version, display: code === active ? 'PCC XPHR' : 'QRPH MCH' };
  return { resourceType: 'Observation', ...(language ? { language } : {}), code: { coding: [coding] },
    method: { coding: [{ system: codeSystem.url, code: active, version, display: 'PCC XPHR' }] },
    extension: [{ url: 'https://example.test/independent', valueCoding: { system: 'urn:ietf:rfc:3986', code: 'relative/path' } }] };
}
for (const api of ['single', 'multi'] as const) {
  describe(`${api} genuine declared-property public owners`, () => {
    it.each([undefined, codeSystem.version])('Coding.version=%s preserves own child P/N/U cold/warm', async version => {
      const root = await mkdtemp(join(tmpdir(), 'records-property-filter-public-')); roots.push(root);
      setProfileSource({ findCanonicalResource: async () => null, hasCodeSystem: async () => false });
      const get = vi.spyOn(axios, 'get').mockImplementation(async () => { throw new Error('Unexpected remote call'); });
      const validator = new RecordsValidator({ packageCachePath: join(root, 'cache'), bundledProfilesPath: null,
        terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false, enableCaching: false, timeout: 30_000 });
      await validator.waitForInitialization();
      for (const type of ['Observation', 'Bundle']) expect(validator.getSdLoader().registerExternalProfile(profile(type), 'R4')).toBe(true);
      expect(validator.registerTerminologyResource(codeSystem, 'R4')).toBe(true);
      expect(validator.registerTerminologyResource(valueSet, 'R4')).toBe(true);
      expect(validator.registerTerminologyResource({ ...valueSet, url: excludedUrl, compose: {
        include: [{ system: codeSystem.url, version: codeSystem.version, filter: [{ property: 'status', op: '=', value: 'active' }] }],
        exclude: [{ system: codeSystem.url, version: codeSystem.version, concept: [{ code: active }] }],
      } }, 'R4')).toBe(true);
      const binding = vi.spyOn(ValueSetValidator.prototype, 'validateBinding');
      const local = vi.spyOn(ValueSetValidator.prototype, 'validateCodeInLocalCodeSystemWithLanguage');
      const selection = vi.spyOn(ValueSetPackageLoader.prototype, 'loadCodeSystem');
      const valueSetSelection = vi.spyOn(ValueSetPackageLoader.prototype, 'loadValueSetResource');
      const cache = vi.spyOn(ValueSetCache.prototype, 'getCodeSystem');
      const effectiveSettings = settings();
      const beforeSettings = structuredClone(effectiveSettings);
      for (let round = 0; round < 2; round++) {
        binding.mockClear(); local.mockClear(); selection.mockClear(); valueSetSelection.mockClear(); cache.mockClear();
        const body = { resourceType: 'Bundle', language: 'de-DE', type: 'collection',
          entry: [child(active, undefined, version), child(deprecated, undefined, version), child(active, 'fr-FR', version)].map(resource => ({ resource })) };
        const url = 'http://hl7.org/fhir/StructureDefinition/Bundle';
        const issues = api === 'single' ? await validator.validate(body, url, 'R4', effectiveSettings)
          : (await validator.validateAspects(body, { aspects: ['terminology'], settings: effectiveSettings, fhirVersion: 'R4', profileUrl: url })).aspects.flatMap(aspect => aspect.issues);
        expect(issues.some(issue => issue.code === 'terminology-code-invalid' && issue.details?.system === 'urn:ietf:rfc:3986')).toBe(true);
        const displayUnknown = issues.filter(issue => issue.code === 'terminology-display-unverified');
        expect(displayUnknown.length).toBeGreaterThan(0);
        expect(displayUnknown.some(issue => issue.path?.startsWith('Bundle.entry[2]'))).toBe(true);
        expect(displayUnknown.every(issue => issue.path?.startsWith('Bundle.entry[2]'))).toBe(true);
        const bindingUnknown = issues.filter(issue => issue.code === 'terminology-binding-unverified');
        expect(bindingUnknown.length).toBeGreaterThan(0);
        expect(bindingUnknown.every(issue => issue.path?.startsWith('Bundle.entry[1]') && issue.path.includes('.code'))).toBe(true);
        for (const index of [0, 1, 2]) expect(issues.some(issue => issue.severity === 'error'
          && issue.path?.startsWith(`Bundle.entry[${index}]`) && issue.details?.valueSet === excludedUrl)).toBe(true);
        expect(issues.some(issue => issue.severity === 'error' && issue.details?.valueSet === valueSet.url)).toBe(false);
        expect(issues.some(issue => issue.code === 'terminology-display-mismatch')).toBe(false);
        const calls = binding.mock.calls.filter(call => call[2].includes('.code'));
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.some(call => call[3]?.displayLanguage === 'fr-FR')).toBe(true);
        expect(calls.some(call => call[3]?.displayLanguage === undefined)).toBe(true);
        expect(calls.some(call => call[3]?.displayLanguage === 'de-DE')).toBe(false);
        expect(local.mock.calls.some(call => call[5] === 'fr-FR')).toBe(true);
        expect(local.mock.calls.some(call => call[5] === 'de-DE')).toBe(false);
        const selected = (await Promise.all(selection.mock.results.filter(result => result.type === 'return').map(result => result.value)))
          .concat(cache.mock.results.filter(result => result.type === 'return').map(result => result.value));
        expect(selected.some(resource => resource?.url === codeSystem.url && resource.version === codeSystem.version
          && JSON.stringify(resource.concept) === JSON.stringify(codeSystem.concept) && JSON.stringify(resource.property) === JSON.stringify(codeSystem.property))).toBe(true);
        const selectedValueSets = await Promise.all(valueSetSelection.mock.results.filter(result => result.type === 'return').map(result => result.value));
        expect(selectedValueSets.some(resource => resource?.url === valueSet.url && resource.version === valueSet.version
          && JSON.stringify(resource.compose) === JSON.stringify(valueSet.compose))).toBe(true);
        expect(effectiveSettings).toEqual(beforeSettings);
      }
      expect(get).not.toHaveBeenCalled();
    }, 20_000);
  });
}
