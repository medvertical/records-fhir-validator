import { describe, expect, it } from 'vitest';
import { TwoPhaseTerminologyExpansion } from '../terminology-two-phase-expansion';
import type { CodeSystem, ValueSet } from '../valueset-types';

function createExpansion(valueSets: Record<string, ValueSet>, codeSystems: Record<string, CodeSystem> = {}) {
  return new TwoPhaseTerminologyExpansion({
    loadValueSetResource: async (url: string) => valueSets[url] ?? null,
    loadCodeSystem: async (url: string) => codeSystems[url] ?? null,
    extractCodesFromCodeSystem: (codeSystem: CodeSystem) => codeSystem.concept?.map(concept => concept.code) ?? [],
  } as any);
}

describe('TwoPhaseTerminologyExpansion', () => {
  it('treats pre-expanded ValueSets as complete local coverage', async () => {
    const expansion = createExpansion({
      'http://example.test/vs': {
        resourceType: 'ValueSet',
        url: 'http://example.test/vs',
        status: 'active',
        expansion: {
          contains: [{ system: 'http://example.test/cs', code: 'A' }],
        },
      },
    });

    await expect(expansion.lookup('A', 'http://example.test/cs', 'http://example.test/vs')).resolves.toMatchObject({
      status: 'hit',
      coverage: 'complete',
      source: 'expansion',
    });
    await expect(expansion.lookup('B', 'http://example.test/cs', 'http://example.test/vs')).resolves.toMatchObject({
      status: 'miss',
      coverage: 'complete',
    });
  });

  it('marks filter-based ValueSets as partial so callers keep the server fallback', async () => {
    const expansion = createExpansion({
      'http://example.test/filtered': {
        resourceType: 'ValueSet',
        url: 'http://example.test/filtered',
        status: 'active',
        compose: {
          include: [{
            system: 'http://snomed.info/sct',
            filter: [{ property: 'concept', op: 'is-a', value: '123' }],
          }],
        },
      },
    });

    await expect(expansion.lookup('456', 'http://snomed.info/sct', 'http://example.test/filtered')).resolves.toMatchObject({
      status: 'miss',
      coverage: 'partial',
      source: 'none',
    });
  });

  it('can expand complete local CodeSystem inclusions', async () => {
    const expansion = createExpansion(
      {
        'http://example.test/all-local': {
          resourceType: 'ValueSet',
          url: 'http://example.test/all-local',
          status: 'active',
          compose: {
            include: [{ system: 'http://example.test/cs' }],
          },
        },
      },
      {
        'http://example.test/cs': {
          resourceType: 'CodeSystem',
          url: 'http://example.test/cs',
          status: 'active',
          content: 'complete',
          concept: [{ code: 'LOCAL' }],
        } as CodeSystem,
      },
    );

    await expect(expansion.lookup('LOCAL', 'http://example.test/cs', 'http://example.test/all-local')).resolves.toMatchObject({
      status: 'hit',
      coverage: 'complete',
      source: 'compose',
    });
  });
});
