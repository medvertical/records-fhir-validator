import { describe, expect, it } from 'vitest';
import { buildBundleDocumentContextIssues } from '../bundle-document-context';
import type { StructureDefinition } from '../structure-definition-types';
import type { ValidationIssue } from '../../types';

const terminologyBindingIssue: ValidationIssue = {
  aspect: 'terminology',
  severity: 'error',
  code: 'terminology-binding-required',
  message: 'Required binding failed',
  path: 'Condition.code',
  expression: 'Condition.code',
};

describe('buildBundleDocumentContextIssues', () => {
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
