import { describe, expect, it } from 'vitest';
import { applyConceptFilter } from '../valueset-concept-utils';
import type { CodeSystem } from '../valueset-types';

const PARENT_URI = 'http://hl7.org/fhir/concept-properties#parent';

// HL7 Terminology ships every v3 CodeSystem this way: one flat concept list,
// the hierarchy carried by a property it names `subsumedBy`.
const FLAT_V3_STYLE: CodeSystem = {
  resourceType: 'CodeSystem',
  url: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  hierarchyMeaning: 'is-a',
  property: [{ code: 'subsumedBy', uri: PARENT_URI, type: 'code' }],
  concept: [
    { code: '_ActEncounterCode' },
    { code: 'AMB', property: [{ code: 'subsumedBy', valueCode: '_ActEncounterCode' }] },
    { code: 'IMP', property: [{ code: 'subsumedBy', valueCode: '_ActEncounterCode' }] },
    { code: 'ACUTE', property: [{ code: 'subsumedBy', valueCode: 'IMP' }] },
    { code: 'ELSEWHERE', property: [{ code: 'subsumedBy', valueCode: '_ActPriority' }] },
  ],
} as CodeSystem;

const NESTED: CodeSystem = {
  resourceType: 'CodeSystem',
  url: 'http://example.test/CodeSystem/nested',
  concept: [
    { code: 'root', concept: [{ code: 'child', concept: [{ code: 'grandchild' }] }] },
    { code: 'unrelated' },
  ],
} as CodeSystem;

describe('concept filters over a code system hierarchy', () => {
  it('follows a parent-naming property, not only the nesting', () => {
    const codes = applyConceptFilter(FLAT_V3_STYLE, {
      property: 'concept', op: 'is-a', value: '_ActEncounterCode',
    });
    expect(codes.sort()).toEqual(['ACUTE', 'AMB', 'IMP', '_ActEncounterCode']);
  });

  it('leaves the code itself out of descendent-of', () => {
    const codes = applyConceptFilter(FLAT_V3_STYLE, {
      property: 'concept', op: 'descendent-of', value: '_ActEncounterCode',
    });
    expect(codes.sort()).toEqual(['ACUTE', 'AMB', 'IMP']);
  });

  it('still reads a nested hierarchy', () => {
    expect(applyConceptFilter(NESTED, { property: 'concept', op: 'is-a', value: 'root' }).sort())
      .toEqual(['child', 'grandchild', 'root']);
  });

  it('says nothing about a code the system does not define', () => {
    expect(applyConceptFilter(FLAT_V3_STYLE, {
      property: 'concept', op: 'is-a', value: 'http://example.test/absent',
    })).toEqual([]);
  });

  // A property named `parent` carries the same meaning without declaring a uri.
  it('accepts the conventional property name', () => {
    const codeSystem = {
      resourceType: 'CodeSystem',
      url: 'http://example.test/CodeSystem/plain',
      property: [{ code: 'parent', type: 'code' }],
      concept: [
        { code: 'top' },
        { code: 'under', property: [{ code: 'parent', valueCode: 'top' }] },
      ],
    } as CodeSystem;
    expect(applyConceptFilter(codeSystem, { property: 'concept', op: 'is-a', value: 'top' }).sort())
      .toEqual(['top', 'under']);
  });

  // A cycle in the declared parents must not hang the expansion.
  it('terminates on a cyclic hierarchy', () => {
    const codeSystem = {
      resourceType: 'CodeSystem',
      url: 'http://example.test/CodeSystem/cyclic',
      property: [{ code: 'subsumedBy', uri: PARENT_URI, type: 'code' }],
      concept: [
        { code: 'a', property: [{ code: 'subsumedBy', valueCode: 'b' }] },
        { code: 'b', property: [{ code: 'subsumedBy', valueCode: 'a' }] },
      ],
    } as CodeSystem;
    expect(applyConceptFilter(codeSystem, { property: 'concept', op: 'is-a', value: 'a' }).sort())
      .toEqual(['a', 'b']);
  });
});
