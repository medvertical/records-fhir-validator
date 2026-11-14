import { describe, expect, it } from 'vitest';
import { validateContainedReferenceIssues } from '../reference-contained-validation';
import { ReferenceExecutor } from '../../core/executors/reference-executor';

function medication(containsTarget: boolean) {
  return {
    resourceType: 'Medication',
    ...(containsTarget ? { contained: [{ resourceType: 'Medication', id: 'ingredient' }] } : {}),
    ingredient: [{ itemReference: { reference: '#ingredient' } }],
  };
}

const parameters = (resources: unknown[]) => ({
  resourceType: 'Parameters',
  parameter: [{ name: 'group', part: resources.map(resource => ({
    name: 'nested', part: [{ name: 'medication', resource }],
  })) }],
});

describe('Parameters contained-reference scopes', () => {
  it('resolves fragments inside arbitrarily nested parameter parts against their resource', () => {
    expect(validateContainedReferenceIssues(parameters([medication(true)]))).toEqual([]);
  });

  it('reports a missing fragment at the embedded path without borrowing sibling contained ids', () => {
    const issues = validateContainedReferenceIssues(parameters([medication(true), medication(false)]));

    expect(issues.map(issue => [issue.code, issue.path])).toEqual([
      ['reference-contained-unresolved', 'Parameters.parameter[0].part[1].part[0].resource.ingredient[0].itemReference'],
      ['reference-ref1-invariant', 'Parameters.parameter[0].part[1].part[0].resource.ingredient[0].itemReference'],
    ]);
  });

  it('checks direct parameter resources in their own scope too', () => {
    const issues = validateContainedReferenceIssues({
      resourceType: 'Parameters', parameter: [{ name: 'medication', resource: medication(false) }],
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-ref1-invariant', path: 'Parameters.parameter[0].resource.ingredient[0].itemReference',
    }));
  });

  it('retains scopes and paths when Parameters is itself inside a Bundle', () => {
    const issues = validateContainedReferenceIssues({
      resourceType: 'Bundle', type: 'collection', entry: [{ resource: parameters([medication(false)]) }],
    });

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-ref1-invariant',
      path: 'Bundle.entry[0].resource.parameter[0].part[0].part[0].resource.ingredient[0].itemReference',
    }));
  });

  it('does not emit a false unresolved-reference issue through the engine executor', async () => {
    expect(await new ReferenceExecutor().validate({ resource: parameters([medication(true)]) })).toEqual([]);
  });

  it('terminates on cyclic parameter parts and embedded envelopes', () => {
    const group: Record<string, unknown> = { name: 'group' };
    const envelope = { resourceType: 'Parameters', parameter: [group] };
    group.part = [group, { name: 'loop', resource: envelope }];

    expect(validateContainedReferenceIssues(envelope)).toEqual([]);
  });
});
