import { describe, expect, it } from 'vitest';
import { unresolvedInternalSystemIssues } from '../internal-system-target-rule';

describe('unresolvedInternalSystemIssues', () => {
  it('warns about a system pointing at no element or narrative anchor of the resource', () => {
    const issues = unresolvedInternalSystemIssues({
      resourceType: 'Practitioner',
      id: 'p1',
      meta: { tag: [{ system: '#migrated-from', code: 'legacy' }] },
    });

    expect(issues).toEqual([expect.objectContaining({
      code: 'structural-internal-uri-unresolved',
      severity: 'warning',
      path: 'Practitioner.meta.tag[0].system',
      message: "The URL value '#migrated-from' might be wrong because it appears to point to an internal target, but there is no matching target",
    })]);
  });

  it('accepts a target among element ids, contained resources and narrative anchors', () => {
    expect(unresolvedInternalSystemIssues({
      resourceType: 'Observation',
      text: { status: 'generated', div: '<div xmlns="http://www.w3.org/1999/xhtml"><a name="codes"> </a></div>' },
      contained: [{ resourceType: 'CodeSystem', id: 'local' }],
      code: {
        id: 'panel',
        coding: [{ system: '#local', code: 'a' }, { system: '#codes', code: 'b' }, { system: '#panel', code: 'c' }],
      },
    })).toEqual([]);
  });

  it('rejects an unresolved system in a value set include, which has to resolve', () => {
    expect(unresolvedInternalSystemIssues({
      resourceType: 'ValueSet',
      compose: { include: [{ system: '#missing' }] },
    })).toEqual([expect.objectContaining({
      severity: 'error',
      path: 'ValueSet.compose.include[0].system',
      message: "The URL value '#missing' is invalid because there is no matching target",
    })]);
  });

  it('terminates on a cyclic object graph', () => {
    const coding: Record<string, unknown> = { system: '#nowhere', code: 'x' };
    coding.self = coding;

    expect(unresolvedInternalSystemIssues({ resourceType: 'Observation', code: { coding: [coding] } }))
      .toHaveLength(1);
  });
});
