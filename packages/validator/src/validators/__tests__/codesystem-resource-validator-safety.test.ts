import { describe, expect, it } from 'vitest';

import type {
  CodeSystem,
  CodeSystemConcept,
} from '../valueset-types';
import {
  validateCodeSystemResource,
  validateContainedCodeSystemResource,
} from '../codesystem-resource-validator';
import {
  codeSystemHasCode,
  countCodeSystemConcepts,
} from '../terminology-resource-utils';

describe('CodeSystem resource validator safety', () => {
  it('returns no issues for malformed roots and property declarations', () => {
    expect(validateCodeSystemResource(null)).toEqual([]);
    expect(validateContainedCodeSystemResource(42, 0)).toEqual([]);

    expect(validateCodeSystemResource({
      resourceType: 'CodeSystem',
      property: [
        null,
        42,
        { code: Symbol('status'), uri: Symbol('uri') },
      ],
    })).toEqual([]);
  });

  // The remark is about the code system, not the one concept it points at, so
  // it is made once — the reference validator reports it once as well, and per
  // concept it would be 1 300 remarks on something the size of v3-ActCode.
  it('remarks once on missing HL7 concept definitions, at the first concept without one', () => {
    const issues = validateCodeSystemResource({
      resourceType: 'CodeSystem',
      url: 'http://hl7.org/fhir/test-system',
      caseSensitive: true,
      concept: [{
        code: 'parent',
        concept: [
          { code: 'child-1' },
          { code: 'child-2', definition: 'Defined' },
        ],
      }],
    });

    expect(issues.filter(issue => issue.code === 'tx-codesystem-concept-no-definition'))
      .toEqual([expect.objectContaining({ path: 'CodeSystem.concept[0]' })]);
  });

  it('anchors the remark on the first concept that lacks a definition', () => {
    const issues = validateCodeSystemResource({
      resourceType: 'CodeSystem',
      url: 'http://hl7.org/fhir/test-system',
      caseSensitive: true,
      concept: [
        { code: 'first', definition: 'Defined' },
        { code: 'second' },
        { code: 'third' },
      ],
    });

    expect(issues.filter(issue => issue.code === 'tx-codesystem-concept-no-definition'))
      .toEqual([expect.objectContaining({ path: 'CodeSystem.concept[1]' })]);
  });

  it('contains cyclic concept trees during validation, count, and lookup', () => {
    const concept: Record<string, unknown> = {
      code: 'root',
      definition: 'Root concept',
    };
    concept.concept = [concept];
    const concepts = [concept] as unknown as CodeSystemConcept[];
    const codeSystem = {
      resourceType: 'CodeSystem',
      url: 'https://example.test/CodeSystem/cyclic',
      content: 'complete',
      caseSensitive: true,
      count: 1,
      concept: concepts,
    };

    expect(validateCodeSystemResource(codeSystem))
      .not.toContainEqual(expect.objectContaining({
        code: 'tx-codesystem-count-mismatch',
      }));
    expect(countCodeSystemConcepts(concepts)).toBe(1);
    expect(codeSystemHasCode(codeSystem as CodeSystem, 'root')).toBe(true);
    expect(codeSystemHasCode(codeSystem as CodeSystem, 'missing')).toBe(false);
  });

  it('does not count malformed concept entries as defined concepts', () => {
    const concepts = [
      null,
      42,
      { code: 'valid' },
    ] as unknown as CodeSystemConcept[];

    expect(countCodeSystemConcepts(concepts)).toBe(1);
    expect(validateCodeSystemResource({
      resourceType: 'CodeSystem',
      content: 'complete',
      caseSensitive: true,
      count: 1,
      concept: concepts,
    })).not.toContainEqual(expect.objectContaining({
      code: 'tx-codesystem-count-mismatch',
    }));
  });

  it('uses precise nested paths for contained HL7 CodeSystem concepts', () => {
    const issues = validateContainedCodeSystemResource({
      resourceType: 'CodeSystem',
      url: 'http://hl7.org/fhir/contained-test',
      caseSensitive: true,
      concept: [{
        code: 'parent',
        definition: 'Defined',
        concept: [{ code: 'child' }],
      }],
    }, 3);

    expect(issues.filter(issue => issue.code === 'tx-codesystem-concept-no-definition'))
      .toEqual([
        expect.objectContaining({
          path: 'ValueSet.contained[3].concept[0].concept[0]',
        }),
      ]);
  });
});
