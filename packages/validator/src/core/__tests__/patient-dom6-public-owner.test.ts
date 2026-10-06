import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALIDATION_SETTINGS_R4, type ValidationIssue, type ValidationSettings } from '@records-fhir/validation-types';
import { ProfileExecutor } from '../executors/profile-executor.js';
import { RecordsValidator } from '../validator-engine.js';
import type { StructureDefinition } from '../structure-definition-types.js';

const profileUrl = 'https://records.test/StructureDefinition/active-patient';
const modes = [
  { strict: false, cap: 'inherit' }, { strict: true, cap: 'inherit' },
  { strict: false, cap: 'info' }, { strict: true, cap: 'info' },
] as const;

function definition(): StructureDefinition {
  return {
    resourceType: 'StructureDefinition', url: profileUrl, name: 'ControlledActivePatient',
    status: 'active', kind: 'resource', abstract: false, type: 'Patient', fhirVersion: '4.0.1',
    snapshot: { element: [
      { id: 'Patient', path: 'Patient', min: 0, max: '*', constraint: [{ key: 'dom-6', severity: 'error',
        human: 'Controlled Patient must be active', expression: 'active = true', source: profileUrl }] },
      { id: 'Patient.id', path: 'Patient.id', min: 0, max: '1', type: [{ code: 'id' }] },
      { id: 'Patient.active', path: 'Patient.active', min: 0, max: '1', type: [{ code: 'boolean' }] },
      { id: 'Patient.text', path: 'Patient.text', min: 0, max: '1', type: [{ code: 'Narrative' }] },
      { id: 'Patient.text.status', path: 'Patient.text.status', min: 0, max: '1', type: [{ code: 'code' }] },
      { id: 'Patient.text.div', path: 'Patient.text.div', min: 0, max: '1', type: [{ code: 'xhtml' }] },
    ] },
  };
}

function settings(strict: boolean, cap: 'inherit' | 'info'): ValidationSettings {
  const baseline = structuredClone(DEFAULT_VALIDATION_SETTINGS_R4);
  if (!baseline.packageDownload) throw new Error('Maintained R4 defaults must declare package download policy');
  return {
    ...baseline, terminologyServers: [], profileSources: { simplifier: false, packageRegistry: false },
    packageDownload: { ...baseline.packageDownload, autoDownload: false },
    terminologyResolution: { ...baseline.terminologyResolution, strategy: 'local-only' },
    validationStrictness: strict ? 'strict' : 'standard', bestPracticeSeverity: 'warning', advisorRules: [],
    aspects: { ...baseline.aspects,
      structural: { enabled: true, engine: 'records', severity: cap },
      profile: { enabled: true, engine: 'records', severity: 'inherit' },
      terminology: { ...baseline.aspects.terminology, enabled: false },
      reference: { ...baseline.aspects.reference, enabled: false },
      invariant: { ...baseline.aspects.invariant, enabled: false },
      custom_rule: { ...baseline.aspects.custom_rule, enabled: false },
      metadata: { ...baseline.aspects.metadata, enabled: false },
    },
  };
}

interface Observation {
  phase: 'single' | 'batch'; selected: StructureDefinition; selectedBefore: string;
  selectedAfterExecutor: string; selectedAfterPublication?: string;
  profileUrl: string; strictMode: boolean; issues: ValidationIssue[];
  returnedBytes: string; afterPublicationBytes?: string;
}

function failures(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter(issue => issue.code === 'dom-6' && issue.ruleId === 'dom-6');
}

describe('real public dom-6 owner beside present Narrative with no div', () => {
  for (const mode of modes) {
    it.each([false, true])(`observes active=%s with strict=${mode.strict} and structural cap=${mode.cap}`, async active => {
      const cache = await mkdtemp(join(tmpdir(), 'records-dom6-public-owner-'));
      const validator = new RecordsValidator({ packageCachePath: cache, bundledProfilesPath: null,
        terminologyPackageDirectories: [], prewarmProfileSource: false, autoDownload: false,
        enableCaching: false, strictMode: mode.strict, timeout: 30_000 });
      const selected = definition();
      const selectedBytes = JSON.stringify(selected);
      const resource = { resourceType: 'Patient', id: 'controlled-active', active, text: { status: 'generated' } };
      const resourceBytes = JSON.stringify(resource);
      const observations: Observation[] = [];
      let phase: Observation['phase'] = 'single';
      const original = ProfileExecutor.prototype.validate;
      const spy = vi.spyOn(ProfileExecutor.prototype, 'validate').mockImplementation(async function (this: ProfileExecutor, context) {
        const selectedBefore = JSON.stringify(context.structureDef);
        const issues = await original.call(this, context);
        observations.push({ phase, selected: context.structureDef, selectedBefore,
          selectedAfterExecutor: JSON.stringify(context.structureDef), profileUrl: context.profileUrl,
          strictMode: context.strictMode, issues, returnedBytes: JSON.stringify(issues) });
        return issues;
      });
      const finishObservation = () => {
        for (const row of observations.filter(row => row.phase === phase)) {
          row.afterPublicationBytes = JSON.stringify(row.issues);
          row.selectedAfterPublication = JSON.stringify(row.selected);
        }
      };
      try {
        await validator.waitForInitialization();
        expect(validator.getSdLoader().registerExternalProfile(selected, 'R4')).toBe(true);
        const effective = settings(mode.strict, mode.cap);
        const single = await validator.validate(resource, profileUrl, 'R4', effective);
        finishObservation();
        phase = 'batch';
        const results = await validator.validateBatch([resource], { fhirVersion: 'R4', profileUrl,
          aspects: ['structural', 'profile'], settings: effective, maxConcurrency: 1 });
        finishObservation();
        const batch = results.get(resource);
        if (!batch || Array.isArray(batch)) throw new Error('Expected actual public multi-aspect result');
        const publishedBatch = batch.aspects.flatMap(aspect => aspect.issues);
        const evidence = batch.aspects.flatMap(aspect => aspect.evidenceIssues ?? []);
        console.info('DOM6_PUBLIC_OWNER_OBSERVATION', JSON.stringify({ mode, resource, selected,
          observations, single, batch }));

        expect.soft(observations.map(row => row.phase), 'actual producer call phases').toEqual(['single', 'batch']);
        for (const row of observations) {
          expect.soft(row.selectedBefore, 'selected SD before executor').toBe(selectedBytes);
          expect.soft(row.selectedAfterExecutor, 'selected SD after executor').toBe(selectedBytes);
          expect.soft(row.selectedAfterPublication, 'selected SD after publication').toBe(selectedBytes);
          expect.soft(row.profileUrl, 'actual context profile URL').toBe(profileUrl);
          expect.soft(row.strictMode, 'actual context strict mode').toBe(mode.strict);
          expect.soft(row.afterPublicationBytes, 'actual returned array unchanged').toBe(row.returnedBytes);
          const produced = failures(row.issues);
          expect.soft(produced, 'real raw constraint occurrence').toHaveLength(active ? 0 : 1);
          if (!active) expect.soft(produced[0], 'raw severity independent of cap').toMatchObject({
            severity: 'error', aspect: 'structural', profile: profileUrl,
            details: { expression: 'active = true', originalSeverity: 'error', escalated: false },
          });
        }
        expect.soft(batch.structureDef, 'batch selected SD body').toEqual(selected);
        expect.soft(JSON.stringify(resource), 'synthetic input unchanged').toBe(resourceBytes);
        for (const issues of [single, publishedBatch]) {
          expect.soft(issues.some(issue => ['profile-not-found', 'profile-not-resolved', 'internal-error',
            'profile-constraint-evaluation-error', 'validation-error'].includes(issue.code ?? '')), 'no selection/evaluation substitution').toBe(false);
          expect.soft(issues.filter(issue => issue.code === 'narrative-missing-div'), 'independent missing-div occurrence').toHaveLength(1);
          expect.soft(failures(issues), 'independent dom-6 publication occurrence').toHaveLength(active ? 0 : 1);
        }
        if (!active) {
          const rawSingle = failures(observations.find(row => row.phase === 'single')?.issues ?? [])[0];
          const rawBatch = failures(observations.find(row => row.phase === 'batch')?.issues ?? [])[0];
          expect.soft(failures(single)[0], 'single harderror publication').toMatchObject({ severity: 'error', aspect: 'structural' });
          expect.soft(failures(publishedBatch)[0], 'batch configured publication severity').toMatchObject({
            severity: mode.cap === 'info' ? 'info' : 'error', aspect: 'structural', rawSeverity: 'error',
          });
          expect.soft(failures(evidence)[0], 'evidence retains actual hard raw cause').toMatchObject({
            rawSeverity: 'error', details: { expression: 'active = true', originalSeverity: 'error', escalated: false },
          });
          expect.soft(failures(single)[0]?.id, 'single actual issue identity').toBe(rawSingle?.id);
          expect.soft(failures(publishedBatch)[0]?.id, 'batch actual issue identity').toBe(rawBatch?.id);
          expect.soft(failures(single)[0]?.details, 'single actual details preserved').toEqual(rawSingle?.details);
        } else {
          expect.soft(failures(evidence), 'passing expression creates no canonical evidence').toHaveLength(0);
        }
        expect.soft(batch.isValid, 'uncapped failures invalid; configured info cap advisory').toBe(mode.cap === 'info');
      } finally {
        spy.mockRestore();
        await rm(cache, { recursive: true, force: true });
      }
    }, 120_000);
  }
});
