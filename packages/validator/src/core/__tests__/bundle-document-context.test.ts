import { describe, expect, it } from 'vitest';
import { buildBundleDocumentContextIssues } from '../bundle-document-context';
import type { StructureDefinition } from '../structure-definition-types';
import type { ValidationIssue } from '@records-fhir/validation-types';

const terminologyBindingIssue: ValidationIssue = {
  aspect: 'terminology',
  severity: 'error',
  code: 'terminology-binding-required',
  message: 'Required binding failed',
  path: 'Condition.code',
  expression: 'Condition.code',
};

describe('buildBundleDocumentContextIssues', () => {
  it.each(['terminology-binding-required', 'terminology-binding-required-code'])(
    'propagates %s to a constrained Composition section target', code => {
      const condition = { resourceType: 'Condition', id: 'condition-1',
        meta: { profile: ['http://example.org/StructureDefinition/condition'] } };
      const composition = { resourceType: 'Composition', id: 'composition-1',
        section: [{ entry: [{ reference: 'urn:uuid:condition-1' }] }] };
      const bundle = { resourceType: 'Bundle', type: 'document', entry: [
        { fullUrl: 'urn:uuid:composition-1', resource: composition },
        { fullUrl: 'urn:uuid:condition-1', resource: condition },
      ] };
      const issues = buildBundleDocumentContextIssues(bundle, [
        { index: 0, resourceType: 'Composition', entryResource: composition, issues: [] },
        { index: 1, resourceType: 'Condition', entryResource: condition,
          issues: [{ ...terminologyBindingIssue, code }] },
      ]);
      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'error', ruleId: 'profile-targetprofile-match-failed',
        details: expect.objectContaining({ causeIssueCodes: [code] }),
      }));
    },
  );

  it('turns an unresolved profile required by a Bundle entry slice into a parent conformance error', () => {
    const requiredProfile = 'http://example.org/StructureDefinition/required-condition';
    const bundleProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/condition-bundle',
      type: 'Bundle',
      snapshot: {
        element: [
          {
            id: 'Bundle.entry:condition',
            path: 'Bundle.entry',
            sliceName: 'condition',
            min: 1,
            max: '*',
          },
          {
            id: 'Bundle.entry:condition.resource',
            path: 'Bundle.entry.resource',
            min: 1,
            max: '1',
            type: [{ code: 'Condition', profile: [requiredProfile] }],
          } as any,
        ],
      },
    } as StructureDefinition;
    const condition = { resourceType: 'Condition', id: 'condition-1' };
    const bundle = {
      resourceType: 'Bundle',
      meta: { profile: [bundleProfile.url] },
      entry: [{ resource: condition }],
    };
    const unresolvedProfileIssue: ValidationIssue = {
      aspect: 'profile',
      severity: 'warning',
      code: 'profile-not-resolved',
      message: 'Profile unavailable',
      path: 'Condition.meta.profile',
      profile: requiredProfile,
    };

    const issues = buildBundleDocumentContextIssues(bundle, [{
      index: 0,
      entryResource: condition,
      resourceType: 'Condition',
      issues: [unresolvedProfileIssue],
    }], bundleProfile);

    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'profile-not-found',
      ruleId: 'bundle-entry-required-profile-not-resolved',
      path: 'Bundle.entry[0].resource/*Condition/condition-1*/',
      details: expect.objectContaining({ requiredProfile }),
    }));
  });

  it('does not treat targetProfile Resource as a failed child conformance match', () => {
    const compositionProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/test-composition',
      type: 'Composition',
      snapshot: {
        element: [
          {
            id: 'Composition.section.entry',
            path: 'Composition.section.entry',
            type: [{
              code: 'Reference',
              targetProfile: ['http://hl7.org/fhir/StructureDefinition/Resource|4.0.1'],
            }],
          },
        ],
      },
    } as StructureDefinition;
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'urn:uuid:composition',
          resource: {
            resourceType: 'Composition',
            id: 'composition',
            section: [{ entry: [{ reference: 'urn:uuid:condition' }] }],
          },
        },
        {
          fullUrl: 'urn:uuid:condition',
          resource: {
            resourceType: 'Condition',
            id: 'condition',
          },
        },
      ],
    };

    const issues = buildBundleDocumentContextIssues(bundle, [
      {
        index: 0,
        entryResource: bundle.entry[0].resource,
        resourceType: 'Composition',
        issues: [],
        structureDef: compositionProfile,
      },
      {
        index: 1,
        entryResource: bundle.entry[1].resource,
        resourceType: 'Condition',
        issues: [terminologyBindingIssue],
      },
    ]);

    expect(issues).toHaveLength(0);
  });

  it('does not emit composition slice source issues from the base Resource definition', () => {
    const bundleStructureDef: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://hl7.org/fhir/StructureDefinition/Bundle',
      type: 'Bundle',
      baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Resource',
    } as StructureDefinition;
    const compositionProfile: StructureDefinition = {
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/test-composition',
      type: 'Composition',
      snapshot: {
        element: [
          {
            id: 'Composition.section.entry',
            path: 'Composition.section.entry',
            type: [{
              code: 'Reference',
              targetProfile: ['http://example.org/StructureDefinition/problem-condition'],
            }],
          },
        ],
      },
    } as StructureDefinition;
    const bundle = {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: 'urn:uuid:composition',
          resource: {
            resourceType: 'Composition',
            id: 'composition',
            section: [{ entry: [{ reference: 'urn:uuid:condition' }] }],
          },
        },
        {
          fullUrl: 'urn:uuid:condition',
          resource: {
            resourceType: 'Condition',
            id: 'condition',
          },
        },
      ],
    };

    const issues = buildBundleDocumentContextIssues(bundle, [
      {
        index: 0,
        entryResource: bundle.entry[0].resource,
        resourceType: 'Composition',
        issues: [],
        structureDef: compositionProfile,
      },
      {
        index: 1,
        entryResource: bundle.entry[1].resource,
        resourceType: 'Condition',
        issues: [terminologyBindingIssue],
      },
    ], bundleStructureDef);

    expect(issues.filter(issue =>
      issue.ruleId === 'slice-min-composition-conformance' &&
      (issue.details as Record<string, unknown>)?.sourceProfile === 'http://hl7.org/fhir/StructureDefinition/Resource'
    )).toHaveLength(0);
  });
});
