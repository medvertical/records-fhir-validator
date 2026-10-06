import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { VALIDATION_ASPECTS, type ValidationIssue, type ValidationSettings } from '@records-fhir/validation-types';
import { RecordsValidator } from '../validator-engine';
import type { RecordsValidatorComponents } from '../validator-engine-components';
import type { StructureDefinition } from '../structure-definition-types';
import { isUsableResourceBaseProfile } from '../profile-resource-type';
import { projectSemanticAspectResult, resolveSemanticAspectPlan } from '../semantic-aspect-plan';
import type { MultiAspectValidateResult } from '../multi-aspect-types';

const domainUrl = 'http://hl7.org/fhir/StructureDefinition/DomainResource';
const bundleUrl = 'http://hl7.org/fhir/StructureDefinition/Bundle';
const domain = (): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: domainUrl, name: 'DomainResource', status: 'active',
  kind: 'resource', abstract: true, type: 'DomainResource', fhirVersion: '4.0.1',
  snapshot: { element: [{ id: 'DomainResource', path: 'DomainResource' },
    { id: 'DomainResource.forbidden', path: 'DomainResource.forbidden', min: 1, max: '1' }] },
});
const bundle = (): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: bundleUrl, name: 'Bundle', status: 'active',
  kind: 'resource', abstract: false, type: 'Bundle', fhirVersion: '4.0.1',
  snapshot: { element: [{ id: 'Bundle', path: 'Bundle' }, { id: 'Bundle.type', path: 'Bundle.type', min: 1, max: '1' }] },
});
const failureModes = ['absent', 'wrong-type', 'wrong-canonical', 'abstract', 'wrong-kind', 'empty', 'wrong-family', 'throw'] as const;
type FailureMode = typeof failureModes[number];

function rejectedBase(mode: FailureMode): StructureDefinition | null {
  if (mode === 'throw') throw new Error('Synthetic concrete base store failure');
  if (mode === 'absent') return null;
  const selected = bundle();
  if (mode === 'wrong-type') selected.type = 'DomainResource';
  if (mode === 'wrong-canonical') selected.url = 'https://example.test/OtherBundle';
  if (mode === 'abstract') selected.abstract = true;
  if (mode === 'wrong-kind') selected.kind = 'complex-type';
  if (mode === 'empty') selected.snapshot = { element: [] };
  if (mode === 'wrong-family') selected.fhirVersion = '5.0.0';
  return selected;
}

function assertPublishedFailure(issues: ValidationIssue[], mode: FailureMode): void {
  expect(issues.map(issue => issue.code).sort()).toEqual([
    'profile-not-found', 'structural-resource-type-mismatch', ...(mode === 'throw' ? ['profile-unreadable'] : []),
  ].sort());
  expect(issues).toContainEqual(expect.objectContaining({ code: 'structural-resource-type-mismatch',
    severity: 'error', aspect: 'structural', schemaVersion: 'R4', path: 'meta.profile',
    details: { profile: domainUrl, profileResourceType: 'DomainResource', resourceType: 'Bundle',
      validatedAgainstBase: false, validationComplete: false } }));
  expect(issues.some(issue => issue.path === 'DomainResource.forbidden')).toBe(false);
  expect(issues.some(issue => issue.code === 'validation-error')).toBe(false);
}

function assertIncompleteMulti(result: MultiAspectValidateResult, mode: FailureMode): void {
  assertPublishedFailure(result.aspects.flatMap(aspect => aspect.issues), mode);
  expect(result.isValid).toBe(false);
  expect(result.structureDef).toBeUndefined();
  expect(VALIDATION_ASPECTS.every(aspect => result.aspects.some(selected => selected.aspect === aspect && !selected.isValid))).toBe(true);
  expect(result.aspects.find(aspect => aspect.aspect === 'structural')?.evidenceIssues).toContainEqual(
    expect.objectContaining({ code: 'structural-resource-type-mismatch' }),
  );
}

function assertSubsetFailure(result: MultiAspectValidateResult, requested: 'structural' | 'terminology', mode: FailureMode): void {
  expect(result.aspects.map(aspect => aspect.aspect)).toEqual([requested]);
  expect(result.isValid).toBe(false);
  expect(result.structureDef).toBeUndefined();
  const selected = result.aspects[0];
  expect(selected.isValid).toBe(false);
  expect(selected.issues.map(issue => issue.code).sort()).toEqual(requested === 'structural'
    ? ['structural-resource-type-mismatch', ...(mode === 'throw' ? ['profile-unreadable'] : [])].sort() : []);
  expect(selected.issues.every(issue => issue.aspect === requested)).toBe(true);
  expect(selected.evidenceIssues).toContainEqual(expect.objectContaining({ aspect: 'structural', severity: 'error',
    code: 'structural-resource-type-mismatch', schemaVersion: 'R4',
    details: { profile: domainUrl, profileResourceType: 'DomainResource', resourceType: 'Bundle',
      validatedAgainstBase: false, validationComplete: false } }));
}

describe('known declaration mismatch survives real public missing-base boundaries', () => {
  it.each(failureModes)('retains mismatch and missing/unreadable diagnostics when the base is %s', async mode => {
    const directory = await mkdtemp(join(tmpdir(), 'declared-base-publication-'));
    const packagePath = join(directory, 'hl7.fhir.r4.core#4.0.1', 'package');
    await mkdir(packagePath, { recursive: true });
    await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: 'hl7.fhir.r4.core', version: '4.0.1',
      type: 'fhir.core', fhirVersions: ['4.0.1'] }));
    await writeFile(join(packagePath, 'StructureDefinition-DomainResource.json'), JSON.stringify(domain()));
    const validator = new RecordsValidator({ packageCachePath: directory, bundledProfilesPath: null,
      autoDownload: false, prewarmProfileSource: false, terminologyPackageDirectories: [], enableCaching: false });
    try {
      await validator.waitForInitialization();
      const sdLoader = validator.getSdLoader();
      const originalLoad = sdLoader.loadProfile.bind(sdLoader);
      const load = vi.spyOn(sdLoader, 'loadProfile').mockImplementation((url, version) =>
        url === bundleUrl ? Promise.resolve().then(() => rejectedBase(mode)) : originalLoad(url, version));
      const components = Reflect.get(validator, 'components') as RecordsValidatorComponents;
      const calls = [vi.spyOn(components.structuralExecutor, 'validate'), vi.spyOn(components.profileExecutor, 'validate'),
        vi.spyOn(components.terminologyExecutor, 'validate'), vi.spyOn(components.invariantExecutor, 'validate'),
        vi.spyOn(components.referenceExecutor, 'validate'), vi.spyOn(components.customRuleExecutor, 'validate'),
        vi.spyOn(components.metadataExecutor, 'validate'), vi.spyOn(components.bestPracticeValidator, 'validate'),
        vi.spyOn(components.terminologyResourceValidator, 'validate')];
      const resource = { resourceType: 'Bundle', id: 'synthetic-negative', type: 'collection', meta: { profile: [domainUrl] } };

      const single = await validator.validate(resource, domainUrl, 'R4');
      assertPublishedFailure(single, mode);
      const batch = await validator.validateBatch([resource], { fhirVersion: 'R4', profileUrl: domainUrl });
      const batchIssues = batch.get(resource);
      expect(Array.isArray(batchIssues)).toBe(true);
      assertPublishedFailure(batchIssues as ValidationIssue[], mode);

      const multi = await validator.validateAspects(resource, { fhirVersion: 'R4', profileUrl: domainUrl,
        aspects: VALIDATION_ASPECTS, settings: {} as ValidationSettings });
      assertIncompleteMulti(multi, mode);
      const multiBatch = await validator.validateBatch([resource], { fhirVersion: 'R4', profileUrl: domainUrl,
        aspects: VALIDATION_ASPECTS, settings: {} as ValidationSettings });
      const multiBatchResult = multiBatch.get(resource);
      expect(multiBatchResult).toBeDefined();
      expect(Array.isArray(multiBatchResult)).toBe(false);
      assertIncompleteMulti(multiBatchResult as MultiAspectValidateResult, mode);
      for (const requested of ['structural', 'terminology'] as const) {
        const subset = await validator.validateAspects(resource, { fhirVersion: 'R4', profileUrl: domainUrl,
          aspects: [requested], settings: {} as ValidationSettings });
        assertSubsetFailure(subset, requested, mode);
        const subsetBatch = await validator.validateBatch([resource], { fhirVersion: 'R4', profileUrl: domainUrl,
          aspects: [requested], settings: {} as ValidationSettings });
        assertSubsetFailure(subsetBatch.get(resource) as MultiAspectValidateResult, requested, mode);
      }
      expect(load).toHaveBeenCalledWith(domainUrl, 'R4');
      expect(load).toHaveBeenCalledWith(bundleUrl, 'R4');
      expect(calls.every(call => call.mock.calls.length === 0)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('missing-base evidence projection stays bounded to a proved mismatch', () => {
  it('keeps suppressed structural cause evidence without publishing its unrequested bucket or finding', () => {
    const cause: ValidationIssue = { aspect: 'structural', severity: 'error', disposition: 'suppressed',
      code: 'structural-resource-type-mismatch', message: 'Known incompatible declaration',
      details: { validatedAgainstBase: false, validationComplete: false } };
    const projected = projectSemanticAspectResult({ isValid: false, aspects: [{ aspect: 'structural', issues: [],
      evidenceIssues: [cause], validationTime: 0, isValid: false }] }, resolveSemanticAspectPlan(['terminology']));
    expect(projected).toMatchObject({ isValid: false, aspects: [{ aspect: 'terminology', issues: [],
      evidenceIssues: [cause], isValid: false }] });
    expect(projected.aspects).toHaveLength(1);
    expect(projected.aspects[0].evidenceIssues?.[0]).toBe(cause);
    expect(cause.aspect).toBe('structural');
  });

  it('keeps existing generic-only missing-definition projection failure', () => {
    expect(() => projectSemanticAspectResult({ isValid: false, aspects: [{ aspect: 'profile',
      issues: [{ aspect: 'profile', severity: 'error', code: 'profile-not-found', message: 'Unavailable' }], validationTime: 0, isValid: false }] },
    resolveSemanticAspectPlan(['structural', 'profile']))).toThrow('aspect could not be completed');
  });

  it('does not infer a publication family when the genuine base omits fhirVersion', () => {
    const base = bundle();
    Reflect.deleteProperty(base, 'fhirVersion');
    expect(isUsableResourceBaseProfile(base, 'Bundle', 'R4')).toBe(true);
    expect(isUsableResourceBaseProfile(base, 'Bundle', 'R6')).toBe(true);
  });

  it.each([['4.0.1', 'R5'], ['5.0.0', 'R4'], ['6.0.0', 'R4']] as const)(
    'rejects the explicit wrong family %s for %s', (publication, requested) => {
      const base = bundle();
      base.fhirVersion = publication;
      expect(isUsableResourceBaseProfile(base, 'Bundle', requested)).toBe(false);
    },
  );
});
