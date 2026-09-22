import { describe, expect, it } from 'vitest';
import type { StructureDefinition } from '../../core/structure-definition-types';
import { mergeChildTypeProfileConstraints } from '../slice-info-inheritance';

// A Bundle entry slice whose `resource` child declares a Composition profile.
// That profile slices its own `section` by code; those patterns describe the
// section slices, not `resource.section` as a whole.
const compositionProfile = {
  resourceType: 'StructureDefinition',
  url: 'http://example.org/StructureDefinition/composition-sliced',
  type: 'Composition',
  snapshot: {
    element: [
      { id: 'Composition', path: 'Composition' },
      { id: 'Composition.status', path: 'Composition.status', fixedCode: 'final' },
      { id: 'Composition.section', path: 'Composition.section' },
      { id: 'Composition.section:problems', path: 'Composition.section', sliceName: 'problems' },
      {
        id: 'Composition.section:problems.code',
        path: 'Composition.section.code',
        patternCodeableConcept: { coding: [{ system: 'http://loinc.org', code: '11450-4' }] },
      },
      { id: 'Composition.section:allergies', path: 'Composition.section', sliceName: 'allergies' },
      {
        id: 'Composition.section:allergies.code',
        path: 'Composition.section.code',
        patternCodeableConcept: { coding: [{ system: 'http://loinc.org', code: '48765-2' }] },
      },
    ],
  },
} as unknown as StructureDefinition;

describe('mergeChildTypeProfileConstraints', () => {
  it('keeps a slice-scoped pattern off the unsliced path', async () => {
    const childPatterns = new Map<string, unknown>();
    const childFixed = new Map<string, unknown>();
    await mergeChildTypeProfileConstraints(
      new Map([['resource', [{ code: 'Composition', profile: [compositionProfile.url] }]]]),
      childPatterns,
      childFixed,
      async () => compositionProfile,
    );

    expect(childPatterns.has('resource.section.code')).toBe(false);
    expect(childFixed.get('resource.status')).toBe('final');
  });

  it('merges nothing when the child declares alternative profiles', async () => {
    const childPatterns = new Map<string, unknown>();
    const childFixed = new Map<string, unknown>();
    await mergeChildTypeProfileConstraints(
      new Map([['resource', [
        { code: 'Composition', profile: [compositionProfile.url, 'http://example.org/other'] },
      ]]]),
      childPatterns,
      childFixed,
      async () => compositionProfile,
    );

    expect(childFixed.size).toBe(0);
  });
});
