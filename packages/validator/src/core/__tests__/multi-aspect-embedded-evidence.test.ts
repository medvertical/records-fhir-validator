import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { buildMultiAspectValidateCallback } from '../multi-aspect-validate-callback';
import type { MultiAspectDeps } from '../multi-aspect-dependencies';
import { createExecutorFailureIssue } from '../executors/executor-failure-issue';

vi.mock('../profile-loader-utils', () => ({
  loadProfileOrBase: vi.fn(async (_loader, _generator, profileUrl: string, resourceType: string) => ({
    structureDef: { resourceType: 'StructureDefinition', type: resourceType, url: profileUrl,
      snapshot: { element: [] } },
    declaredProfileUrl: profileUrl, usedBaseFallback: false,
  })),
  createProfileFallbackIssue: vi.fn(),
  createProfileResourceTypeMismatchIssue: vi.fn(),
}));

const child = { resourceType: 'Patient', id: 'child',
  meta: { profile: ['https://example.test/Patient'] } };
const childIssue: ValidationIssue = {
  aspect: 'structural', severity: 'error', code: 'structural-cardinality-min',
  message: 'Missing name', path: 'Patient.name', expression: 'Patient.name', resourceType: 'Patient',
};
const embeddedCases = [
  { kind: 'contained', resource: { resourceType: 'Observation', contained: [child] }, prefix: 'Observation.contained[0]' },
  { kind: 'parameters', resource: { resourceType: 'Parameters', parameter: [{ name: 'patient', resource: child }] },
    prefix: 'Parameters.parameter[0].resource' },
  { kind: 'bundle', resource: { resourceType: 'Bundle', type: 'collection', entry: [{ resource: child }] },
    prefix: 'Bundle.entry[0].resource' },
];

function dependencies(failProfile = false): MultiAspectDeps {
  const empty = { validate: async () => [] };
  return {
    sdLoader: {}, snapshotGenerator: {}, strictMode: false,
    structuralExecutor: { validate: async (resource: { resourceType: string }) =>
      resource.resourceType === 'Patient' && !failProfile ? [{ ...childIssue }] : [] },
    profileExecutor: { validate: async (context: { resourceType: string }) =>
      context.resourceType === 'Patient' && failProfile ? [createExecutorFailureIssue('profile', 'Profile')] : [] },
    invariantExecutor: empty, terminologyExecutor: empty, referenceExecutor: empty,
    customRuleExecutor: empty, metadataExecutor: empty,
    bestPracticeValidator: { validate: () => [] }, terminologyResourceValidator: { validate: () => [] },
  } as unknown as MultiAspectDeps;
}

function settings(suppressed: boolean): ValidationSettings {
  return { validationStrictness: 'compatibility', aspects: {},
    advisorRules: suppressed ? [{ id: 'suppress-child', enabled: true, action: 'suppress',
      match: { code: childIssue.code } }] : [] } as unknown as ValidationSettings;
}

describe.each(embeddedCases)('$kind retains embedded governance evidence', ({ kind, resource, prefix }) => {
  it.each([false, true])('preserves raw severity and one policy application, suppressed=%s', async suppressed => {
    const validate = buildMultiAspectValidateCallback(dependencies(), ['structural'], settings(suppressed));
    const result = await validate(resource, `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`, 'R4');
    const structural = result.aspects.find(aspect => aspect.aspect === 'structural')!;
    expect(structural.issues).toHaveLength(suppressed ? 0 : 1);
    expect(structural.evidenceIssues).toHaveLength(1);
    const evidence = structural.evidenceIssues![0];
    expect(evidence).toMatchObject({ rawSeverity: 'error', severity: 'warning', rawMessage: childIssue.message,
      disposition: suppressed ? 'suppressed' : 'active', profile: 'https://example.test/Patient' });
    expect(evidence.path).toContain(prefix);
    expect(evidence.expression).toBe(kind === 'parameters' ? childIssue.expression : evidence.path);
    expect(evidence.advisoryApplications).toHaveLength(suppressed ? 1 : 0);
    if (!suppressed) expect(structural.issues[0].id).toBe(evidence.id);
    expect(result.isValid).toBe(true);
  });

  it('preserves a suppressed dependency failure until the outer completeness check', async () => {
    const validate = buildMultiAspectValidateCallback(dependencies(true), ['structural'], {
      ...settings(false), advisorRules: [{ id: 'hide-runtime-error', enabled: true, action: 'suppress',
        match: { code: 'validation-error' } }],
    });
    await expect(validate(resource, `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`, 'R4'))
      .rejects.toThrow('Required validation dependency could not be completed');
  });
});

describe('Bundle document-context governance evidence', () => {
  it.each([false, true])('retains context findings after one policy pass, suppressed=%s', async suppressed => {
    const validate = buildMultiAspectValidateCallback(dependencies(), ['structural', 'profile'], {
      validationStrictness: 'standard', aspects: { profile: { severity: 'warning' } },
      advisorRules: suppressed ? [{ id: 'suppress-context', enabled: true, action: 'suppress',
        match: { aspect: 'profile' } }] : [],
    });
    const result = await validate({
      resourceType: 'Bundle', type: 'document', entry: [
        { resource: { resourceType: 'Composition', id: 'composition',
          meta: { profile: ['https://example.test/Composition'] },
          section: [{ entry: [{ reference: 'Patient/child' }] }] } },
        { resource: child },
      ],
    }, 'http://hl7.org/fhir/StructureDefinition/Bundle', 'R4');
    const profile = result.aspects.find(aspect => aspect.aspect === 'profile')!;
    const evidence = profile.evidenceIssues?.find(issue => issue.ruleId === 'profile-targetprofile-match-failed');
    expect(evidence).toMatchObject({ severity: 'warning', rawSeverity: 'error',
      disposition: suppressed ? 'suppressed' : 'active' });
    expect(evidence?.advisoryApplications).toHaveLength(suppressed ? 1 : 0);
    expect(profile.issues.some(issue => issue.ruleId === 'profile-targetprofile-match-failed')).toBe(!suppressed);
  });
});
