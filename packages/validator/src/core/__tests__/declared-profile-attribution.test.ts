import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  applyDeclaredProfileAttribution,
  applyDeclaredProfileAttributionToAspectResults,
  resolveDeclaredProfileSubstitution,
} from '../declared-profile-attribution';
import type { AspectResult } from '../multi-aspect-types';
import type { StructureDefinition } from '../structure-definition-types';

const BP_PROFILE_URL = 'http://hl7.org/fhir/StructureDefinition/bp';

function bpStructureDef(): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    url: BP_PROFILE_URL,
    name: 'Bp',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Observation',
    snapshot: {
      element: [
        { path: 'Observation' },
        // Base-spec minimum: the base already requires status.
        { path: 'Observation.status', min: 1, max: '1', base: { path: 'Observation.status', min: 1, max: '1' } },
        // Profile-imposed minimum: bp tightens category from 0..* to 1..*.
        { path: 'Observation.category', min: 1, max: '*', base: { path: 'Observation.category', min: 0, max: '*' } },
        // Slice entry repeating the path must not shadow the defining element.
        { path: 'Observation.category', sliceName: 'VSCat', min: 1, max: '1', base: { path: 'Observation.category', min: 0, max: '*' } },
        { path: 'Observation.value[x]', min: 0, max: '1', base: { path: 'Observation.value[x]', min: 0, max: '1' } },
      ],
    },
  };
}

function minIssue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
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

describe('resolveDeclaredProfileSubstitution', () => {
  it('confirms the applied profile is the primary declared meta.profile', () => {
    const resource = { resourceType: 'Observation', meta: { profile: [BP_PROFILE_URL] } };
    expect(resolveDeclaredProfileSubstitution(resource, BP_PROFILE_URL)).toBe(BP_PROFILE_URL);
  });

  it('returns null when the resource declares no profile', () => {
    expect(resolveDeclaredProfileSubstitution({ resourceType: 'Observation' }, BP_PROFILE_URL))
      .toBeNull();
  });

  it('returns null when a different profile was applied', () => {
    const resource = { resourceType: 'Observation', meta: { profile: [BP_PROFILE_URL] } };
    expect(resolveDeclaredProfileSubstitution(
      resource,
      'http://hl7.org/fhir/StructureDefinition/Observation',
    )).toBeNull();
  });
});

describe('applyDeclaredProfileAttribution', () => {
  it('relabels a profile-tightened minimum to the profile aspect with declared provenance', () => {
    const [attributed] = applyDeclaredProfileAttribution([minIssue()], BP_PROFILE_URL, bpStructureDef());

    expect(attributed.aspect).toBe('profile');
    expect(attributed.profile).toBe(BP_PROFILE_URL);
    expect(attributed.details).toMatchObject({
      profileSource: 'declared',
      declaredProfileUrl: BP_PROFILE_URL,
    });
    expect(attributed.id).not.toBe('structural-structural-cardinality-min-original');
    // The finding itself is untouched: same code, message, path, and severity.
    expect(attributed.severity).toBe('error');
    expect(attributed.code).toBe('structural-cardinality-min');
    expect(attributed.path).toBe('Observation.category');
  });

  it('keeps a base-spec minimum violation structural', () => {
    const baseViolation = minIssue({
      path: 'Observation.status',
      message: 'Observation.status has too few values: expected at least 1',
    });

    const [untouched] = applyDeclaredProfileAttribution([baseViolation], BP_PROFILE_URL, bpStructureDef());

    expect(untouched).toBe(baseViolation);
    expect(untouched.aspect).toBe('structural');
  });

  it('relabels slice-scoped minimums regardless of the base cardinality', () => {
    const sliceViolation = minIssue({
      path: 'Observation.component[0].code',
      details: { sliceName: 'systolic', expectedMin: 1, actualCount: 0 },
    });

    const [attributed] = applyDeclaredProfileAttribution([sliceViolation], BP_PROFILE_URL, bpStructureDef());

    expect(attributed.aspect).toBe('profile');
    expect(attributed.details).toMatchObject({ profileSource: 'declared', sliceName: 'systolic' });
  });

  it('leaves unknown paths, foreign-profile issues, and other aspects untouched', () => {
    const unknownPath = minIssue({ path: 'Observation.unmapped' });
    const foreignProfile = minIssue({ profile: 'https://example.org/StructureDefinition/other' });
    const terminology = minIssue({ aspect: 'terminology', code: 'terminology-code-invalid' });

    const attributed = applyDeclaredProfileAttribution(
      [unknownPath, foreignProfile, terminology],
      BP_PROFILE_URL,
      bpStructureDef(),
    );

    expect(attributed[0]).toBe(unknownPath);
    expect(attributed[1]).toBe(foreignProfile);
    expect(attributed[2]).toBe(terminology);
  });

  it('stays conservative when the snapshot carries no base cardinality metadata', () => {
    const noBaseMetadata: StructureDefinition = {
      ...bpStructureDef(),
      snapshot: { element: [{ path: 'Observation' }, { path: 'Observation.category', min: 1 }] },
    };

    const [untouched] = applyDeclaredProfileAttribution([minIssue()], BP_PROFILE_URL, noBaseMetadata);

    expect(untouched.aspect).toBe('structural');
  });
});

describe('applyDeclaredProfileAttributionToAspectResults', () => {
  function aspectResult(aspect: string, issues: ValidationIssue[]): AspectResult {
    return { aspect, issues, evidenceIssues: [...issues], validationTime: 1, isValid: false };
  }

  it('relabels the structural bucket in place without appending a signpost', () => {
    const structural = aspectResult('structural', [minIssue()]);
    const profile = aspectResult('profile', []);

    applyDeclaredProfileAttributionToAspectResults([structural, profile], BP_PROFILE_URL, bpStructureDef());

    expect(structural.issues[0].aspect).toBe('profile');
    expect(structural.issues[0].details).toMatchObject({ profileSource: 'declared' });
    expect(structural.evidenceIssues?.[0].aspect).toBe('profile');
    // No explanation issue is added — the user declared the profile.
    expect(profile.issues).toHaveLength(0);
    expect(profile.evidenceIssues).toHaveLength(0);
  });
});
