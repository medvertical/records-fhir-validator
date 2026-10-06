import axios from 'axios';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { RecordsValidator } from '../validator-engine.js';
import type { StructureDefinition } from '../structure-definition-types.js';

const originalSource = getProfileSource();
const roots: string[] = [];
const WG = 'http://hl7.org/fhir/StructureDefinition/structuredefinition-wg';
const VS = 'https://publication.test/ValueSet/unknown-region';
const CS = 'https://publication.test/CodeSystem/unknown-region';
afterEach(async () => {
  vi.restoreAllMocks(); setProfileSource(originalSource);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
function settings(forPublication: boolean) {
  const defaults = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  for (const aspect of Object.values(defaults.aspects)) aspect.enabled = false;
  defaults.aspects.structural.enabled = true; defaults.aspects.terminology.enabled = true;
  defaults.advisorRules = []; defaults.terminologyServers = []; defaults.forPublication = forPublication;
  defaults.profileSources = { simplifier: false, packageRegistry: false };
  if (defaults.packageDownload) defaults.packageDownload.autoDownload = false;
  defaults.terminologyResolution = { ...defaults.terminologyResolution, strategy: 'local-only' };
  return defaults;
}
function profile(type: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: `http://hl7.org/fhir/StructureDefinition/${type}`,
    name: type, status: 'draft', kind: 'resource', abstract: false, type, fhirVersion: '4.0.1',
    snapshot: { element: [{ id: type, path: type, min: 0, max: '*' },
      ...(type === 'ValueSet' ? [{ id: 'ValueSet.jurisdiction', path: 'ValueSet.jurisdiction', min: 0, max: '*',
        type: [{ code: 'CodeableConcept' }], binding: { strength: 'required' as const, valueSet: VS } }] : [])] } };
}
function canonical(fields: Record<string, unknown> = {}) {
  return { resourceType: 'ValueSet', id: 'publication-control', status: 'draft',
    url: 'http://hl7.org/fhir/ValueSet/PublicationControl', ...fields };
}
const good = { extension: [{ url: WG, valueCode: 'fhir' }], publisher: 'HL7 International / FHIR Infrastructure',
  contact: [{ telecom: [{ system: 'url', value: 'http://www.hl7.org/Special/committees/fiwg' }] }] };
const scenarios = [
  { name: 'missing own WG', resource: canonical(), missingPath: 'ValueSet', unknown: false },
  { name: 'known own WG', resource: canonical(good), missingPath: undefined, unknown: false },
  { name: 'SID exemption', resource: canonical({ url: 'http://hl7.org/fhir/sid/control' }), missingPath: undefined, unknown: false },
  { name: 'vendor canonical', resource: canonical({ url: 'https://vendor.test/ValueSet/control' }), missingPath: undefined, unknown: false },
  { name: 'independent negative and unknown', resource: canonical({ id: 'bad/id',
    jurisdiction: [{ coding: [{ system: CS, code: '001' }] }] }), missingPath: 'ValueSet', unknown: true },
  { name: 'own missing Bundle child', resource: { resourceType: 'Bundle', type: 'collection', ...good,
    entry: [{ resource: canonical() }] }, missingPath: 'Bundle.entry[0].resource', unknown: false },
  { name: 'own missing contained child', resource: canonical({ ...good,
    contained: [canonical({ id: 'child' })], extension: [...good.extension, { url: 'https://publication.test/reference', valueReference: { reference: '#child' } }] }),
    missingPath: 'ValueSet.contained[0]', unknown: false },
  { name: 'own missing Parameters child', resource: { resourceType: 'Parameters', ...good,
    parameter: [{ name: 'metadata', resource: canonical() }] }, missingPath: 'Parameters.parameter[0].resource', unknown: false },
];
for (const api of ['single', 'multi'] as const) {
  describe(`${api} publication workgroup caller context`, () => {
    it.each(scenarios)('$name preserves own policy across normal/publication repeats', async scenario => {
      const root = await mkdtemp(join(tmpdir(), 'records-publication-control-')); roots.push(root);
      setProfileSource({ findCanonicalResource: async () => null, hasCodeSystem: async () => false });
      const get = vi.spyOn(axios, 'get').mockImplementation(async () => { throw new Error('Unexpected remote call'); });
      const validator = new RecordsValidator({ packageCachePath: join(root, 'cache'), bundledProfilesPath: null,
        terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false, enableCaching: true, timeout: 30_000 });
      await validator.waitForInitialization();
      for (const type of ['ValueSet', 'Bundle', 'Parameters']) expect(validator.getSdLoader().registerExternalProfile(profile(type), 'R4')).toBe(true);
      expect(validator.registerTerminologyResource({ resourceType: 'CodeSystem', url: CS, content: 'complete', caseSensitive: true,
        concept: [{ code: '001' }] }, 'R4')).toBe(true);
      expect(validator.registerTerminologyResource({ resourceType: 'ValueSet', url: VS,
        compose: { include: [{ system: CS, filter: [{ property: 'class', op: '=', value: 'region' }] }] } }, 'R4')).toBe(true);
      for (const forPublication of [true, false, false, true]) {
        const body = structuredClone(scenario.resource);
        const url = `http://hl7.org/fhir/StructureDefinition/${body.resourceType}`;
        const snapshot = settings(forPublication);
        const before = structuredClone(snapshot);
        const issues = api === 'single' ? await validator.validate(body, url, 'R4', snapshot)
          : (await validator.validateAspects(body, { aspects: ['structural', 'terminology'], settings: snapshot, fhirVersion: 'R4', profileUrl: url })).aspects.flatMap(aspect => aspect.issues);
        expect(snapshot).toEqual(before);
        const missing = issues.filter(issue => issue.code === 'business-rule-wg-missing');
        expect(missing).toHaveLength(forPublication && scenario.missingPath ? 1 : 0);
        if (missing[0]) {
          expect(missing[0].severity).toBe('error'); expect(missing[0].path?.startsWith(scenario.missingPath!)).toBe(true);
        }
        expect(issues.some(issue => issue.code === 'structural-validation-error' || issue.code === 'profile-validation-error')).toBe(false);
        if (scenario.unknown) {
          expect(issues.some(issue => issue.code === 'terminology-binding-unverified' && issue.details?.valueSet === VS)).toBe(true);
          expect(issues.some(issue => issue.severity === 'error' && issue.code === 'structural-invalid-id')).toBe(true);
        }
      }
      expect(get).not.toHaveBeenCalled();
    }, 20_000);
  });
}
