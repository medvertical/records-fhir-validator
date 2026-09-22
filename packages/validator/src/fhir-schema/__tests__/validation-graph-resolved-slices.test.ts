import { describe, expect, it } from 'vitest';
import {
  matchResolvedSlice,
  usesTargetDependentDiscriminator,
} from '../validation-graph-resolved-slices';
import type { ValidationGraphNode } from '../validation-graph-types';

const PROFILE = 'http://example.org/StructureDefinition/Primaertumor';

function node(partial: Partial<ValidationGraphNode>): ValidationGraphNode {
  return {
    path: 'MedicationRequest.reasonReference',
    schemaPath: 'reasonReference',
    name: 'reasonReference',
    source: { schemaUrl: 'http://example.org/sd', schemaType: 'MedicationRequest' },
    ...partial,
  };
}

describe('usesTargetDependentDiscriminator', () => {
  it('recognises a profile discriminator and any resolve() traversal', () => {
    expect(usesTargetDependentDiscriminator(node({
      slicing: { discriminator: [{ type: 'profile', path: '$this' }] },
    }))).toBe(true);
    expect(usesTargetDependentDiscriminator(node({
      slicing: { discriminator: [{ type: 'value', path: 'resolve().code' }] },
    }))).toBe(true);
  });

  it('ignores discriminators the element itself answers', () => {
    expect(usesTargetDependentDiscriminator(node({
      slicing: { discriminator: [{ type: 'value', path: 'reference' }] },
    }))).toBe(false);
    expect(usesTargetDependentDiscriminator(node({}))).toBe(false);
  });
});

describe('matchResolvedSlice', () => {
  const slice = node({ sliceName: 'Primaertumor', min: 1, max: '1', refers: [PROFILE] });

  it('reports unresolved rather than no-match when no resolver is available', () => {
    expect(matchResolvedSlice({ reference: 'Condition/x' }, slice, undefined)).toBe('unresolved');
  });

  it('reports unresolved when the target cannot be reached', () => {
    expect(matchResolvedSlice({ reference: 'Condition/x' }, slice, () => null)).toBe('unresolved');
  });

  it('reports unresolved when the resolver throws', () => {
    expect(matchResolvedSlice({ reference: 'Condition/x' }, slice, () => {
      throw new Error('boom');
    })).toBe('unresolved');
  });

  it('matches when the resolved target declares the required profile', () => {
    expect(matchResolvedSlice({ reference: 'Condition/x' }, slice, () => ({
      resourceType: 'Condition', meta: { profile: [PROFILE] },
    }))).toBe('match');
  });

  it('ignores a version suffix on the declared canonical', () => {
    expect(matchResolvedSlice({ reference: 'Condition/x' }, slice, () => ({
      resourceType: 'Condition', meta: { profile: [`${PROFILE}|2026.0.3`] },
    }))).toBe('match');
  });

  it('does not match a target declaring a different profile', () => {
    expect(matchResolvedSlice({ reference: 'Condition/x' }, slice, () => ({
      resourceType: 'Condition', meta: { profile: ['http://example.org/other'] },
    }))).toBe('no-match');
  });

  it('does not match a target that declares no profile at all', () => {
    expect(matchResolvedSlice({ reference: 'Condition/x' }, slice, () => ({
      resourceType: 'Condition',
    }))).toBe('no-match');
  });

  it('decides an inline resource without dereferencing', () => {
    expect(matchResolvedSlice({ resourceType: 'Condition', meta: { profile: [PROFILE] } }, slice, undefined))
      .toBe('match');
  });

  it('falls back to the allowed target types when the slice pins no profile', () => {
    const typeSlice = node({ sliceName: 'AnyCondition', refers: [], referenceTargetTypes: ['Condition'] });
    expect(matchResolvedSlice({ reference: 'Condition/x' }, typeSlice, () => ({ resourceType: 'Condition' })))
      .toBe('match');
    expect(matchResolvedSlice({ reference: 'Procedure/x' }, typeSlice, () => ({ resourceType: 'Procedure' })))
      .toBe('no-match');
  });

  it('treats a non-record value as no-match', () => {
    expect(matchResolvedSlice('Condition/x', slice, () => ({ resourceType: 'Condition' }))).toBe('no-match');
  });
});
