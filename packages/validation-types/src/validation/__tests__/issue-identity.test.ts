import { describe, expect, it } from 'vitest';
import {
  computeValidationIssueId,
  normalizeCanonicalPath,
} from '../index';

describe('validation issue identity', () => {
  it('normalizes Bundle embedded-resource markers and array indexes out of canonical paths', () => {
    expect(normalizeCanonicalPath(
      'Bundle.entry[12].resource/*Composition/comp-1*/.section[7].entry[11]'
    )).toEqual({
      normalized: 'bundle.entry.resource.section.entry',
      truncated: false,
    });
  });

  it('normalizes FHIR choice placeholders for canonical identity', () => {
    expect(normalizeCanonicalPath('Observation.effective[x]')).toEqual({
      normalized: 'observation.effective',
      truncated: false,
    });
  });

  it('keeps issue ids stable across concrete array indexes and embedded resource ids', () => {
    const base = {
      aspect: 'profile',
      severity: 'error',
      code: 'profile-constraint-violation',
      resourceType: 'Bundle',
      message: 'Composition section entry is invalid',
      ruleId: 'cmp-1',
    };

    expect(computeValidationIssueId({
      ...base,
      path: 'Bundle.entry[0].resource/*Composition/comp-1*/.section[7].entry[11]',
    })).toBe(computeValidationIssueId({
      ...base,
      path: 'Bundle.entry[3].resource/*Composition/comp-9*/.section[2].entry[4]',
    }));
  });
});
