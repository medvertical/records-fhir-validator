import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { BestPracticeValidator } from '../../validators/best-practice-validator.js';
import type { MultiAspectDeps } from '../multi-aspect-dependencies.js';
import { MultiAspectResourcePreparation } from '../multi-aspect-resource-preparation.js';
import { MultiAspectSessionPolicy } from '../multi-aspect-session-policy.js';
import { MultiAspectValidationSession } from '../multi-aspect-validation-session.js';
import type { AspectResult } from '../multi-aspect-types.js';
import { recordPatientNarrativeOrigins } from '../patient-narrative-issue-reconciliation.js';
import {
  canonicalNarrative, generatedNarrative, narrativeDetails, patientDefinition,
  patientWithoutNarrative, PATIENT_PROFILE,
} from './patient-narrative-fixtures.js';

const settings = { validationStrictness: 'standard', aspects: {} } as ValidationSettings;

/** Force the selected body independently of the requested release at the real session boundary. */
async function runSession(
  requested: 'R4' | 'R5' | 'R6', selectedVersion: unknown,
): Promise<{ narrative: ValidationIssue[]; raw: ValidationIssue[] }> {
  const definition = patientDefinition(selectedVersion === '4.0.1' ? 'R4' : 'R5');
  definition.fhirVersion = selectedVersion;
  const canonical = canonicalNarrative();
  const canonicalBefore = JSON.stringify(canonical);
  const preparation = vi.spyOn(MultiAspectResourcePreparation.prototype, 'prepare')
    .mockImplementation(async (resource, profileUrl, fhirVersion) => ({
      kind: 'ready' as const, profileFallbackIssue: null, profileSourceContext: { fhirVersion },
      context: {
        resource: resource as Record<string, unknown>, resourceType: 'Patient', profileUrl,
        fhirVersion, structureDef: definition, strictMode: false, settings,
      },
    }));
  const publication = vi.spyOn(MultiAspectSessionPolicy.prototype, 'buildResult');
  const structural = vi.fn().mockResolvedValue([]);
  const profile = vi.fn().mockResolvedValue([canonical]);
  try {
    const session = new MultiAspectValidationSession({
      aspects: ['structural', 'profile'], settings,
      deps: {
        strictMode: false, sdLoader: {}, snapshotGenerator: {},
        structuralExecutor: { validate: structural },
        profileExecutor: { validate: profile },
        invariantExecutor: { validate: vi.fn().mockResolvedValue([]) },
        terminologyExecutor: {}, bestPracticeValidator: new BestPracticeValidator(),
        sdFHIRPathExecutor: {},
      } as unknown as MultiAspectDeps,
    });
    const result = await session.validate(patientWithoutNarrative, PATIENT_PROFILE, requested);
    expect(preparation).toHaveBeenCalledWith(patientWithoutNarrative, PATIENT_PROFILE, requested, undefined, undefined);
    expect(publication).toHaveBeenCalledTimes(1);
    expect(publication).toHaveBeenCalledWith(expect.any(Array), definition, null, requested);
    expect(structural).toHaveBeenCalledTimes(1);
    expect(profile).toHaveBeenCalledTimes(1);
    expect(profile.mock.calls[0][0]).toMatchObject({ fhirVersion: requested, structureDef: definition });
    expect(JSON.stringify(canonical)).toBe(canonicalBefore);
    const issues = result.aspects.flatMap(aspect => aspect.issues);
    expect(issues.some(issue => ['internal-error', 'validation-error', 'profile-not-found'].includes(issue.code ?? ''))).toBe(false);
    return {
      narrative: issues.filter(issue => issue.code === 'dom-6'),
      raw: result.aspects.flatMap(aspect => aspect.evidenceIssues ?? []).filter(issue => issue.code === 'dom-6'),
    };
  } finally {
    preparation.mockRestore();
    publication.mockRestore();
  }
}

describe('requested release reaches the actual batch normalization owner', () => {
  it.each([['R4', '4.0.1'], ['R5', '5.0.0']] as const)(
    'keeps one canonical occurrence for compatible requested %s and selected %s', async (requested, version) => {
      const result = await runSession(requested, version);
      expect(result.narrative).toHaveLength(1);
      expect(result.narrative[0]).toMatchObject({ ruleId: 'dom-6', schemaVersion: requested });
      expect(result.raw).toHaveLength(2);
    },
  );

  it('retains both findings for actual R6 request normalized against an R5 fallback body', async () => {
    const result = await runSession('R6', '5.0.0');
    expect(result.narrative).toHaveLength(2);
    expect(result.narrative.every(issue => issue.schemaVersion === 'R6')).toBe(true);
    expect(result.narrative.filter(issue => issue.ruleId === 'dom-6')).toHaveLength(1);
    expect(result.narrative.filter(issue => narrativeDetails(issue).bestPractice === true)).toHaveLength(1);
    expect(result.raw).toHaveLength(2);
  });

  it.each([undefined, null, 4, '', 'R4', '4.bad', '5.bad', '7.0.0'])(
    'retains both through the actual caller for unknown/malformed selected version %s', async version => {
      for (const release of ['R4', 'R5'] as const) {
        const result = await runSession(release, version);
        expect(result.narrative).toHaveLength(2);
        expect(result.raw).toHaveLength(2);
      }
    },
  );

  it.each([['R4', '5.0.0'], ['R5', '4.0.1']] as const)(
    'retains both for requested %s with incompatible selected %s', async (release, version) => {
      expect((await runSession(release, version)).narrative).toHaveLength(2);
    },
  );

  it('does not borrow a selected R5 version when the policy boundary has no requested release', async () => {
    const policy = new MultiAspectSessionPolicy(settings);
    const collected: AspectResult[] = [];
    const run = policy.createRunner({
      collectedAspects: collected, fhirVersion: 'R5', profileUrl: PATIENT_PROFILE, throwIfStopped() {},
    });
    const canonical = canonicalNarrative();
    const generated = generatedNarrative();
    await run('profile', async () => recordPatientNarrativeOrigins([canonical], { canonical: [canonical] }));
    await run('structural', async () => recordPatientNarrativeOrigins([generated], { generated: [generated] }));
    const result = policy.buildResult(collected, patientDefinition('R5'), null, undefined);
    expect(result.aspects.flatMap(aspect => aspect.issues).filter(issue => issue.code === 'dom-6')).toHaveLength(2);
    expect(result.aspects.flatMap(aspect => aspect.evidenceIssues ?? []).filter(issue => issue.code === 'dom-6')).toHaveLength(2);
  });
});
