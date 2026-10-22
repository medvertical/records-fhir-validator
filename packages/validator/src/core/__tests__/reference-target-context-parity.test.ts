import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4 } from '@records-fhir/validation-types';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { setProfileSource } from '../../persistence/profile-source.js';
import { RecordsValidator } from '../validator-engine.js';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types.js';
import {
  createIsolatedConstraintStore,
  expectIsolatedConstraintProfilesLoaded,
  removeIsolatedConstraintStore,
} from './portable-core-constraint-profiles.js';

const reportCanonical = 'https://example.test/StructureDefinition/target-context-report';
const targetCanonical = 'https://example.test/StructureDefinition/target-context-result';
const coreCanonical = (type: string) => `http://hl7.org/fhir/StructureDefinition/${type}`;
function definition(type: string, url: string, elements: ElementDefinition[]): StructureDefinition {
  return { resourceType: 'StructureDefinition', url, name: type, status: 'active', kind: 'resource',
    abstract: false, type, version: '4.0.1', fhirVersion: '4.0.1',
    snapshot: { element: [{ id: type, path: type, min: 0, max: '*' }, ...elements] } };
}

const status = (type: string): ElementDefinition => ({
  id: `${type}.status`, path: `${type}.status`, min: 0, max: '1', type: [{ code: 'code' }],
});
const result: ElementDefinition = {
  id: 'DiagnosticReport.result', path: 'DiagnosticReport.result', min: 0, max: '*',
  type: [{ code: 'Reference' }],
};
const core = [
  definition('DiagnosticReport', coreCanonical('DiagnosticReport'), [status('DiagnosticReport'), result]),
  definition('Observation', coreCanonical('Observation'), [status('Observation')]),
];
const reportProfile = definition('DiagnosticReport', reportCanonical, [status('DiagnosticReport'),
  { ...result, slicing: { discriminator: [{ type: 'profile', path: 'resolve()' }], rules: 'open' } },
  { ...result, id: 'DiagnosticReport.result:selected', sliceName: 'selected', min: 1,
    type: [{ code: 'Reference', targetProfile: [targetCanonical] }] },
]);
const targetProfile = definition('Observation', targetCanonical, [
  { ...status('Observation'), min: 1, fixedCode: 'final' },
]);

let directory: string | undefined;
let validator: RecordsValidator;
beforeAll(async () => {
  directory = await createIsolatedConstraintStore(core);
  validator = new RecordsValidator({ packageCachePath: directory, bundledProfilesPath: directory,
    terminologyPackageDirectories: [], autoDownload: false, prewarmProfileSource: false });
  await validator.waitForInitialization();
  await expectIsolatedConstraintProfilesLoaded(validator, core);
  expect(validator.getSdLoader().registerExternalProfile(reportProfile, 'R4')).toBe(true);
  expect(validator.getSdLoader().registerExternalProfile(targetProfile, 'R4')).toBe(true);
  setProfileSource({ resolveProfile: async (canonical, version, _settings, scope) => {
    expect(version).toBeUndefined();
    expect(scope).toMatchObject({ organizationId: 7, serverId: 11, fhirVersion: 'R4' });
    return [...core, reportProfile, targetProfile].find(profile => profile.url === canonical.split('|')[0]) ?? null;
  } });
}, 60_000);
afterAll(async () => { setProfileSource({}); await removeIsolatedConstraintStore(directory); });

function settings(validateTargetProfiles?: boolean) {
  const configured = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  configured.profileSources = { simplifier: false, packageRegistry: false };
  configured.packageDownload = { ...configured.packageDownload, autoDownload: false };
  configured.terminologyServers = [];
  configured.imposedProfiles = { enabled: false, policies: [] };
  configured.recursiveReferenceValidation = { ...configured.recursiveReferenceValidation,
    enabled: true, validateExternal: false, ...(validateTargetProfiles === undefined ? {} : { validateTargetProfiles }) };
  return configured;
}
function fixture(label: string, targetStatus: string | null) {
  const id = `result-${label}`;
  return {
    report: { resourceType: 'DiagnosticReport', id: `report-${label}`, status: 'final',
      meta: { profile: [reportCanonical] }, result: [{ reference: `Observation/${id}` }] },
    target: targetStatus === null ? null : { resourceType: 'Observation', id, status: targetStatus,
      meta: { profile: [targetCanonical] } },
  };
}
const signature = (issues: ValidationIssue[]) => issues.map(issue => JSON.stringify({
  code: issue.code, path: issue.path, severity: issue.severity,
  incomplete: issue.details?.validationComplete === false,
})).sort();

describe('same-basis target-dependent slicing in direct and batch validation', () => {
  it.each(['final', 'preliminary', null])('matches fetched and host-resolved target evidence for %s', async targetStatus => {
    const { report, target } = fixture(targetStatus ?? 'missing', targetStatus);
    const getResource = vi.fn(async () => target);
    const options = { aspects: ['profile'], fhirVersion: 'R4' as const, settings: settings(true),
      fhirClient: { getResource }, organizationId: 7, serverId: 11 };
    const direct = await validator.validateAspects(report, options);
    const fetchedBatch = (await validator.validateBatch([report], { ...options, maxConcurrency: 1 })).get(report)!;
    getResource.mockClear();
    const hostBatch = (await validator.validateBatch([report], { ...options, maxConcurrency: 1,
      referenceResolver: reference => reference === report.result[0].reference ? target : null })).get(report)!;
    const directIssues = direct.aspects.flatMap(aspect => aspect.issues);
    expect(directIssues.some(issue => issue.code === 'profile-not-resolved')).toBe(false);
    for (const actual of [fetchedBatch, hostBatch]) {
      expect(signature(actual.aspects.flatMap(aspect => aspect.issues))).toEqual(signature(directIssues));
      expect(actual.isValid).toBe(direct.isValid);
    }
    if (target) expect(getResource).not.toHaveBeenCalled();
    expect(directIssues.some(issue => issue.code === 'profile-slice-min-cardinality')).toBe(targetStatus === 'preliminary');
    expect(directIssues.some(issue => issue.code === 'profile-slice-validation-incomplete')).toBe(targetStatus === null);
    expect(directIssues.some(issue => issue.code === 'profile-slice-open-unmatched')).toBe(targetStatus === 'preliminary');
  });

  it.each([undefined, false])('does not fetch targets without explicit opt-in (%s)', async optIn => {
    const { report, target } = fixture(`not-enabled-${String(optIn)}`, 'final');
    const getResource = vi.fn(async () => target);
    const options = { aspects: ['profile'], fhirVersion: 'R4' as const, settings: settings(optIn),
      fhirClient: { getResource }, organizationId: 7, serverId: 11 };
    const direct = await validator.validateAspects(report, options);
    const batch = (await validator.validateBatch([report], { ...options, maxConcurrency: 1 })).get(report)!;
    expect(getResource).not.toHaveBeenCalled();
    const issues = direct.aspects.flatMap(aspect => aspect.issues);
    expect(signature(batch.aspects.flatMap(aspect => aspect.issues))).toEqual(signature(issues));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'profile-slice-validation-incomplete',
      details: expect.objectContaining({ validationComplete: false }) }));
    expect(issues.some(issue => issue.code === 'profile-slice-open-unmatched')).toBe(false);
  });
});
