import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types';
import { findInlinedResourceConstraints } from '../inlined-resource-constraints';

const rule = { key: 'root-context', severity: 'error' as const, human: 'Owner context', expression: "%resource.type().name = 'Invoice'" };
const profile: StructureDefinition = {
  resourceType: 'StructureDefinition', url: 'https://example.test/parent', name: 'Parent',
  status: 'active', kind: 'resource', abstract: false, type: 'Bundle',
  snapshot: { element: [{ id: 'Bundle.entry.resource', path: 'Bundle.entry.resource',
    type: [{ code: 'Resource', profile: ['https://example.test/invoice|1.0'] }], constraint: [rule] }] },
};
const invoice: StructureDefinition = { ...profile, type: 'Invoice', snapshot: {
  element: [{ path: 'Invoice', constraint: [{ ...rule, source: 'https://example.test/unreliable-source' }] }],
} };
const resource = { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Invoice' } }] };

describe('inlined resource root constraints', () => {
  it('requires matching root-rule content from the declared type profile', async () => {
    const requested: string[] = [];
    expect(await findInlinedResourceConstraints(resource, profile, async url => {
      requested.push(url); return invoice;
    })).toEqual(new Set([rule]));
    expect(requested).toEqual(['https://example.test/invoice|1.0']);
  });

  it('keeps explicitly declared parent rules in their parent context', async () => {
    const declared = { ...profile, differential: profile.snapshot };
    expect(await findInlinedResourceConstraints(resource, declared, async () => invoice)).toEqual(new Set());
  });

  it('does not infer a root owner from a missing profile or an unrelated rule', async () => {
    expect(await findInlinedResourceConstraints(resource, profile)).toEqual(new Set());
    expect(await findInlinedResourceConstraints(resource, profile, async () => null)).toEqual(new Set());
    expect(await findInlinedResourceConstraints(resource, profile, async () => ({
      ...invoice, snapshot: { element: [{ path: 'Invoice', constraint: [{ ...rule, expression: 'true' }] }] },
    }))).toEqual(new Set());
  });
});
