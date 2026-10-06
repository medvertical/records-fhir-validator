import { describe, expect, it } from 'vitest';
import { ConstraintValidator } from '../constraint-validator';

// Da Vinci PCT's AEOB packet requires every reference in it to resolve to an
// entry: `Bundle.entry.descendants().reference.distinct().all(resolve().exists())`.
const packetElements = [{
  path: 'Bundle',
  constraint: [{
    key: 'pct-aeob-packet-1',
    severity: 'error' as const,
    human: 'All references resources SHALL be contained within the Bundle',
    expression: 'Bundle.entry.descendants().reference.distinct().all(resolve().exists())',
  }],
}];

const packet = (reference: string) => ({
  resourceType: 'Bundle',
  type: 'document',
  entry: [
    { fullUrl: 'http://example.org/fhir/Composition/c1', resource: { resourceType: 'Composition', id: 'c1', subject: { reference } } },
    { fullUrl: 'http://example.org/fhir/Patient/p1', resource: { resourceType: 'Patient', id: 'p1' } },
  ],
});

describe('resolve() in the invariants of a Bundle validated on its own', () => {
  it('finds the Bundle\'s own entries', async () => {
    const issues = await new ConstraintValidator().validate(packet('Patient/p1'), packetElements as any, 'http://example.org/packet');

    expect(issues.filter(issue => issue.ruleId === 'pct-aeob-packet-1')).toEqual([]);
  });

  it('still fails a reference no entry answers', async () => {
    const issues = await new ConstraintValidator().validate(packet('Patient/p2'), packetElements as any, 'http://example.org/packet');

    expect(issues.filter(issue => issue.ruleId === 'pct-aeob-packet-1')).toHaveLength(1);
  });
});
