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

const DOCUMENT_BUNDLE_WITH_INVALID_SECTION_TARGET = {
  resourceType: 'Bundle',
  id: 'bundle-target-profile-parity',
  type: 'document',
  meta: {
    profile: ['http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps'],
  },
  entry: [
    {
      fullUrl: 'urn:uuid:comp-1',
      resource: {
        resourceType: 'Composition',
        id: 'comp-1',
        meta: {
          profile: ['http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps'],
        },
        status: 'final',
        type: { text: 'Summary' },
        date: '2026-05-16T00:00:00Z',
        title: 'Summary',
        section: [
          {
            entry: [{ reference: 'urn:uuid:obs-1' }],
          },
        ],
      },
    },
    {
      fullUrl: 'urn:uuid:obs-1',
      resource: {
        resourceType: 'Observation',
        id: 'obs-1',
        meta: {
          profile: ['http://hl7.eu/fhir/base/StructureDefinition/medicalTestResult-eu-core'],
        },
        code: { text: 'Result without status' },
      },
    },
  ],
};

const DOCUMENT_BUNDLE_WITH_INVALID_COMPOSITION_ENTRY = {
  resourceType: 'Bundle',
  id: 'bundle-entry-slice-parity',
  type: 'document',
  meta: {
    profile: ['http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps'],
  },
  entry: [
    {
      fullUrl: 'urn:uuid:comp-1',
      resource: {
        resourceType: 'Composition',
        id: 'comp-1',
        meta: {
          profile: ['http://hl7.eu/fhir/eps/StructureDefinition/composition-eu-eps'],
        },
        type: { text: 'Summary' },
        date: '2026-05-16T00:00:00Z',
        title: 'Summary',
      },
    },
  ],
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
        'custom_rule',
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

  it('does not report document-context targetProfile failures for display-only child issues', async () => {
    const singleIssues = await validator.validate(
      DOCUMENT_BUNDLE_WITH_INVALID_SECTION_TARGET,
      'http://hl7.org/fhir/StructureDefinition/Bundle',
      'R4',
      { validationStrictness: 'standard', aspects: {} },
    );

    const batchResults = await validator.validateBatch([DOCUMENT_BUNDLE_WITH_INVALID_SECTION_TARGET], {
      fhirVersion: 'R4',
      profileUrl: 'http://hl7.org/fhir/StructureDefinition/Bundle',
      maxConcurrency: 1,
      aspects: ['structural', 'profile'],
      settings: { validationStrictness: 'standard', aspects: {} },
    });

    const multiResult = batchResults.get(DOCUMENT_BUNDLE_WITH_INVALID_SECTION_TARGET) as MultiAspectResult;
    expect(multiResult).toBeDefined();

    const multiIssues = flattenMultiAspectIssues(multiResult);
    expect(
      singleIssues.filter(issue => issue.ruleId === 'profile-targetprofile-match-failed'),
    ).toHaveLength(0);
    expect(
      multiIssues.filter(issue => issue.ruleId === 'profile-targetprofile-match-failed'),
    ).toHaveLength(0);
  }, 120_000);

  it('reports Bundle.entry slice conformance failures in both single and multi-aspect paths', async () => {
    const singleIssues = await validator.validate(
      DOCUMENT_BUNDLE_WITH_INVALID_COMPOSITION_ENTRY,
      'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
      'R4',
      { validationStrictness: 'standard', aspects: {} },
    );

    const batchResults = await validator.validateBatch([DOCUMENT_BUNDLE_WITH_INVALID_COMPOSITION_ENTRY], {
      fhirVersion: 'R4',
      profileUrl: 'http://hl7.eu/fhir/eps/StructureDefinition/bundle-eu-eps',
      maxConcurrency: 1,
      aspects: ['structural', 'profile'],
      settings: { validationStrictness: 'standard', aspects: {} },
    });

    const multiResult = batchResults.get(DOCUMENT_BUNDLE_WITH_INVALID_COMPOSITION_ENTRY) as MultiAspectResult;
    expect(multiResult).toBeDefined();

    const multiIssues = flattenMultiAspectIssues(multiResult);
    const expectedParentPath = 'Bundle.entry[0].resource/*Composition/comp-1*/';

    expect(singleIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'bundle-entry-slice-profile-match-failed',
        path: expectedParentPath,
      }),
    ]));
    expect(multiIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'bundle-entry-slice-profile-match-failed',
        path: expectedParentPath,
      }),
    ]));
  }, 120_000);
});
