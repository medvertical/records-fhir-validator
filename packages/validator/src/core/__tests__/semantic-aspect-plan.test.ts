import { describe, expect, it } from 'vitest';
import { projectSemanticAspectResult, resolveSemanticAspectPlan } from '../semantic-aspect-plan';
import type { AspectResult } from '../multi-aspect-types';
import type { ValidationIssue } from '@records-fhir/validation-types';

const bucket = (aspect: string, issues: ValidationIssue[] = []): AspectResult => ({
  aspect, issues, evidenceIssues: issues, validationTime: 0,
  isValid: !issues.some(issue => issue.severity === 'error'),
});

describe('semantic aspect execution and projection', () => {
  it.each(['structural', 'profile', 'terminology', 'reference', 'invariant'])('%s includes cross-producing executors', aspect => {
    expect(resolveSemanticAspectPlan([aspect]).executors).toEqual(new Set([aspect, 'structural', 'profile', 'invariant']));
  });

  it('does not publish ordinary foreign findings or invalidate the requested bucket with them', () => {
    const result = projectSemanticAspectResult({ isValid: false, aspects: [bucket('structural'),
      bucket('profile', [{ aspect: 'profile', severity: 'error', code: 'profile-constraint-violation', message: 'Constraint' }])],
    }, resolveSemanticAspectPlan(['structural']));
    expect(result).toMatchObject({ isValid: true, aspects: [{ aspect: 'structural', issues: [] }] });
  });

  it.each(['internal-error', 'validation-error', 'profile-not-found', 'profile-not-resolved', 'structural-resource-type-mismatch'])(
  'rejects incomplete dependency %s, even when advisor suppressed it', code => {
    const dependency = bucket('profile');
    dependency.evidenceIssues = [{ aspect: 'profile', code, severity: 'warning', disposition: 'suppressed', message: 'Unavailable' }];
    expect(() => projectSemanticAspectResult({ isValid: true, aspects: [bucket('structural'), dependency] },
      resolveSemanticAspectPlan(['structural']))).toThrow('dependency could not be completed');
  });

  it('honors explicit incomplete evidence independently of its issue code', () => {
    expect(() => projectSemanticAspectResult({ isValid: true, aspects: [bucket('structural'), bucket('profile', [
      { message: 'Incomplete', severity: 'information', details: { validationComplete: false } },
    ])] }, resolveSemanticAspectPlan(['structural']))).toThrow('dependency could not be completed');
  });

  it.each(['structural', 'profile', 'reference', 'terminology', 'invariant'])('keeps %s explicitly incomplete with a usable base definition', aspect => {
    const dependency = { ...bucket('profile'), isValid: false };
    dependency.evidenceIssues = [{ aspect: 'profile', code: 'profile-not-resolved', severity: 'warning',
      disposition: 'suppressed', message: 'Missing requested profile', details: { validationComplete: false } }];
    const result = projectSemanticAspectResult({ isValid: false,
      structureDef: { resourceType: 'StructureDefinition' },
      aspects: aspect === 'profile' ? [dependency] : [bucket(aspect), dependency],
    }, resolveSemanticAspectPlan([aspect]));
    expect(result).toMatchObject({ isValid: false, aspects: [{ aspect, isValid: false, issues: [] }] });
  });

  it('ignores an unrelated unresolved profile for metadata-only execution', () => {
    const result = projectSemanticAspectResult({ isValid: false, aspects: [bucket('metadata'),
      { ...bucket('profile', [{ aspect: 'profile', code: 'profile-not-resolved', severity: 'warning', message: 'Missing' }]), isValid: false }],
    }, resolveSemanticAspectPlan(['metadata']));
    expect(result).toMatchObject({ isValid: true, aspects: [{ aspect: 'metadata', isValid: true }] });
  });

  it('rejects a missing requested bucket instead of inferring a clean result', () => {
    expect(() => projectSemanticAspectResult({ isValid: true, aspects: [bucket('structural')] },
      resolveSemanticAspectPlan(['profile']))).toThrow('aspect could not be completed');
  });
});
