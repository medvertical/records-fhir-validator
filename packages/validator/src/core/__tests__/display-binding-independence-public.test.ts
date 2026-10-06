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
import codeSystem from '../../validators/__tests__/fixtures/ihe-property-codesystem.json';
import valueSet from '../../validators/__tests__/fixtures/hl7-format-valueset.json';
import type { StructureDefinition } from '../structure-definition-types.js';

const originalSource = getProfileSource(); const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); setProfileSource(originalSource);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function settings() {
  const defaults = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  for (const aspect of Object.values(defaults.aspects)) aspect.enabled = false;
  defaults.aspects.terminology.enabled = true; defaults.advisorRules = []; defaults.terminologyServers = [];
  defaults.profileSources = { simplifier: false, packageRegistry: false };
  if (defaults.packageDownload) defaults.packageDownload.autoDownload = false;
  defaults.terminologyResolution = { ...defaults.terminologyResolution, strategy: 'local-only' }; return defaults;
}
function profile(type: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: `http://hl7.org/fhir/StructureDefinition/${type}`, name: type,
    status: 'draft', kind: 'resource', abstract: false, type, fhirVersion: '4.0.1', snapshot: { element: [{ path: type },
      ...(type === 'Observation' ? [{ path: 'Observation.code', type: [{ code: 'CodeableConcept' }], binding: {
        strength: 'required' as const, valueSet: valueSet.url, extension: [
          { url: 'http://hl7.org/fhir/tools/StructureDefinition/additional-binding', extension: [
            { url: 'purpose', valueCode: 'required' }, { url: 'valueSet', valueCanonical: valueSet.url },
          ] },
        ],
      } }] : [])] } };
}
for (const api of ['single', 'multi'] as const) {
  describe(`${api} own display with incomplete genuine property binding`, () => {
    it.each([undefined, codeSystem.version])('Coding.version=%s retains separate child P/N/U cold/warm', async version => {
      const root = await mkdtemp(join(tmpdir(), 'records-display-binding-')); roots.push(root);
      setProfileSource({ findCanonicalResource: async () => null, hasCodeSystem: async () => false });
      const get = vi.spyOn(axios, 'get').mockImplementation(async () => { throw new Error('Unexpected remote call'); });
      const validator = new RecordsValidator({ packageCachePath: join(root, 'cache'), bundledProfilesPath: null,
        terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false, enableCaching: false, timeout: 30_000 });
      await validator.waitForInitialization();
      for (const type of ['Observation', 'Bundle']) expect(validator.getSdLoader().registerExternalProfile(profile(type), 'R4')).toBe(true);
      expect(validator.registerTerminologyResource(codeSystem, 'R4')).toBe(true);
      expect(validator.registerTerminologyResource(valueSet, 'R4')).toBe(true);
      const bindings = vi.spyOn(ValueSetValidator.prototype, 'validateBinding');
      const selectedValueSets = vi.spyOn(ValueSetPackageLoader.prototype, 'loadValueSetResource');
      const selected = vi.spyOn(ValueSetPackageLoader.prototype, 'loadLocalTerminologyAuthority');
      const effectiveSettings = settings(); const beforeSettings = structuredClone(effectiveSettings);
      const body = { resourceType: 'Bundle', language: 'de-DE', type: 'collection', entry: [
        ['QRPH MCH', undefined], ['Wrong', undefined], ['QRPH MCH', 'fr-FR'],
      ].map(([display, language]) => ({ resource: { resourceType: 'Observation', ...(language ? { language } : {}),
        code: { coding: [{ system: codeSystem.url, code: 'urn:ihe:qrph:mch:2009', display, version }] },
        extension: [{ url: 'https://example.test/independent', valueCoding: { system: 'urn:ietf:rfc:3986', code: 'relative/path' } }],
      } })) }; const beforeBody = structuredClone(body);
      for (let round = 0; round < 2; round++) {
        bindings.mockClear();
        const url = 'http://hl7.org/fhir/StructureDefinition/Bundle';
        const issues = api === 'single' ? await validator.validate(body, url, 'R4', effectiveSettings)
          : (await validator.validateAspects(body, { aspects: ['terminology'], settings: effectiveSettings, fhirVersion: 'R4', profileUrl: url })).aspects.flatMap(aspect => aspect.issues);
        const displayN = issues.filter(issue => issue.code === 'terminology-display-mismatch');
        const displayU = issues.filter(issue => issue.code === 'terminology-display-unverified');
        expect(displayN.length).toBeGreaterThan(0); expect(displayU.length).toBeGreaterThan(0);
        expect(displayN.every(issue => issue.path?.startsWith('Bundle.entry[1]'))).toBe(true);
        expect(displayU.every(issue => issue.path?.startsWith('Bundle.entry[2]'))).toBe(true);
        for (const index of [0, 1, 2]) {
          expect(issues.some(issue => issue.code === 'terminology-binding-unverified' && issue.path?.startsWith(`Bundle.entry[${index}]`)
            && issue.details?.validationStatus === 'incomplete')).toBe(true);
          expect(issues.some(issue => issue.code === 'terminology-code-invalid' && issue.path?.startsWith(`Bundle.entry[${index}]`)
            && issue.details?.system === 'urn:ietf:rfc:3986')).toBe(true);
        }
        const calls = bindings.mock.calls.filter(call => call[2].includes('.code'));
        expect(calls).toHaveLength(6);
        expect(calls.filter(call => call[3]?.displayLanguage === 'fr-FR')).toHaveLength(2);
        expect(calls.filter(call => call[3]?.displayLanguage === undefined)).toHaveLength(4);
        const actualValueSets = await Promise.all(selectedValueSets.mock.results.filter(result => result.type === 'return').map(result => result.value));
        expect(actualValueSets.some(result => JSON.stringify(result) === JSON.stringify(valueSet))).toBe(true);
        const results = await Promise.all(selected.mock.results.filter(result => result.type === 'return').map(result => result.value));
        expect(results.some(result => result?.kind === 'code-system' && JSON.stringify(result.codeSystem) === JSON.stringify(codeSystem))).toBe(true);
        expect(effectiveSettings).toEqual(beforeSettings); expect(body).toEqual(beforeBody);
      }
      expect(get).not.toHaveBeenCalled();
    }, 20_000);
  });
}
