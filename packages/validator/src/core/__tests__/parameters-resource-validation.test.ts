import { describe, expect, it } from 'vitest';
import {
  collectParametersEmbeddedResources,
  rebaseParametersEmbeddedIssue,
  validateParametersResourceTree,
} from '../parameters-resource-validation';
import type { ValidationIssue } from '@records-fhir/validation-types';

const issueFixture = (overrides: Partial<ValidationIssue>): ValidationIssue => ({
  id: 'issue-1',
  aspect: 'structural',
  severity: 'warning',
  code: 'date-year-implausible',
  message: 'implausible year',
  path: 'Patient.birthDate',
  resourceType: 'Patient',
  ...overrides,
} as ValidationIssue);

describe('collectParametersEmbeddedResources', () => {
  it('collects parameter[].resource entries with their instance paths', () => {
    const parameters = {
      resourceType: 'Parameters',
      parameter: [
        { name: 'MemberPatient', resource: { resourceType: 'Patient', id: 'p1' } },
        { name: 'flag', valueBoolean: true },
        { name: 'OldCoverage', resource: { resourceType: 'Coverage', id: 'c1' } },
      ],
    };

    const collected = collectParametersEmbeddedResources(parameters);

    expect(collected.map(entry => entry.pathPrefix)).toEqual([
      'Parameters.parameter[0].resource',
      'Parameters.parameter[2].resource',
    ]);
    expect(collected[0].profileUrl).toBe('http://hl7.org/fhir/StructureDefinition/Patient');
  });

  it('collects resources nested inside parameter parts', () => {
    const parameters = {
      resourceType: 'Parameters',
      parameter: [{
        name: 'match',
        part: [
          { name: 'item', resource: { resourceType: 'Patient', id: 'nested' } },
        ],
      }],
    };

    const collected = collectParametersEmbeddedResources(parameters);

    expect(collected.map(entry => entry.pathPrefix)).toEqual([
      'Parameters.parameter[0].part[0].resource',
    ]);
  });

  it('returns nothing for non-Parameters resources', () => {
    expect(collectParametersEmbeddedResources({ resourceType: 'Patient' })).toEqual([]);
    expect(collectParametersEmbeddedResources(null)).toEqual([]);
  });
});

describe('rebaseParametersEmbeddedIssue', () => {
  it('rewrites the issue path under the parameter resource prefix', () => {
    const rebased = rebaseParametersEmbeddedIssue(
      issueFixture({ path: 'Patient.birthDate' }),
      'Parameters.parameter[0].resource',
      { resourceType: 'Patient', id: 'p1' },
    );

    expect(rebased.path).toBe('Parameters.parameter[0].resource.birthDate');
    expect(rebased.resourceType).toBe('Parameters');
    expect(rebased.details).toMatchObject({
      embeddedResourceType: 'Patient',
      embeddedResourceId: 'p1',
      originalPath: 'Patient.birthDate',
    });
  });

  it('maps a root-level path onto the prefix itself', () => {
    const rebased = rebaseParametersEmbeddedIssue(
      issueFixture({ path: 'Patient' }),
      'Parameters.parameter[1].resource',
      { resourceType: 'Patient' },
    );

    expect(rebased.path).toBe('Parameters.parameter[1].resource');
  });
});

describe('validateParametersResourceTree', () => {
  it('validates every embedded resource and drops metadata-aspect noise', async () => {
    const parameters = {
      resourceType: 'Parameters',
      parameter: [
        { name: 'MemberPatient', resource: { resourceType: 'Patient', birthDate: '2140-12-25' } },
      ],
    };

    const issues = await validateParametersResourceTree(parameters, {
      recursionDepth: 0,
      maxDepth: 3,
      validate: async () => [
        issueFixture({ path: 'Patient.birthDate' }),
        issueFixture({ aspect: 'metadata', code: 'missing-meta', path: 'meta' }),
      ],
    });

    expect(issues.map(issue => issue.code)).toEqual(['date-year-implausible']);
    expect(issues[0].path).toBe('Parameters.parameter[0].resource.birthDate');
  });

  it('stops recursing at the embedded-resource depth limit', async () => {
    const parameters = {
      resourceType: 'Parameters',
      parameter: [{ name: 'p', resource: { resourceType: 'Patient' } }],
    };

    const issues = await validateParametersResourceTree(parameters, {
      recursionDepth: 3,
      maxDepth: 3,
      validate: async () => [issueFixture({})],
    });

    expect(issues).toEqual([]);
  });
});
