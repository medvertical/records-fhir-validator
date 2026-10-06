import axios from 'axios';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { RecordsValidator } from '../validator-engine.js';
import { ValueSetValidator } from '../../validators/valueset-validator.js';
import { ValueSetCache } from '../../validators/valueset-cache.js';
import { parseCodeSystemValidationParameters } from '../../validators/terminology-code-system-result.js';
import { createTerminologyEvidencePort, reconcileInvocationDisplayUnknowns } from '../executors/terminology-validation-evidence-port.js';
import type { StructureDefinition } from '../structure-definition-types.js';

const system = 'http://loinc.org';
const code = '11369-6';
const valueSetUrl = 'https://records.test/ValueSet/remote-display-owner';
const originalSource = getProfileSource();
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); setProfileSource(originalSource);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
function parameters(mode: string) {
  return { resourceType: 'Parameters', parameter: [{ name: 'result', valueBoolean: mode === 'positive' },
    ...(mode === 'negative' ? [{ name: 'issues', resource: { resourceType: 'OperationOutcome', issue: [
      { severity: 'error', code: 'invalid', details: { text: 'Confirmed display rejection',
        coding: [{ system: 'http://hl7.org/fhir/tools/CodeSystem/tx-issue-type', code: 'invalid-display' }] } },
    ] } }] : [])] };
}
for (const api of ['single', 'multi'] as const) {
  describe(`${api} exact later remote display authority`, () => {
    it.each(['positive', 'negative', 'outcome422', 'timeout', 'code-negative'])('reconciles only actual display evidence under %s', async mode => {
      const root = await mkdtemp(join(tmpdir(), 'records-remote-binding-display-')); roots.push(root);
      setProfileSource({ findCanonicalResource: async () => null, hasCodeSystem: async () => false });
      const get = vi.spyOn(axios, 'get').mockImplementation(async (_url, config) => {
        expect(config?.params).toMatchObject({ url: system, code, display: 'Supplied', version: '2.82', displayLanguage: 'en-NZ' });
        if (mode === 'timeout') throw new axios.AxiosError('Timeout', 'ECONNABORTED');
        if (mode === 'outcome422') throw new axios.AxiosError('Typed display rejection', 'ERR_BAD_RESPONSE', undefined, undefined,
          { status: 422, statusText: 'Unprocessable Entity', data: parameters('negative').parameter[1].resource, headers: {}, config: config as never });
        return { data: parameters(mode) };
      });
      const defaults = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
      for (const aspect of Object.values(defaults.aspects)) aspect.enabled = false;
      defaults.aspects.terminology.enabled = true; defaults.advisorRules = [];
      defaults.terminologyServers = [{ id: 'actual-parser-control', name: 'Actual parser control', url: 'https://tx.example.test/r4',
        enabled: true, fhirVersions: ['R4'], preferredSystems: [system] }];
      defaults.profileSources = { simplifier: false, packageRegistry: false };
      if (defaults.packageDownload) defaults.packageDownload.autoDownload = false;
      defaults.terminologyResolution = { ...defaults.terminologyResolution, strategy: 'server-first',
        serverDelegation: { ...defaults.terminologyResolution?.serverDelegation, expandValueSets: false, validateCodes: true } };
      const validator = new RecordsValidator({ packageCachePath: join(root, 'cache'), bundledProfilesPath: null,
        terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false, enableCaching: false, timeout: 30_000 });
      await validator.waitForInitialization();
      const profile: StructureDefinition = { resourceType: 'StructureDefinition', url: 'https://records.test/StructureDefinition/remote-binding-display',
        name: 'RemoteBindingDisplay', status: 'draft', kind: 'resource', abstract: false, type: 'Observation', fhirVersion: '4.0.1', snapshot: { element: [
          { id: 'Observation', path: 'Observation', min: 0, max: '*' },
          { id: 'Observation.code', path: 'Observation.code', type: [{ code: 'CodeableConcept' }], binding: { strength: 'required', valueSet: valueSetUrl } },
        ] } };
      expect(validator.getSdLoader().registerExternalProfile(profile, 'R4')).toBe(true);
      expect(validator.registerTerminologyResource({ resourceType: 'ValueSet', url: valueSetUrl, version: '1',
        compose: { include: [{ system, version: '2.82', concept: [{ code }] }] } }, 'R4')).toBe(true);
      const body = { resourceType: 'Observation', language: 'en-NZ', code: { coding: [{ system, code, display: 'Supplied', version: '2.82' }] } };
      for (let round = 0; round < 2; round++) {
        const issues = api === 'single' ? await validator.validate(body, profile.url, 'R4', defaults)
          : (await validator.validateAspects(body, { aspects: ['terminology'], settings: defaults, fhirVersion: 'R4', profileUrl: profile.url })).aspects.flatMap(aspect => aspect.issues);
        expect(issues.filter(issue => issue.code === 'terminology-display-unverified')).toHaveLength(['timeout', 'code-negative'].includes(mode) ? 1 : 0);
        expect(issues.filter(issue => issue.code === 'terminology-display-mismatch')).toHaveLength(['negative', 'outcome422'].includes(mode) ? 1 : 0);
        if (mode === 'code-negative') expect(issues).toContainEqual(expect.objectContaining({ code: 'terminology-code-invalid', severity: 'error' }));
        expect(issues.some(issue => issue.code === 'terminology-codesystem-unverified')).toBe(['timeout', 'outcome422'].includes(mode));
      }
      expect(get).toHaveBeenCalled();
    });
  });
}

describe('exact display receipts preserve alternative edition Unknowns', () => {
  it.each(['partial-negative', 'all-negative', 'positive', 'bare-negative'] as const)('%s has the right OR authority', async mode => {
    const values = new ValueSetValidator(new ValueSetCache(), undefined, []);
    values.setResolutionConfig({ strategy: 'local-only', servers: [], serverDelegation: { validateCodes: false, expandValueSets: false } });
    expect(values.registerExternalTerminologyResource({ resourceType: 'ValueSet', url: valueSetUrl,
      compose: { include: [{ system, version: 'edition-A', concept: [{ code }] },
        { system, version: 'edition-B', concept: [{ code }] }] } }, 'R4')).toBe(true);
    const issues = await values.validateBinding({ system, code, display: 'Supplied' },
      { strength: 'required', valueSet: valueSetUrl }, 'Observation.code', { fhirVersion: 'R4', displayLanguage: 'en-NZ' });
    expect(issues.filter(issue => issue.code === 'terminology-display-unverified')).toHaveLength(1);
    vi.spyOn(values, 'validateCodeInCodeSystem').mockImplementation(async () =>
      parseCodeSystemValidationParameters(parameters(mode === 'positive' ? 'positive' : 'negative'), code, system));
    const wrapper = createTerminologyEvidencePort(values);
    await wrapper.validateCodeInCodeSystem(code, system, 'Supplied', 'R4', mode === 'bare-negative' ? undefined : 'edition-A', 'en-NZ');
    if (mode === 'all-negative') await wrapper.validateCodeInCodeSystem(code, system, 'Supplied', 'R4', 'edition-B', 'en-NZ');
    const remaining = reconcileInvocationDisplayUnknowns(wrapper, issues, 'R4', 'en-NZ');
    expect(remaining.filter(issue => issue.code === 'terminology-display-unverified')).toHaveLength(['partial-negative', 'bare-negative'].includes(mode) ? 1 : 0);
    expect(reconcileInvocationDisplayUnknowns(wrapper, issues, 'R4', 'de-DE')).toEqual(issues);
  });
});
