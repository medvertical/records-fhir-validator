import { describe, expect, it, vi } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types.js';
import { ConstraintValidator } from '../constraint-validator.js';
import { SDFHIRPathExecutor } from '../sd-fhirpath-executor.js';
import type { ReferenceResolver } from '../slice-types.js';

const resource = { resourceType: 'CareTeam', participant: [{
  member: { reference: 'Practitioner/1' }, onBehalfOf: { reference: 'Organization/2' },
}] };
const profile = (expression: string): StructureDefinition => ({
  resourceType: 'StructureDefinition', url: 'https://example.test/CareTeam',
  name: 'CareTeamReferenceTest', type: 'CareTeam', kind: 'resource',
  snapshot: { element: [{ path: 'CareTeam' }, { path: 'CareTeam.participant',
    type: [{ code: 'BackboneElement' }], constraint: [{ key: 'host-reference', severity: 'error',
      human: 'Member must resolve to a Practitioner', expression }] }] },
});

describe.each(['constraint', 'snapshot'] as const)('%s FHIRPath host references', engine => {
  function evaluator(expression = 'onBehalfOf.exists() implies (member.resolve() is Practitioner)') {
    const definition = profile(expression);
    const constraint = new ConstraintValidator();
    const snapshot = new SDFHIRPathExecutor();
    return (referenceResolver: ReferenceResolver, bundle?: { entry: unknown[] }) => engine === 'constraint'
      ? constraint.validate(resource, definition.snapshot!.element, definition.url,
        { fhirVersion: 'R5', referenceResolver, bundle })
      : snapshot.execute({ resource, resourceType: 'CareTeam', structureDef: definition,
        fhirVersion: 'R5', referenceResolver, bundle });
  }

  it('uses actual targets and observes changed resolvers with a warm expression cache', async () => {
    const run = evaluator();
    expect(await run(() => ({ resourceType: 'Practitioner', id: '1' }))).toEqual([]);
    expect(await run(() => ({ resourceType: 'Patient', id: '1' })))
      .toContainEqual(expect.objectContaining({ ruleId: 'host-reference', severity: 'error' }));
    expect(await run(() => null)).toContainEqual(expect.objectContaining({ ruleId: 'host-reference' }));
    expect(await run(() => ({ resourceType: 'Practitioner', id: '1' }))).toEqual([]);
  });

  it('resolves Bundle targets before consulting the host', async () => {
    const resolver = vi.fn(() => ({ resourceType: 'Patient', id: '1' }));
    expect(await evaluator()(resolver, { entry: [{ resource: { resourceType: 'Practitioner', id: '1' } }] }))
      .toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('uses the same resolver for the resolve().exists() precheck', async () => {
    const run = evaluator('member.resolve().exists()');
    expect(await run(() => ({ resourceType: 'Practitioner', id: '1' }))).toEqual([]);
    expect(await run(() => null)).toContainEqual(expect.objectContaining({ ruleId: 'host-reference' }));
  });

  it('reports unsupported asynchronous results as incomplete evaluation', async () => {
    const issues = await evaluator()(() => Promise.resolve({ resourceType: 'Practitioner', id: '1' }));
    expect(issues.some(issue => issue.code?.includes('evaluation-error'))).toBe(true);
    expect(issues.some(issue => issue.code?.endsWith('host-reference'))).toBe(false);
  });
});
