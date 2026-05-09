/**
 * Regression coverage for semantic parity between single-resource validate()
 * and the multi-aspect validateBatch() execution path.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RecordsValidator } from '../validator-engine';
import type { ValidationIssue } from '../../types';

type MultiAspectResult = {
  isValid: boolean;
  aspects: Array<{
    aspect: string;
    issues: ValidationIssue[];
  }>;
};

const PROFILE_URL = 'http://hl7.org/fhir/StructureDefinition/Observation';

const OBSERVATION_OBS6_VIOLATION = {
  resourceType: 'Observation',
  id: 'obs-parity',
  status: 'final',
  code: {
    coding: [{
      system: 'http://loinc.org',
      code: '1234-5',
    }],
  },
  subject: {
    reference: 'Patient/p1',
  },
  valueString: 'abc',
  dataAbsentReason: {
    coding: [{
      system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason',
      code: 'unknown',
    }],
  },
};

function issueKey(issue: ValidationIssue): string {
  return [
    issue.aspect ?? '',
    issue.severity ?? '',
    issue.code ?? '',
    issue.path ?? '',
    issue.message ?? '',
  ].join('|');
}

function normalizeIssues(issues: ValidationIssue[]): string[] {
  return issues.map(issueKey).sort();
}

function flattenMultiAspectIssues(result: MultiAspectResult): ValidationIssue[] {
  return result.aspects.flatMap(aspect => aspect.issues);
}

describe('single validate vs multi-aspect validateBatch parity', () => {
  let validator: RecordsValidator;

  beforeAll(async () => {
    validator = new RecordsValidator({
      enableCaching: true,
      strictMode: false,
      timeout: 30000,
      autoDownload: false,
    });
    validator.configureTerminologyResolution({
      strategy: 'local-only',
      serverUrl: undefined,
      serverDelegation: {
        expandValueSets: false,
        validateCodes: false,
        cacheResults: true,
        cacheTTLSeconds: 3600,
      },
    });
    await validator.waitForInitialization();
  }, 120_000);

  it('reports the same semantic issues for an Observation invariant violation', async () => {
    const singleIssues = await validator.validate(
      OBSERVATION_OBS6_VIOLATION,
      PROFILE_URL,
      'R4',
      { validationStrictness: 'standard', aspects: {} },
    );

    const batchResults = await validator.validateBatch([OBSERVATION_OBS6_VIOLATION], {
      fhirVersion: 'R4',
      profileUrl: PROFILE_URL,
      maxConcurrency: 1,
      aspects: [
        'structural',
        'profile',
        'terminology',
        'reference',
        'invariant',
        'customRule',
        'metadata',
      ],
      settings: { validationStrictness: 'standard', aspects: {} },
    });

    const multiResult = batchResults.get(OBSERVATION_OBS6_VIOLATION) as MultiAspectResult;
    expect(multiResult).toBeDefined();

    const multiIssues = flattenMultiAspectIssues(multiResult);
    expect(normalizeIssues(multiIssues)).toEqual(normalizeIssues(singleIssues));
    expect(
      multiIssues.filter(issue => issue.code === 'obs-6-violation'),
    ).toHaveLength(1);
  }, 120_000);
});
