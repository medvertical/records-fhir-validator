import { describe, expect, it } from 'vitest';
import type { ValidationSettings } from '@records-fhir/validation-types';
import { createAspectIssueAttribution } from '../multi-aspect-profile-attribution';
import { MultiAspectSessionPolicy } from '../multi-aspect-session-policy';
import type { MultiAspectResourceContext } from '../multi-aspect-resource-preparation';
import type { AspectResult } from '../multi-aspect-types';

const profileUrl = 'http://hl7.org/fhir/StructureDefinition/bp';
const settings = { validationStrictness: 'standard', aspects: {
  structural: { severity: 'information' }, profile: { severity: 'warning' },
}, advisorRules: [{ id: 'profile-policy', enabled: true, action: 'suppress', match: { aspect: 'profile' } }] } as ValidationSettings;

it.each(['declared', 'inferred', 'host-inferred'])('governs %s attribution once, after semantic ownership is known', async selection => {
  const context = { resource: { resourceType: 'Observation',
    code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
    ...(selection !== 'inferred' ? { meta: { profile: [profileUrl] } } : {}),
  }, profileUrl, structureDef: { snapshot: { element: [{ path: 'Observation.category', min: 1,
    base: { min: 0 } }] } } } as unknown as MultiAspectResourceContext;
  const policy = new MultiAspectSessionPolicy(settings);
  const collectedAspects: AspectResult[] = [];
  const run = policy.createRunner({ collectedAspects, profileUrl, fhirVersion: 'R4',
    attributeIssues: createAspectIssueAttribution(context, null,
      selection === 'host-inferred' ? 'code-inferred' : undefined), throwIfStopped() {} });
  await run('structural', async () => [{ aspect: 'structural', code: 'structural-cardinality-min',
    severity: 'error', message: 'Category missing', path: 'Observation.category' }]);
  await run('profile', async () => []);
  const profile = policy.buildResult(collectedAspects, context.structureDef, null).aspects.find(aspect => aspect.aspect === 'profile')!;
  expect(profile.issues).toEqual([]);
  expect(profile.evidenceIssues).toContainEqual(expect.objectContaining({ aspect: 'profile',
    severity: 'warning', rawSeverity: 'error', disposition: 'suppressed',
    advisoryApplications: [expect.objectContaining({ ruleId: 'profile-policy' })] }));
  if (selection !== 'declared') expect(profile.evidenceIssues).toContainEqual(expect.objectContaining({
    code: 'profile-code-inferred-signpost', disposition: 'suppressed',
    advisoryApplications: [expect.objectContaining({ ruleId: 'profile-policy' })],
  }));
});

describe('supplemental bundle issue policy', () => {
  it('preserves suppressed evidence with the declared semantic cap', () => {
    const result = new MultiAspectSessionPolicy(settings).applyProfileIssuePolicies([
      { aspect: 'structural', severity: 'error', message: 'Base constraint' },
      { aspect: 'profile', severity: 'error', message: 'Profile constraint' },
    ]);
    expect(result.resultIssues).toHaveLength(1);
    expect(result.resultIssues[0]).toMatchObject({ aspect: 'structural', severity: 'information' });
    expect(result.evidenceIssues[1]).toMatchObject({ aspect: 'profile', rawSeverity: 'error',
      severity: 'warning', disposition: 'suppressed', advisoryApplications: [expect.objectContaining({ ruleId: 'profile-policy' })] });
  });
});
