import { describe, expect, it } from 'vitest';
import { InvariantExecutor } from '../executors';
import { resolveSemanticAspectPlan } from '../semantic-aspect-plan';

const NESTED_CONTAINED = {
  resourceType: 'Patient',
  id: 'outer',
  contained: [{
    resourceType: 'Observation', id: 'inner', status: 'final', code: {},
    contained: [{ resourceType: 'Patient', id: 'innermost' }],
  }],
};

describe('base-spec invariants belong to the structural aspect', () => {
  // They were gated by `invariant` on the single-resource path and by
  // `structural` on the batch path, so the same resource validated differently
  // depending on which one saw it.
  it('is scheduled whenever structural is requested', () => {
    expect([...resolveSemanticAspectPlan(['structural']).executors]).toContain('invariant');
    expect([...resolveSemanticAspectPlan(['metadata']).executors]).not.toContain('invariant');
  });

  it('labels what it emits as structural, not as its own aspect', async () => {
    const issues = await new InvariantExecutor().validate({
      resource: NESTED_CONTAINED,
      structureDef: { resourceType: 'StructureDefinition', url: 'http://hl7.org/fhir/StructureDefinition/Patient' } as never,
      profileUrl: 'http://hl7.org/fhir/StructureDefinition/Patient',
    });

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map(issue => issue.aspect)).not.toContain('invariant');
    expect(issues.some(issue => issue.code === 'contained-nested-violation')).toBe(true);
  });
});
