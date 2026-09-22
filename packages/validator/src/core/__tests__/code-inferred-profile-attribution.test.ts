import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  CODE_INFERRED_SIGNPOST_CODE,
  applyCodeInferredAttributionToAspectResults,
  applyCodeInferredProfileAttribution,
  createCodeInferredProfileSignpostIssue,
  resolveCodeInferredProfileMatch,
} from '../code-inferred-profile-attribution';
import type { CodeInferredProfileMatch } from '../code-inferred-profiles';
import type { AspectResult } from '../multi-aspect-types';

const BP_PROFILE_URL = 'http://hl7.org/fhir/StructureDefinition/bp';

const BP_MATCH: CodeInferredProfileMatch = {
  profileUrl: BP_PROFILE_URL,
  system: 'http://loinc.org',
  code: '8480-6',
};

function systolicObservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resourceType: 'Observation',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
    ...overrides,
  };
}

function cardinalityIssue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    id: 'structural-structural-cardinality-min-original',
    aspect: 'structural',
    severity: 'error',
    code: 'structural-cardinality-min',
    message: 'Observation.category has too few values: expected at least 1',
    path: 'Observation.category',
    profile: BP_PROFILE_URL,
    timestamp: new Date(),
    ...overrides,
  };
}

describe('resolveCodeInferredProfileMatch', () => {
  it('confirms the applied profile came from the code-inference table', () => {
    expect(resolveCodeInferredProfileMatch(systolicObservation(), BP_PROFILE_URL))
      .toEqual(BP_MATCH);
  });

  it('returns null when the resource declares the profile itself', () => {
    const declared = systolicObservation({ meta: { profile: [BP_PROFILE_URL] } });
    expect(resolveCodeInferredProfileMatch(declared, BP_PROFILE_URL)).toBeNull();
  });

  it('returns null when a different profile was applied', () => {
    expect(resolveCodeInferredProfileMatch(
      systolicObservation(),
      'http://hl7.org/fhir/StructureDefinition/Observation',
    )).toBeNull();
  });
});

describe('createCodeInferredProfileSignpostIssue', () => {
  it('mirrors the HL7 reference validator signpost wording for bp / 8480-6', () => {
    const signpost = createCodeInferredProfileSignpostIssue(BP_MATCH);
    expect(signpost.message).toBe(
      'Validate Observation against the Blood pressure systolic and diastolic profile '
      + '(http://hl7.org/fhir/StructureDefinition/bp) which is required by the FHIR '
      + 'specification because the LOINC code 8480-6 was found',
    );
    expect(signpost).toMatchObject({
      aspect: 'profile',
      severity: 'info',
      code: CODE_INFERRED_SIGNPOST_CODE,
      profile: BP_PROFILE_URL,
      details: expect.objectContaining({
        profileSource: 'code-inferred',
        inferredFromSystem: 'http://loinc.org',
        inferredFromCode: '8480-6',
      }),
    });
  });
});

describe('applyCodeInferredProfileAttribution', () => {
  it('relabels structural constraint failures to the profile aspect with attribution details', () => {
    const [attributed] = applyCodeInferredProfileAttribution([cardinalityIssue()], BP_MATCH);

    expect(attributed.aspect).toBe('profile');
    expect(attributed.profile).toBe(BP_PROFILE_URL);
    expect(attributed.details).toMatchObject({
      profileSource: 'code-inferred',
      inferredProfileUrl: BP_PROFILE_URL,
      inferredFromCode: '8480-6',
    });
    expect(attributed.id).not.toBe('structural-structural-cardinality-min-original');
    // The finding itself is untouched: same code, message, path, and severity.
    expect(attributed.severity).toBe('error');
    expect(attributed.code).toBe('structural-cardinality-min');
    expect(attributed.message).toBe('Observation.category has too few values: expected at least 1');
  });

  it('keeps non-structural issues in their aspect but records the profile provenance', () => {
    const [attributed] = applyCodeInferredProfileAttribution([
      cardinalityIssue({ aspect: 'terminology', code: 'terminology-code-invalid' }),
    ], BP_MATCH);

    expect(attributed.aspect).toBe('terminology');
    expect(attributed.details).toMatchObject({ profileSource: 'code-inferred' });
  });

  it('leaves best-practice hints and foreign-profile issues untouched', () => {
    const bestPractice = cardinalityIssue({
      severity: 'information',
      code: 'best-practice-category',
      details: { bestPractice: true },
      tags: ['best-practice'],
    });
    const foreignProfile = cardinalityIssue({
      profile: 'https://example.org/StructureDefinition/other',
    });

    const attributed = applyCodeInferredProfileAttribution([bestPractice, foreignProfile], BP_MATCH);

    expect(attributed[0]).toBe(bestPractice);
    expect(attributed[1]).toBe(foreignProfile);
  });
});

describe('applyCodeInferredAttributionToAspectResults', () => {
  function aspectResult(aspect: string, issues: ValidationIssue[]): AspectResult {
    return { aspect, issues, evidenceIssues: [...issues], validationTime: 1, isValid: false };
  }

  it('relabels the structural bucket and appends the signpost to the profile bucket', () => {
    const structural = aspectResult('structural', [cardinalityIssue()]);
    const profile = aspectResult('profile', [cardinalityIssue({
      aspect: 'profile',
      code: 'profile-slice-count',
      message: 'Slice systolic: minimum 1 occurrence required',
    })]);

    applyCodeInferredAttributionToAspectResults([structural, profile], BP_MATCH, 'R4');

    expect(structural.issues[0].aspect).toBe('profile');
    expect(structural.issues[0].details).toMatchObject({ profileSource: 'code-inferred' });
    expect(structural.evidenceIssues?.[0].aspect).toBe('profile');
    const signposts = profile.issues.filter(issue => issue.code === CODE_INFERRED_SIGNPOST_CODE);
    expect(signposts).toHaveLength(1);
    expect(signposts[0].schemaVersion).toBe('R4');
    expect(profile.evidenceIssues?.some(issue => issue.code === CODE_INFERRED_SIGNPOST_CODE)).toBe(true);
  });

  it('does nothing when no profile bucket was collected', () => {
    const structural = aspectResult('structural', [cardinalityIssue()]);

    applyCodeInferredAttributionToAspectResults([structural], BP_MATCH, 'R4');

    expect(structural.issues[0].aspect).toBe('structural');
  });
});
