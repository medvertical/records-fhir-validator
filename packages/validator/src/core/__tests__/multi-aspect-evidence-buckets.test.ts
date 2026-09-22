import { describe, expect, it } from 'vitest';
import { normalizeIssuesByAspect } from '../multi-aspect-issue-normalization';
import { MultiAspectSessionPolicy } from '../multi-aspect-session-policy';
import type { AspectResult } from '../multi-aspect-types';
import type { ValidationSettings } from '@records-fhir/validation-types';

const structuralIssue = { aspect: 'structural' as const, severity: 'error' as const,
  rawSeverity: 'error' as const, message: 'Constraint', code: 'ref-1-violation', path: 'Patient.reference' };

describe('multi-aspect semantic evidence ownership', () => {
  it('rebuckets suppressed raw evidence even when no visible finding survives', () => {
    const suppressed = { ...structuralIssue, disposition: 'suppressed' as const };
    const result = normalizeIssuesByAspect([{ aspect: 'profile', issues: [], evidenceIssues: [suppressed],
      validationTime: 1, isValid: true }]);
    expect(result.find(entry => entry.aspect === 'profile')?.evidenceIssues).toEqual([]);
    expect(result.find(entry => entry.aspect === 'structural')).toMatchObject({
      issues: [], evidenceIssues: [suppressed], isValid: true,
    });
  });

  it('caps a structural finding produced by profile with structural policy', async () => {
    const policy = new MultiAspectSessionPolicy({
      validationStrictness: 'standard', aspects: { structural: { severity: 'warning' }, profile: { severity: 'information' } },
      advisorRules: [{ id: 'suppress-ref', enabled: true, action: 'suppress', match: { code: 'ref-1-violation' } }],
    } as ValidationSettings);
    const collectedAspects: AspectResult[] = [];
    const run = policy.createRunner({ collectedAspects, fhirVersion: 'R4', profileUrl: 'http://example.test/Profile', throwIfStopped() {} });
    await run('profile', async () => [structuralIssue]);
    const result = normalizeIssuesByAspect(collectedAspects);
    expect(result.find(entry => entry.aspect === 'structural')?.evidenceIssues).toEqual([
      expect.objectContaining({ severity: 'warning', rawSeverity: 'error', disposition: 'suppressed',
        advisoryApplications: [expect.objectContaining({ ruleId: 'suppress-ref' })] }),
    ]);
  });
});
