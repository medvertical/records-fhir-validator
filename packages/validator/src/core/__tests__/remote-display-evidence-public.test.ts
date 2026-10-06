import axios from 'axios';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4, type ValidationSettings } from '@records-fhir/validation-types';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { RecordsValidator } from '../validator-engine.js';
import type { StructureDefinition } from '../structure-definition-types.js';

const system = 'http://loinc.org';
const profileUrl = 'https://records.test/StructureDefinition/remote-display-evidence';
const originalSource = getProfileSource();
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); setProfileSource(originalSource);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function parameters(positive: boolean, inactive = false) {
  const message = "Wrong Display Name 'Inactive finding'. Valid display is 'Inactive finding' (en-US) (for the language(s) 'en-NZ')";
  return { resourceType: 'Parameters', parameter: [
    { name: 'result', valueBoolean: positive }, { name: 'display', valueString: 'Inactive finding' },
    { name: 'inactive', valueBoolean: inactive },
    ...(!positive ? [{ name: 'message', valueString: message }] : []),
    { name: 'issues', resource: { resourceType: 'OperationOutcome', issue: [
      ...(!positive ? [{ severity: 'error', code: 'invalid', details: { text: message,
        coding: [{ system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'invalid-display' }] } }] : []),
      ...(inactive ? [{ severity: 'warning', code: 'business-rule', details: { text: 'Concept is inactive',
        coding: [{ system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'code-comment' }] } }] : []),
    ] } },
  ] };
}
function settings(mode: string): ValidationSettings {
  const defaults = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  if (!defaults.packageDownload) throw new Error('Maintained package download defaults required');
  return { ...defaults, advisorRules: [], validationStrictness: 'standard',
    terminologyServers: mode === 'none' ? [] : [
      { id: 'primary', name: 'Primary control', url: 'https://primary.example.test/r4', enabled: true,
        fhirVersions: ['R4'], preferredSystems: [system] },
      ...(['timeout', 'http500', 'fallback-positive', 'status'].includes(mode) ? [{
        id: 'fallback', name: 'Fallback control', url: 'https://fallback.example.test/r4', enabled: true, fhirVersions: ['R4' as const],
      }] : []),
    ],
    profileSources: { simplifier: false, packageRegistry: false },
    packageDownload: { ...defaults.packageDownload, autoDownload: false },
    terminologyResolution: { ...defaults.terminologyResolution, strategy: 'server-first',
      serverDelegation: { ...defaults.terminologyResolution?.serverDelegation, expandValueSets: false, validateCodes: true },
      twoPhaseExpansion: { ...defaults.terminologyResolution?.twoPhaseExpansion, enabled: false, mode: 'shadow' } },
    aspects: { ...defaults.aspects, terminology: { enabled: true, engine: 'records', severity: 'inherit' } },
  };
}

for (const api of ['single', 'multi'] as const) {
  describe(`${api} real remote display evidence`, () => {
    it.each(['positive', 'negative', 'timeout', 'http500', 'fallback-positive', 'status', 'outcome422', 'none'])(
      'keeps P/N/U and an independent local N through %s', async mode => {
        const root = await mkdtemp(join(tmpdir(), 'records-display-public-')); roots.push(root);
        setProfileSource({ findCanonicalResource: async () => null, hasCodeSystem: async () => false });
        const requests: { url: string; params: Record<string, unknown> }[] = [];
        const get = vi.spyOn(axios, 'get').mockImplementation(async (url, config) => {
          const params = config?.params as Record<string, unknown>;
          requests.push({ url: String(url), params });
          if (String(url).startsWith('https://fallback.example.test')) {
            if (mode === 'timeout' || mode === 'http500') throw new axios.AxiosError('Control failure',
              mode === 'timeout' ? 'ECONNABORTED' : 'ERR_BAD_RESPONSE', undefined, undefined,
              mode === 'http500' ? { status: 500, statusText: 'Control failure', data: {}, headers: {}, config: config as never } : undefined);
            return { data: parameters(mode === 'fallback-positive' || (mode === 'status' && params.display === undefined)) };
          }
          if (mode === 'outcome422') {
            const payload = parameters(false).parameter.find(parameter => parameter.name === 'issues')?.resource;
            throw new axios.AxiosError('Typed display rejection', 'ERR_BAD_RESPONSE', undefined, undefined,
              { status: 422, statusText: 'Unprocessable Entity', data: payload, headers: {}, config: config as never });
          }
          return { data: parameters(mode === 'positive', mode === 'status') };
        });
        const validator = new RecordsValidator({ packageCachePath: join(root, 'cache'), bundledProfilesPath: null,
          terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false,
          enableCaching: false, timeout: 30_000 });
        await validator.waitForInitialization();
        const selected: StructureDefinition = { resourceType: 'StructureDefinition', url: profileUrl,
          name: 'RemoteDisplayEvidence', status: 'draft', kind: 'resource', abstract: false,
          type: 'Observation', fhirVersion: '4.0.1', snapshot: { element: [
            { id: 'Observation', path: 'Observation', min: 0, max: '*' },
            { id: 'Observation.code', path: 'Observation.code', min: 0, max: '1', type: [{ code: 'CodeableConcept' }] },
          ] } };
        expect(validator.getSdLoader().registerExternalProfile(selected, 'R4')).toBe(true);
        const resource = { resourceType: 'Observation', language: 'en-NZ', code: { coding: [
          { system, code: '11369-6', version: '2.82', display: 'Inactive finding' },
          { system: 'urn:ietf:rfc:3986', code: 'relative/path' },
        ] } };
        for (let round = 0; round < 2; round++) {
          const issues = api === 'single' ? await validator.validate(resource, profileUrl, 'R4', settings(mode))
            : (await validator.validateAspects(resource, { aspects: ['terminology'], settings: settings(mode),
              fhirVersion: 'R4', profileUrl, profileSources: ['explicit-run'] })).aspects.flatMap(aspect => aspect.issues);
          const displays = issues.filter(issue => issue.code === 'terminology-display-mismatch');
          expect(displays).toHaveLength(['negative', 'timeout', 'http500', 'status', 'outcome422'].includes(mode) ? 1 : 0);
          if (displays.length) expect(displays[0]).toMatchObject({ severity: 'error', path: 'Observation.code.coding[0].display' });
          expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', code: 'terminology-code-invalid',
            path: 'Observation.code.coding[1].code' }));
          expect(issues.some(issue => issue.details?.validationComplete === false && issue.details?.system === system))
            .toBe(mode === 'none' || mode === 'outcome422');
          if (mode === 'status') expect(issues.some(issue => issue.code === 'terminology-code-inactive')).toBe(false);
        }
        if (mode === 'none') expect(get).not.toHaveBeenCalled();
        else {
          expect(requests.length).toBeGreaterThan(0);
          expect(requests.every(({ params }) => params.url === system && params.code === '11369-6'
            && params.version === '2.82' && params.displayLanguage === 'en-NZ')).toBe(true);
          expect(requests.every(({ params }) => params.display === 'Inactive finding' || (mode === 'status' && params.display === undefined))).toBe(true);
          expect(requests.every(({ url }) => url === 'https://primary.example.test/r4/CodeSystem/$validate-code'
            || url === 'https://fallback.example.test/r4/CodeSystem/$validate-code')).toBe(true);
        }
      },
    );
  });
}
