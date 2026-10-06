import { describe, expect, it } from 'vitest';
import { profileCanonicalAliasIssue } from '../profile-canonical-alias';
import type { StructureDefinition } from '../structure-definition-types';

const usCoreCoverage = {
  resourceType: 'StructureDefinition',
  url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-coverage',
  name: 'USCoreCoverageProfile',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Coverage',
} as StructureDefinition;

describe('profileCanonicalAliasIssue', () => {
  it('warns at the declaring meta.profile entry when only an alias resolved the profile', () => {
    const misspelt = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-Coverage';
    const resource = {
      resourceType: 'Coverage',
      meta: { profile: ['http://hl7.org/fhir/us/carin-bb/StructureDefinition/C4BB-Coverage|2.0.0', misspelt] },
    };

    expect(profileCanonicalAliasIssue(resource, 'Coverage', misspelt, usCoreCoverage)).toEqual(expect.objectContaining({
      code: 'profile-canonical-alias',
      severity: 'warning',
      path: 'Coverage.meta.profile[1]',
      message: `Profile reference '${misspelt}' does not match a published canonical; validated against ${usCoreCoverage.url}`,
    }));
  });

  it('stays quiet for the published canonical and for profiles resolved by other means', () => {
    const resource = { resourceType: 'Coverage', meta: { profile: [usCoreCoverage.url] } };

    expect(profileCanonicalAliasIssue(resource, 'Coverage', usCoreCoverage.url, usCoreCoverage)).toBeNull();
    expect(profileCanonicalAliasIssue(resource, 'Coverage', `${usCoreCoverage.url}|7.0.0`, usCoreCoverage)).toBeNull();
    expect(profileCanonicalAliasIssue(
      resource, 'Coverage', 'http://example.org/fhir/StructureDefinition/local-coverage', usCoreCoverage,
    )).toBeNull();
  });
});
