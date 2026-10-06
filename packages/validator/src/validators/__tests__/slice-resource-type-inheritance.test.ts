import { describe, expect, it } from 'vitest';
import { resolveFhirSegmentValue } from '../../core/fhir-primitive-sidecar.js';
import { matchTypeDiscriminator, typeCodeMatchesValue } from '../slice-type-discriminator.js';
import { inferType } from '../slice-value-type.js';
import type { SliceDefinition } from '../slice-types.js';

const resourceSlice: SliceDefinition = {
  sliceName: 'admitted', path: 'Bundle.entry', min: 1, max: '*', type: [{ code: 'BackboneElement' }],
  childTypes: new Map([['resource', [{ code: 'Resource' }]]]),
};
const elementOnly = { id: 'synthetic', extension: [{ url: 'http://example.test/ext', valueString: 'synthetic' }] };

describe('Resource type discriminator inheritance', () => {
  it.each(['Patient', 'Bundle', 'Parameters', 'Binary'])('admits concrete %s as Resource', resourceType => {
    const value = { resourceType };
    expect(typeCodeMatchesValue('Resource', inferType(value), value)).toBe(true);
    expect(matchTypeDiscriminator({ resource: value }, resourceSlice, 'resource')).toBe(true);
  });

  it.each(['Signature', 'Identifier', 'Resource', 'DomainResource', 'CanonicalResource', 'MetadataResource', 'UnknownSyntheticType', 'patient'])('does not certify marker %s as a concrete Resource', resourceType => {
    const value = { resourceType };
    expect(typeCodeMatchesValue('Resource', inferType(value), value)).toBe(false);
    expect(matchTypeDiscriminator({ resource: value }, resourceSlice, 'resource')).toBe(false);
  });

  it.each([null, 'Patient', [{ resourceType: 'Patient' }], { meta: { profile: ['http://hl7.org/fhir/StructureDefinition/Patient'] } }])('does not certify non-resource value %j', value => {
    expect(typeCodeMatchesValue('Resource', inferType(value), value)).toBe(false);
  });

  it.each(['Resource', 'DomainResource'])('does not admit id/extension-only elements as %s', expectedType => {
    expect(typeCodeMatchesValue(expectedType, inferType(elementOnly), elementOnly)).toBe(false);
  });

  it.each(['Identifier', 'Quantity'])('keeps extension-only datatype %s membership', expectedType => {
    expect(typeCodeMatchesValue(expectedType, inferType(elementOnly), elementOnly)).toBe(true);
  });

  it('retains stronger choice type evidence against a contradictory resource marker', () => {
    const value = resolveFhirSegmentValue({ valueCoding: { resourceType: 'Patient' } }, 'value[x]');
    expect(inferType(value)).toBe('Coding');
    expect(typeCodeMatchesValue('Resource', inferType(value), value)).toBe(false);
    expect(matchTypeDiscriminator({ resource: value }, resourceSlice, 'resource')).toBe(false);
  });

  it('keeps concrete resource type comparisons', () => {
    const value = { resourceType: 'Patient' };
    expect(typeCodeMatchesValue('Patient', inferType(value), value)).toBe(true);
    expect(typeCodeMatchesValue('Observation', inferType(value), value)).toBe(false);
  });
});
