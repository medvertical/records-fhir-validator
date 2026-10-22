import { describe, expect, it, vi } from 'vitest';
import type { ValidationSettings } from '@records-fhir/validation-types';
import { ReferenceValidator } from '../reference-validator-refactored';
import { RecursiveReferenceValidator } from '../recursive-reference-validator';
import { buildRecursiveReferenceIssues } from '../reference-recursive-issues';

type Fixture = Record<string, unknown> & { resourceType: string; id: string };
const settings = {
  recursiveReferenceValidation: {
    enabled: true, maxDepth: 3, validateExternal: true, maxReferencesPerResource: 20,
  },
} as unknown as ValidationSettings;

async function validate(root: Fixture, resources: Fixture[]) {
  const lookup = new Map(resources.map(resource => [`${resource.resourceType}/${resource.id}`, resource]));
  const fetcher = vi.fn(async (reference: string) => lookup.get(reference) ?? null);
  const issues = await new ReferenceValidator().validateInternal(root, root.resourceType, 'R4', settings, undefined, fetcher);
  return { issues, fetcher };
}

describe('recursive reference cycle publication', () => {
  it('terminates a reciprocal Encounter diagnosis / Condition encounter without a conformance finding', async () => {
    const encounter: Fixture = {
      resourceType: 'Encounter', id: 'e1', diagnosis: [{ condition: { reference: 'Condition/c1' } }],
    };
    const condition: Fixture = { resourceType: 'Condition', id: 'c1', encounter: { reference: 'Encounter/e1' } };
    const { issues, fetcher } = await validate(encounter, [encounter, condition]);
    expect(issues).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const diagnostic = await new RecursiveReferenceValidator().validateRecursively(encounter,
      { enabled: true, maxDepth: 3 }, async reference => reference === 'Condition/c1' ? condition : encounter);
    expect(diagnostic.circularReferences).toEqual([['Encounter/e1', 'Condition/c1', 'Encounter/e1']]);
    expect(diagnostic.totalResourcesValidated).toBe(2);
  });

  it('does not mistake a partOf prefix followed by a clinical backlink for a hierarchy cycle', async () => {
    const child: Fixture = { resourceType: 'Encounter', id: 'child', partOf: { reference: 'Encounter/parent' } };
    const parent: Fixture = {
      resourceType: 'Encounter', id: 'parent', diagnosis: [{ condition: { reference: 'Condition/c1' } }],
    };
    const condition: Fixture = { resourceType: 'Condition', id: 'c1', encounter: { reference: 'Encounter/parent' } };
    expect((await validate(child, [child, parent, condition])).issues).toEqual([]);
  });

  it('allows reciprocal Patient.link.other references', async () => {
    const a: Fixture = { resourceType: 'Patient', id: 'a', link: [{ other: { reference: 'Patient/b' }, type: 'seealso' }] };
    const b: Fixture = { resourceType: 'Patient', id: 'b', link: [{ other: { reference: 'Patient/a' }, type: 'seealso' }] };
    expect((await validate(a, [a, b])).issues).toEqual([]);
  });

  it.each(['Encounter', 'Organization', 'Location'])('still reports a true %s.partOf hierarchy cycle at its source field', async resourceType => {
    const a: Fixture = { resourceType, id: 'a', partOf: { reference: `${resourceType}/b` } };
    const b: Fixture = { resourceType, id: 'b', partOf: { reference: `${resourceType}/a` } };
    const { issues } = await validate(a, [a, b]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'reference-circular', severity: 'warning', path: `${resourceType}.partOf`,
      details: { relationship: `${resourceType}.partOf`, chain: [`${resourceType}/a`, `${resourceType}/b`, `${resourceType}/a`] },
    });
    expect(issues[0].message).toContain('strict hierarchy');
  });

  it('reports a direct Encounter.partOf self-loop', async () => {
    const root: Fixture = { resourceType: 'Encounter', id: 'self', partOf: { reference: 'Encounter/self' } };
    const { issues, fetcher } = await validate(root, [root]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'reference-circular', path: 'Encounter.partOf',
      details: expect.objectContaining({ relationship: 'Encounter.partOf' }),
    }));
  });

  it('does not combine different CarePlan hierarchy relationships into a fictitious cycle', async () => {
    const a: Fixture = { resourceType: 'CarePlan', id: 'a', basedOn: [{ reference: 'CarePlan/b' }] };
    const b: Fixture = { resourceType: 'CarePlan', id: 'b', partOf: [{ reference: 'CarePlan/a' }] };
    expect((await validate(a, [a, b])).issues).toEqual([]);
  });

  it('finds a same-relationship cycle even when a different relationship first visited its target', async () => {
    const a: Fixture = {
      resourceType: 'CarePlan', id: 'a', basedOn: [{ reference: 'CarePlan/b' }], partOf: [{ reference: 'CarePlan/b' }],
    };
    const b: Fixture = { resourceType: 'CarePlan', id: 'b', partOf: [{ reference: 'CarePlan/a' }] };
    const { issues } = await validate(a, [a, b]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'reference-circular', path: 'CarePlan.partOf[0]',
      details: { relationship: 'CarePlan.partOf' },
    });
  });

  it('retains unresolved-reference and timeout publication even when ordinary cycles are present', () => {
    const issues = buildRecursiveReferenceIssues({
      totalResourcesValidated: 2, maxDepthReached: 1, referencesFollowed: 1,
      unresolvedReferences: ['Patient/missing'], circularReferences: [['Encounter/e1', 'Condition/c1', 'Encounter/e1']],
      validationTimeMs: 30, timedOut: true,
    }, 20, 'Encounter', new Map([['Patient/missing', ['Encounter.subject']]]));
    expect(issues.map(issue => issue.code)).toEqual(['reference-unresolved', 'reference-recursive-timeout']);
    expect(issues[0].path).toBe('Encounter.subject');
  });

  it.each(['Encounter/b/_history/1', 'https://foreign.example/fhir/Encounter/b'])('does not collapse %s into a local current hierarchy target', async reference => {
    const a: Fixture = { resourceType: 'Encounter', id: 'a', partOf: { reference } };
    const b: Fixture = { resourceType: 'Encounter', id: 'b', partOf: { reference: 'Encounter/a' } };
    const issues = await new ReferenceValidator().validateInternal(a, 'Encounter', 'R4', settings, undefined,
      async target => target === reference ? b : a);
    expect(issues.some(issue => issue.code === 'reference-circular')).toBe(false);
  });

  it('does not merge hierarchy edges from a foreign resource with local resources sharing their IDs', async () => {
    const a: Fixture = { resourceType: 'Encounter', id: 'a',
      diagnosis: [{ condition: { reference: 'https://foreign.example/fhir/Condition/c1' } }],
      partOf: { reference: 'Encounter/b' },
    };
    const foreign: Fixture = { resourceType: 'Condition', id: 'c1', encounter: { reference: 'Encounter/b' } };
    const foreignB: Fixture = { resourceType: 'Encounter', id: 'b', partOf: { reference: 'Encounter/a' } };
    const issues = await new ReferenceValidator().validateInternal(a, 'Encounter', 'R4', settings, undefined,
      async target => target.startsWith('https:') ? foreign : foreignB);
    expect(issues.some(issue => issue.code === 'reference-circular')).toBe(false);
  });

  it('does not publish hierarchy findings for excluded targets', async () => {
    const a: Fixture = { resourceType: 'Encounter', id: 'a', partOf: { reference: 'Encounter/a' } };
    const diagnostic = await new RecursiveReferenceValidator().validateRecursively(a, {
      enabled: true, maxDepth: 3, excludeResourceTypes: ['Encounter'],
    });
    expect(buildRecursiveReferenceIssues(diagnostic, 30_000, 'Encounter', new Map())).toEqual([]);
  });
});
