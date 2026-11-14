import { describe, expect, it } from 'vitest';
import type { ElementDefinition, StructureDefinition } from '../../core/structure-definition-types';
import { findInlinedResourceConstraints } from '../inlined-resource-constraints';
import { ConstraintValidator } from '../constraint-validator';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor';
import type { FhirResource } from '../../core/fhir-resource';

const profileUrl = 'https://example.test/StructureDefinition/invoice-bundle';
const expression = 'lineItem.sequence.first() = 1 and lineItem.sequence.last() = lineItem.sequence.count() and lineItem.sequence.isDistinct() and lineItem.sequence.all($this <= %resource.lineItem.sequence.count())';
const invoiceProfileUrl = 'https://example.test/StructureDefinition/invoice';
const invoiceProfile: StructureDefinition = {
  resourceType: 'StructureDefinition', url: invoiceProfileUrl, name: 'Invoice', status: 'active',
  type: 'Invoice', kind: 'resource', abstract: false, snapshot: { element: [{
    id: 'Invoice', path: 'Invoice', constraint: [{
      key: 'line-item-seq', severity: 'error', human: 'Number line items consecutively from one', expression,
    }],
  }] },
};
const elements: ElementDefinition[] = [
  { id: 'Bundle', path: 'Bundle' },
  {
    id: 'Bundle.entry.resource', path: 'Bundle.entry.resource', type: [{ code: 'Resource', profile: [invoiceProfileUrl] }],
    constraint: [{ key: 'line-item-seq', severity: 'error', human: 'Number line items consecutively from one', expression }],
  },
];
const profile: StructureDefinition = {
  resourceType: 'StructureDefinition', url: profileUrl, name: 'InvoiceBundle', status: 'active',
  type: 'Bundle', kind: 'resource', abstract: false, snapshot: { element: elements },
};
const engines = [
  {
    name: 'ConstraintValidator',
    validate: async (resource: FhirResource, rootResource?: FhirResource) =>
      new ConstraintValidator().validate(resource, elements, profileUrl, {
        ...(rootResource ? { rootResource, focusResource: resource } : {}),
        inlinedResourceConstraints: await findInlinedResourceConstraints(resource, profile, async () => invoiceProfile),
      }),
  },
  {
    name: 'SDFHIRPathExecutor',
    validate: async (resource: FhirResource, rootResource?: FhirResource) => new SDFHIRPathExecutor().execute({
      inlinedResourceConstraints: await findInlinedResourceConstraints(resource, profile, async () => invoiceProfile),
      resource, resourceType: resource.resourceType, structureDef: profile, fhirVersion: 'R4',
      ...(rootResource ? { rootResource, focusResource: resource } : {}),
    }),
  },
];

for (const engine of engines) {
  describe(`${engine.name} embedded-resource %resource`, () => {
    it('uses the Invoice for a root constraint verified against its referenced type profile', async () => {
      const resource = {
        resourceType: 'Bundle', type: 'collection',
        entry: [{ resource: { resourceType: 'Invoice', status: 'issued', lineItem: [{ sequence: 1 }] } }],
      };

      expect(await engine.validate(resource)).toEqual([]);
    });

    it('descends into the Invoice when a type-profile check already binds the inner Bundle as %resource', async () => {
      const resource = {
        resourceType: 'Bundle', type: 'collection',
        entry: [{ resource: { resourceType: 'Invoice', lineItem: [{ sequence: 1 }] } }],
      };
      const outer = { resourceType: 'Bundle', type: 'collection', entry: [{ resource }] };

      expect(await engine.validate(resource, outer)).toEqual([]);
    });

    it.each([{ sequence: [2] }, { sequence: [1, 1] }, { sequence: [1, 3] }])('rejects broken sequencing $sequence even when another entry is valid', async ({ sequence }) => {
      const resource = {
        resourceType: 'Bundle', type: 'collection',
        entry: [
          { resource: { resourceType: 'Invoice', lineItem: [{ sequence: 1 }] } },
          { resource: { resourceType: 'Invoice', lineItem: sequence.map(sequence => ({ sequence })) } },
        ],
      };

      expect(await engine.validate(resource)).toEqual([expect.objectContaining({
        ruleId: 'line-item-seq', severity: 'error', path: 'Bundle.entry[1].resource',
      })]);
    });
  });
}
