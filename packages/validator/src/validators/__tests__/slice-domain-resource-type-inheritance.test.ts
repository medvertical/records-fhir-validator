import { describe, expect, it } from 'vitest';
import { getFhirPathModel } from '../../core/fhirpath-context.js';
import { resolveFhirSegmentValue } from '../../core/fhir-primitive-sidecar.js';
import { matchTypeDiscriminator, typeCodeMatchesValue } from '../slice-type-discriminator.js';
import { inferType } from '../slice-value-type.js';
import type { SliceDefinition } from '../slice-types.js';

const domainSlice: SliceDefinition = {
  sliceName: 'admitted', path: 'Bundle.entry', min: 1, max: '*', type: [{ code: 'BackboneElement' }],
  childTypes: new Map([['resource', [{ code: 'DomainResource' }]]]),
};

// These model witnesses classify resource kinds; they do not attest a selected release/profile.
describe('DomainResource type discriminator inheritance', () => {
  it.each(['R4', 'R5'] as const)('admits concrete domain kinds corroborated by %s ancestry', family => {
    const parents = getFhirPathModel(family).type2Parent as Record<string, string | undefined>;
    for (const resourceType of ['Patient', 'CodeSystem', 'ValueSet']) {
      const ancestry: string[] = [];
      for (let parent = parents[resourceType]; parent; parent = parents[parent]) ancestry.push(parent);
      expect(ancestry).toContain('DomainResource');
      const value = { resourceType };
      expect(typeCodeMatchesValue('DomainResource', inferType(value), value)).toBe(true);
      expect(matchTypeDiscriminator({ resource: value }, domainSlice, 'resource')).toBe(true);
    }
  });

  it.each(['Bundle', 'Parameters', 'Binary', 'Resource', 'DomainResource', 'CanonicalResource', 'MetadataResource', 'UnknownSyntheticType', 'Identifier', 'Signature'])('does not attest %s as a concrete DomainResource', resourceType => {
    const value = { resourceType };
    expect(typeCodeMatchesValue('DomainResource', inferType(value), value)).toBe(false);
    expect(matchTypeDiscriminator({ resource: value }, domainSlice, 'resource')).toBe(false);
  });

  it.each([{}, { id: 'synthetic', extension: [{ url: 'http://example.test/ext', valueString: 'synthetic' }] }])('does not attest markerless element %j', value => {
    expect(typeCodeMatchesValue('DomainResource', inferType(value), value)).toBe(false);
  });

  it('retains explicit conflicting inference', () => {
    expect(typeCodeMatchesValue('DomainResource', 'Coding', { resourceType: 'Patient' })).toBe(false);
  });

  it('retains stronger choice evidence against a resource marker', () => {
    const value = resolveFhirSegmentValue({ valueCoding: { resourceType: 'Patient' } }, 'value[x]');
    expect(inferType(value)).toBe('Coding');
    expect(typeCodeMatchesValue('DomainResource', inferType(value), value)).toBe(false);
    expect(matchTypeDiscriminator({ resource: value }, domainSlice, 'resource')).toBe(false);
  });
});
