import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import { RecordsValidator } from '../validator-engine.js';
import type { StructureDefinition } from '../structure-definition-types.js';
import { UcumCodeValidator } from '../../validators/ucum-validator.js';
import { getProfileSource, setProfileSource } from '../../persistence/index.js';
import { fromOperationOutcome, toOperationOutcome } from '../operation-outcome-converter.js';

const profileUrl = 'https://records.test/StructureDefinition/ucum-completeness';
const originalSource = getProfileSource();
const roots: string[] = [];
const originalValidate = UcumCodeValidator.prototype.validate;
const paths = ['Observation.code.coding[0].code', 'Observation.valueQuantity.code', 'Observation.referenceRange[0].low.code'];

afterEach(async () => {
  vi.restoreAllMocks();
  setProfileSource(originalSource);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'records-ucum-public-')); roots.push(root);
  setProfileSource({ packageDirectories: [] });
  const validator = new RecordsValidator({ packageCachePath: root, bundledProfilesPath: null,
    terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false, enableCaching: false });
  await validator.waitForInitialization();
  const definition: StructureDefinition = {
    resourceType: 'StructureDefinition', url: profileUrl, name: 'UcumCompleteness', status: 'active',
    kind: 'resource', abstract: false, type: 'Observation', fhirVersion: '4.0.1',
    snapshot: { element: [
      { id: 'Observation', path: 'Observation', min: 0, max: '*' },
      { id: 'Observation.code', path: 'Observation.code', min: 0, max: '1', type: [{ code: 'CodeableConcept' }] },
      { id: 'Observation.value[x]', path: 'Observation.value[x]', min: 0, max: '1', type: [{ code: 'Quantity' }] },
    ] },
  };
  expect(validator.getSdLoader().registerExternalProfile(definition, 'R4')).toBe(true);
  const settings = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  for (const aspect of Object.values(settings.aspects)) aspect.enabled = false;
  settings.aspects.terminology.enabled = true;
  settings.terminologyServers = []; settings.advisorRules = [];
  settings.profileSources = { simplifier: false, packageRegistry: false };
  if (settings.packageDownload) settings.packageDownload.autoDownload = false;
  settings.terminologyResolution = { ...settings.terminologyResolution, strategy: 'local-only',
    serverDelegation: { expandValueSets: false, validateCodes: false, cacheResults: true, cacheTTLSeconds: 3600 } };
  await validator.configureTerminologyResolution(settings.terminologyResolution);
  return async (api: 'single' | 'multi', code: string) => {
    const coding = { system: 'http://unitsofmeasure.org', code };
    const resource = { resourceType: 'Observation', code: { coding: [coding] },
      valueQuantity: { ...coding, value: 1 }, referenceRange: [{ low: { ...coding, value: 0 } }] };
    if (api === 'single') return { issues: await validator.validate(resource, profileUrl, 'R4', settings) };
    const result = await validator.validateAspects(resource, { aspects: ['terminology'], fhirVersion: 'R4',
      profileUrl, profileSources: ['explicit-run'], settings });
    return { issues: result.aspects.flatMap(aspect => aspect.issues), isValid: result.isValid };
  };
}

function parserFault(mode: 'unavailable' | 'throws' | 'error-status' | 'malformed') {
  const fault = new UcumCodeValidator();
  if (mode === 'unavailable') Object.assign(fault, { initFailed: true });
  else Object.assign(fault, { ucumUtils: { validateUnitString: () => {
    if (mode === 'throws') throw new Error('Controlled UCUM parser failure');
    return mode === 'error-status' ? { status: 'error', msg: ['Controlled parser error'] } : null;
  } } });
  vi.spyOn(UcumCodeValidator.prototype, 'validate').mockImplementation(code => originalValidate.call(fault, code));
}

describe('public UCUM completeness', () => {
  for (const api of ['single', 'multi'] as const) {
    it(`${api} accepts proved units and rejects invalid units at every path`, async () => {
      const validate = await fixture();
      expect((await validate(api, 'mg/dL')).issues.filter(issue => ['error', 'fatal'].includes(issue.severity))).toEqual([]);
      const invalid = (await validate(api, 'records-no-such-unit')).issues.filter(issue => issue.code === 'terminology-code-invalid');
      expect(invalid.map(issue => issue.path).sort()).toEqual([...paths].sort());
      expect(invalid.every(issue => issue.severity === 'error' && issue.details?.validationComplete !== false)).toBe(true);
    });

    it.each(['unavailable', 'throws'] as const)(`${api} preserves independently proved character errors with a %s parser`, async mode => {
      parserFault(mode);
      const validate = await fixture();
      const issues = (await validate(api, 'µg')).issues;
      const rejected = issues.filter(issue => issue.code === 'terminology-code-invalid');
      expect(rejected.map(issue => issue.path).sort()).toEqual([...paths].sort());
      expect(rejected.every(issue => issue.severity === 'error' && issue.details?.validationComplete !== false)).toBe(true);
      expect(issues.some(issue => issue.code === 'terminology-ucum-unverified')).toBe(false);
    });

    it.each(['unavailable', 'throws', 'error-status', 'malformed'] as const)(`${api} keeps %s parser evidence unknown and deduplicated`, async mode => {
      parserFault(mode);
      const validate = await fixture();
      for (let round = 0; round < 2; round++) {
        const result = await validate(api, 'mg/dL');
        const unchecked = result.issues.filter(issue => issue.code === 'terminology-ucum-unverified');
        expect(unchecked.map(issue => issue.path).sort()).toEqual([...paths].sort());
        expect(unchecked.every(issue => issue.details?.validationComplete === false && issue.details?.validationStatus === 'incomplete')).toBe(true);
        expect(result.issues.filter(issue => ['error', 'fatal'].includes(issue.severity))).toEqual([]);
        if (api === 'multi') expect(result.isValid).toBe(false);
        const published = fromOperationOutcome(toOperationOutcome(result.issues));
        expect(published.filter(issue => issue.code === 'terminology-ucum-unverified'))
          .toHaveLength(paths.length);
        expect(published.filter(issue => issue.code === 'terminology-ucum-unverified')
          .every(issue => issue.details?.validationComplete === false)).toBe(true);
      }
    });
  }

  it.each(['throws', 'error-status', 'malformed'] as const)('does not cache an unchecked %s answer as later validity or invalidity', mode => {
    const parser = vi.fn().mockImplementationOnce(() => {
      if (mode === 'throws') throw new Error('Temporary parser failure');
      return mode === 'error-status' ? { status: 'error' } : null;
    })
      .mockReturnValueOnce({ status: 'valid' }).mockReturnValue({ status: 'invalid', msg: ['Unknown unit'] });
    const validator = new UcumCodeValidator(); Object.assign(validator, { ucumUtils: { validateUnitString: parser } });
    expect(validator.validate('mg/dL')).toMatchObject({ validationComplete: false });
    expect(validator.validate('mg/dL')).toEqual({ valid: true });
    expect(validator.validate('records-no-such-unit')).toMatchObject({ valid: false });
    expect(parser).toHaveBeenCalledTimes(3);
  });
});
