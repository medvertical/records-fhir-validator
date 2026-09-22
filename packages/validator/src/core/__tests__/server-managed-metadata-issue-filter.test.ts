import { describe, expect, it } from 'vitest';

import { shouldSuppressServerManagedMetadataIssue } from '../server-managed-metadata-issue-filter';
import type { ValidationIssue } from '@records-fhir/validation-types';

function issue(overrides: Partial<ValidationIssue>): ValidationIssue {
  return {
    aspect: 'structural',
    severity: 'error',
    code: 'structural-cardinality-max',
    message: 'too many values',
    path: 'Bundle.meta.versionId',
    ...overrides,
  };
}

describe('server-managed metadata issue filter', () => {
  it('suppresses root-resource meta.versionId and meta.lastUpdated cardinality max issues', () => {
    expect(shouldSuppressServerManagedMetadataIssue(issue({
      path: 'Bundle.meta.versionId',
    }))).toBe(true);
    expect(shouldSuppressServerManagedMetadataIssue(issue({
      path: 'Bundle.meta.lastUpdated',
    }))).toBe(true);
    expect(shouldSuppressServerManagedMetadataIssue(issue({
      path: 'Coverage.meta.versionId',
    }))).toBe(true);
    expect(shouldSuppressServerManagedMetadataIssue(issue({
      path: 'Coverage.meta.lastUpdated',
    }))).toBe(true);
    expect(shouldSuppressServerManagedMetadataIssue(issue({
      path: undefined,
      details: { fieldPath: 'Patient.meta.lastUpdated' },
    }))).toBe(true);
  });

  it('does not suppress other structural or metadata issues', () => {
    expect(shouldSuppressServerManagedMetadataIssue(issue({
      path: 'Bundle.meta.profile',
    }))).toBe(false);
    expect(shouldSuppressServerManagedMetadataIssue(issue({
      code: 'structural-cardinality-min',
    }))).toBe(false);
    expect(shouldSuppressServerManagedMetadataIssue(issue({
      aspect: 'metadata',
    }))).toBe(false);
    expect(shouldSuppressServerManagedMetadataIssue(issue({
      path: 'Coverage.meta.profile',
    }))).toBe(false);
    expect(shouldSuppressServerManagedMetadataIssue(issue({
      path: 'ResearchStudy.contained[1]/*Organization/hms*/.meta.versionId',
    }))).toBe(false);
  });
});
