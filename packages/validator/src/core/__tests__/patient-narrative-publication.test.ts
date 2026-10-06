import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4, type ValidationIssue, type ValidationSettings } from '@records-fhir/validation-types';
import { ProfileExecutor } from '../executors/profile-executor.js';
import { RecordsValidator } from '../validator-engine.js';
import { createIsolatedConstraintStore, expectIsolatedConstraintProfilesLoaded, narrativePublicationDefinitions, removeIsolatedConstraintStore } from './portable-core-constraint-profiles.js';
import {
  NARRATIVE_EXPRESSION, PATIENT_PROFILE, narrativeDetails, patientWithoutNarrative,
} from './patient-narrative-fixtures.js';

function settings(overrides: Partial<ValidationSettings> = {}): ValidationSettings {
  const baseline = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  if (!baseline.packageDownload) throw new Error('Maintained R4 defaults must declare package download policy');
  return {
    ...baseline,
    terminologyServers: [],
    terminologyResolution: { ...baseline.terminologyResolution, strategy: 'local-only' },
    profileSources: { simplifier: false, packageRegistry: false },
    packageDownload: { ...baseline.packageDownload, autoDownload: false },
    ...overrides,
  };
}

function narrativeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  expect(issues.some(issue => ['profile-not-found', 'profile-not-resolved'].includes(issue.code ?? ''))).toBe(false);
  return issues.filter(issue => issue.code === 'dom-6');
}

function expectCanonical(issues: ValidationIssue[], severity: 'information' | 'warning', type = 'Patient') {
  const narrative = narrativeIssues(issues);
  expect(narrative).toHaveLength(1);
  expect(narrative[0]).toMatchObject({
    code: 'dom-6', ruleId: 'dom-6', severity, resourceType: type,
    path: `${type}.text`, profile: `http://hl7.org/fhir/StructureDefinition/${type}`,
    details: { constraintKey: 'dom-6', expression: NARRATIVE_EXPRESSION, originalSeverity: 'warning' },
  });
  expect(narrativeDetails(narrative[0]).bestPractice).not.toBe(true);
  return narrative[0];
}

describe('Patient narrative publication through real single and batch owners', () => {
  let validator: RecordsValidator;
  let packageRoot: string;
  beforeAll(async () => {
    packageRoot = await createIsolatedConstraintStore(narrativePublicationDefinitions());
    validator = new RecordsValidator({ packageCachePath: packageRoot, bundledProfilesPath: packageRoot,
      terminologyPackageDirectories: [], prewarmProfileSource: false, enableCaching: false, strictMode: false, timeout: 30_000, autoDownload: false });
    validator.configureTerminologyResolution({
      strategy: 'local-only', serverUrl: undefined,
      serverDelegation: { expandValueSets: false, validateCodes: false, cacheResults: true, cacheTTLSeconds: 3600 },
    });
    await validator.waitForInitialization();
    await expectIsolatedConstraintProfilesLoaded(validator, narrativePublicationDefinitions());
  }, 120_000);
  afterAll(async () => { await removeIsolatedConstraintStore(packageRoot); });

  async function both(
    resource: Record<string, unknown>, release: 'R4' | 'R5' = 'R4',
    effective = settings(), aspects: Array<'structural' | 'profile'> = ['structural', 'profile'],
  ) {
    const profile = `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;
    const single = await validator.validate(resource, profile, release, effective);
    const results = await validator.validateBatch([resource], {
      fhirVersion: release, profileUrl: profile, maxConcurrency: 1, aspects, settings: effective,
    });
    const batch = results.get(resource);
    expect(batch).toBeDefined();
    if (!batch || Array.isArray(batch)) throw new Error('Expected actual multi-aspect result');
    return { single, batch: batch.aspects.flatMap(aspect => aspect.issues), raw: batch.aspects.flatMap(aspect => aspect.evidenceIssues ?? []) };
  }

  it.each(['R4', 'R5'] as const)('publishes one canonical occurrence under default and warning policies for %s', async release => {
    for (const configured of [undefined, 'info', 'warning'] as const) {
      const resource = { ...patientWithoutNarrative, id: `narrative-${release}-${configured ?? 'default'}` };
      const result = await both(resource, release, settings({ bestPracticeSeverity: configured }));
      const severity = configured === 'warning' ? 'warning' : 'information';
      expectCanonical(result.single, severity);
      expectCanonical(result.batch, severity);
      expect(narrativeIssues(result.raw)).toHaveLength(2);
    }
  }, 120_000);

  it('keeps the real ProfileExecutor return intact and retains its identity at publication', async () => {
    const original = ProfileExecutor.prototype.validate;
    const observed: Array<{ issues: ValidationIssue[]; bytes: string }> = [];
    const spy = vi.spyOn(ProfileExecutor.prototype, 'validate').mockImplementation(async function (this: ProfileExecutor, ...args) {
      const issues: ValidationIssue[] = await Reflect.apply(original, this, args);
      observed.push({ issues, bytes: JSON.stringify(issues) });
      return issues;
    });
    try {
      const result = await both({ ...patientWithoutNarrative, id: 'raw-owner-preserved' });
      const rawCanonical = observed.flatMap(row => row.issues).filter(issue => issue.code === 'dom-6');
      expect(rawCanonical).toHaveLength(2);
      expect(rawCanonical.every(issue => issue.severity === 'warning' && issue.ruleId === 'dom-6')).toBe(true);
      for (const row of observed) expect(JSON.stringify(row.issues)).toBe(row.bytes);
      for (const [index, published] of [expectCanonical(result.single, 'information'), expectCanonical(result.batch, 'information')].entries()) {
        const raw = rawCanonical[index];
        expect(published.id).toBe(raw.id);
        expect(published.details).toBe(raw.details);
      }
    } finally {
      spy.mockRestore();
    }
  }, 120_000);

  it('retains a real strict canonical error beside generated advice on single and batch validation', async () => {
    const strictValidator = new RecordsValidator({
      packageCachePath: packageRoot, bundledProfilesPath: packageRoot, terminologyPackageDirectories: [], prewarmProfileSource: false,
      enableCaching: false, strictMode: true, timeout: 30_000, autoDownload: false,
    });
    strictValidator.configureTerminologyResolution({
      strategy: 'local-only', serverUrl: undefined,
      serverDelegation: { expandValueSets: false, validateCodes: false, cacheResults: true, cacheTTLSeconds: 3600 },
    });
    await strictValidator.waitForInitialization();
    await expectIsolatedConstraintProfilesLoaded(strictValidator, narrativePublicationDefinitions());
    const original = ProfileExecutor.prototype.validate;
    const observed: Array<{ issues: ValidationIssue[]; bytes: string }> = [];
    const spy = vi.spyOn(ProfileExecutor.prototype, 'validate').mockImplementation(async function (this: ProfileExecutor, ...args) {
      const issues: ValidationIssue[] = await Reflect.apply(original, this, args);
      observed.push({ issues, bytes: JSON.stringify(issues) });
      return issues;
    });
    try {
      const resource = { ...patientWithoutNarrative, id: 'strict-narrative-owners' };
      const effective = settings({ validationStrictness: 'strict', bestPracticeSeverity: 'warning' });
      const single = await strictValidator.validate(resource, PATIENT_PROFILE, 'R4', effective);
      const results = await strictValidator.validateBatch([resource], {
        fhirVersion: 'R4', profileUrl: PATIENT_PROFILE, maxConcurrency: 1,
        aspects: ['structural', 'profile'], settings: effective,
      });
      const batch = results.get(resource);
      expect(batch).toBeDefined();
      if (!batch || Array.isArray(batch)) throw new Error('Expected actual multi-aspect result');
      const rawCanonical = observed.flatMap(row => row.issues).filter(issue => issue.code === 'dom-6');
      expect(rawCanonical).toHaveLength(2);
      expect(rawCanonical.every(issue => issue.severity === 'error' && narrativeDetails(issue).escalated === true)).toBe(true);
      for (const row of observed) expect(JSON.stringify(row.issues)).toBe(row.bytes);
      for (const [index, issues] of [single, batch.aspects.flatMap(aspect => aspect.issues)].entries()) {
        const narrative = narrativeIssues(issues);
        expect(narrative).toHaveLength(2);
        const canonical = narrative.find(issue => issue.ruleId === 'dom-6');
        const generated = narrative.find(issue => narrativeDetails(issue).bestPractice === true);
        expect(canonical).toMatchObject({
          severity: 'error', ruleId: 'dom-6', path: 'Patient.text', profile: PATIENT_PROFILE,
          details: { escalated: true, originalSeverity: 'warning', expression: NARRATIVE_EXPRESSION },
        });
        expect(generated).toMatchObject({ severity: 'warning', path: 'Patient.text', details: { bestPractice: true } });
        const raw = rawCanonical[index];
        expect(canonical?.id).toBe(raw.id);
        expect(canonical?.details).toBe(raw.details);
      }
      expect(narrativeIssues(batch.aspects.flatMap(aspect => aspect.evidenceIssues ?? []))).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  }, 120_000);

  it('preserves the canonical owner when generated advice is disabled', async () => {
    const result = await both({ ...patientWithoutNarrative, id: 'advice-disabled' }, 'R4', settings({ enableBestPracticeChecks: false }));
    expectCanonical(result.single, 'information');
    expectCanonical(result.batch, 'information');
    expect(narrativeIssues(result.raw)).toHaveLength(1);
  }, 120_000);

  it('preserves generated advice on single validate when the profile owner is disabled', async () => {
    const result = await validator.validate(
      { ...patientWithoutNarrative, id: 'profile-disabled' }, PATIENT_PROFILE, 'R4', settings({
        aspects: {
          ...DEFAULT_VALIDATION_SETTINGS_R4.aspects,
          profile: { enabled: false, engine: 'records', severity: 'inherit' },
        },
      }),
    );
    const narrative = narrativeIssues(result);
    expect(narrative).toHaveLength(1);
    expect(narrative[0]).toMatchObject({ severity: 'information', details: { bestPractice: true } });
    expect(narrative[0].ruleId).toBeUndefined();
  }, 120_000);

  it('preserves batch semantic aspect projection after dependency execution', async () => {
    const resource = { ...patientWithoutNarrative, id: 'selected-owner' };
    for (const aspect of ['structural', 'profile'] as const) {
      const results = await validator.validateBatch([resource], {
        fhirVersion: 'R4', profileUrl: PATIENT_PROFILE, maxConcurrency: 1,
        aspects: [aspect], settings: settings(),
      });
      const result = results.get(resource);
      expect(result).toBeDefined();
      if (!result || Array.isArray(result)) throw new Error('Expected actual multi-aspect result');
      expect(result.aspects.every(selected => selected.aspect === aspect)).toBe(true);
      const issues = result.aspects.flatMap(selected => selected.issues);
      if (aspect === 'structural') expectCanonical(issues, 'information');
      else expect(narrativeIssues(issues)).toHaveLength(0);
    }
  }, 120_000);

  it('does not invent a failed canonical constraint for existing empty or whitespace div', async () => {
    for (const div of ['', '   ', '<div xmlns="http://www.w3.org/1999/xhtml">Test</div>']) {
      const result = await both({ ...patientWithoutNarrative, id: `div-${div.length}`, text: { status: 'generated', div } });
      for (const issues of [result.single, result.batch]) {
        const narrative = narrativeIssues(issues);
        expect(narrative).toHaveLength(0);
        if (div === '') expect(issues.some(issue => issue.code === 'narrative-missing-div')).toBe(true);
      }
      if (div === '') {
        const advice = narrativeIssues(result.raw);
        expect(advice).toHaveLength(1);
        expect(advice[0]).toMatchObject({ details: { bestPractice: true } });
        expect(advice[0].ruleId).toBeUndefined();
      }
    }
  }, 120_000);

  it('preserves Condition and Observation canonical narrative constraints', async () => {
    for (const resource of [
      { resourceType: 'Condition', id: 'condition-narrative', code: { text: 'Test' }, subject: { reference: 'Patient/test' } },
      { resourceType: 'Observation', id: 'observation-narrative', status: 'final', code: { text: 'Test' } },
    ]) {
      const result = await both(resource);
      expectCanonical(result.single, 'information', resource.resourceType);
      expectCanonical(result.batch, 'information', resource.resourceType);
    }
  }, 120_000);

  it('preserves distinct indexed Patient occurrences in a recursively validated Bundle', async () => {
    const resource = {
      resourceType: 'Bundle', id: 'narrative-occurrences', type: 'collection',
      entry: ['first', 'second'].map(id => ({
        fullUrl: `urn:uuid:${id}`, resource: { ...patientWithoutNarrative, id },
      })),
    };
    const result = await both(resource);
    for (const issues of [result.single, result.batch]) {
      const narrative = narrativeIssues(issues);
      expect(narrative).toHaveLength(2);
      expect(narrative.every(issue => issue.ruleId === 'dom-6')).toBe(true);
      expect(new Set(narrative.map(issue => issue.path)).size).toBe(2);
      expect(narrative.some(issue => issue.path?.includes('entry[0]'))).toBe(true);
      expect(narrative.some(issue => issue.path?.includes('entry[1]'))).toBe(true);
    }
  }, 120_000);
});
