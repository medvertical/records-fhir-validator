import axios from 'axios';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { RecordsValidator } from '../validator-engine.js';
import { ValueSetValidator } from '../../validators/valueset-validator.js';
import codeSystem from '../../validators/__tests__/fixtures/mii-nlp-codesystem.json';
import valueSet from '../../validators/__tests__/fixtures/mii-nlp-valueset.json';
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
const coding = (display: string) => ({ system: codeSystem.url, code: 'surrogated', version: codeSystem.version, display });
function child(language?: string) {
  const raw = coding('Surrogated document');
  return { resourceType: 'Observation', ...(language ? { language } : {}), code: { coding: [raw], text: `owner:${language ?? 'omitted'}` },
    extension: [{ url: 'https://example.test/deep', valueCoding: raw },
      { url: 'https://example.test/independent', valueCoding: { system: 'urn:ietf:rfc:3986', code: 'relative/path' } }] };
}
for (const api of ['single', 'multi'] as const) {
  describe(`${api} actual local language owners`, () => {
    it.each(['root', 'contained', 'parameter', 'bundle'])('preserves child contexts through %s cold/warm', async location => {
      const root = await mkdtemp(join(tmpdir(), 'records-local-language-public-')); roots.push(root);
      setProfileSource({ findCanonicalResource: async () => null, hasCodeSystem: async () => false });
      const get = vi.spyOn(axios, 'get').mockImplementation(async () => { throw new Error('Unexpected remote call'); });
      const validator = new RecordsValidator({ packageCachePath: join(root, 'cache'), bundledProfilesPath: null,
        terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false, enableCaching: false, timeout: 30_000 });
      await validator.waitForInitialization();
      for (const type of ['Observation', 'Bundle', 'Parameters']) expect(validator.getSdLoader().registerExternalProfile(profile(type), 'R4')).toBe(true);
      expect(validator.registerTerminologyResource(codeSystem, 'R4')).toBe(true);
      expect(validator.registerTerminologyResource(valueSet, 'R4')).toBe(true);
      const binding = vi.spyOn(ValueSetValidator.prototype, 'validateBinding');
      for (const parentLanguage of ['de-DE', 'en-NZ']) for (let round = 0; round < 2; round++) {
        binding.mockClear();
        const children = [child('de-DE'), child('en-NZ'), child(), child('fr-FR')];
        const body = location === 'root' ? { ...child(parentLanguage) }
          : location === 'contained' ? { resourceType: 'Observation', language: parentLanguage, contained: children }
          : location === 'parameter' ? { resourceType: 'Parameters', language: parentLanguage,
              parameter: [{ name: 'parent', part: children.map(resource => ({ name: 'child', resource })) }] }
          : { resourceType: 'Bundle', language: parentLanguage, type: 'collection', entry: children.map(resource => ({ resource })) };
        const url = `http://hl7.org/fhir/StructureDefinition/${body.resourceType}`;
        const issues = api === 'single' ? await validator.validate(body, url, 'R4', settings())
          : (await validator.validateAspects(body, { aspects: ['terminology'], settings: settings(), fhirVersion: 'R4', profileUrl: url })).aspects.flatMap(aspect => aspect.issues);
        const mismatches = issues.filter(issue => issue.code === 'terminology-display-mismatch');
        const unknowns = issues.filter(issue => issue.code === 'terminology-display-unverified');
        const independent = issues.filter(issue => issue.code === 'terminology-code-invalid' && issue.details?.system === 'urn:ietf:rfc:3986');
        expect(independent.length).toBeGreaterThan(0);
        if (location === 'root') {
          expect(mismatches.length > 0).toBe(parentLanguage === 'de-DE');
          expect(unknowns).toHaveLength(0);
        } else {
          expect(mismatches.length).toBeGreaterThan(0);
          expect(unknowns.length).toBeGreaterThan(0);
          const prefix = location === 'contained' ? 'Observation.contained'
            : location === 'parameter' ? 'Parameters.parameter[0].part' : 'Bundle.entry';
          expect(mismatches.map(issue => issue.path)).toEqual(expect.arrayContaining([expect.stringContaining(`${prefix}[0]`)]));
          expect(mismatches.every(issue => issue.path?.startsWith(`${prefix}[0]`))).toBe(true);
          expect(unknowns.every(issue => issue.path?.startsWith(`${prefix}[3]`))).toBe(true);
        }
        const calls = binding.mock.calls.filter(call => call[2].includes('.code'));
        expect(calls).toHaveLength(location === 'root' ? 2 : 8);
        for (const call of calls) {
          const concept = call[0] as { text: string };
          const ownerLanguage = concept.text.slice('owner:'.length);
          expect(call[3]?.displayLanguage).toBe(ownerLanguage === 'omitted' ? undefined : ownerLanguage);
        }
        const languages = location === 'root' ? [parentLanguage] : ['de-DE', 'en-NZ', undefined, 'fr-FR'];
        for (const language of languages) expect(calls.filter(call => call[3]?.displayLanguage === language)).toHaveLength(2);
      }
      expect(get).not.toHaveBeenCalled();
    }, 20_000);
  });
}
