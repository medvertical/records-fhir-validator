/**
 * multi-aspect-profile-fallback.test.ts
 * -------------------------------------
 *
 * Regression test for the bug where the multi-aspect batch validator
 * early-returned with a single `profile-not-found` info issue when the
 * declared profile URL couldn't be resolved. All other aspects (structural,
 * invariant, reference, metadata, custom_rule, terminology) were skipped,
 * which meant a typo in `meta.profile` silently suppressed real validation
 * errors.
 *
 * The fix (see `loadProfileOrBase` in profile-loader-utils) falls back to
 * the resource type's base StructureDefinition and emits a warning on the
 * `profile` aspect. This matches HAPI's behaviour.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildMultiAspectValidateCallback } from '../multi-aspect-validate-callback';
import type { ValidationIssue } from '../../types';

vi.mock('../profile-loader-utils', () => ({
  // loadProfileOrBase: declared URL fails, base SD succeeds → usedBaseFallback=true
  loadProfileOrBase: vi.fn().mockResolvedValue({
    structureDef: { id: 'base-observation', resourceType: 'StructureDefinition' },
    declaredProfileUrl: 'http://example.org/DoesNotExist',
    usedBaseFallback: true,
  }),
  createProfileFallbackIssue: (profileUrl: string, resourceType: string): ValidationIssue => ({
    id: 'records-profile-not-resolved-stub',
    aspect: 'profile',
    severity: 'warning',
    code: 'profile-not-resolved',
    message: `Profile ${profileUrl} could not be resolved; validated against base ${resourceType} instead`,
    path: 'meta.profile',
    timestamp: new Date(),
    details: { profile: profileUrl },
  }),
  createProfileResourceTypeMismatchIssue: vi.fn(),
}));

vi.mock('../validators/deep-profile-validator', () => ({
  deepProfileValidator: { validate: () => [] },
}));
vi.mock('../validators/deep-binding-validator', () => ({
  deepBindingValidator: { validate: () => [] },
}));
vi.mock('../validators/sd-fhirpath-executor', () => ({
  sdFHIRPathExecutor: { execute: async () => [] },
}));
vi.mock('../validators/contained-resource-validator', () => ({
  containedResourceValidator: { validate: () => [] },
}));
vi.mock('../validators/universal-constraints-validator', () => ({
  universalConstraintsValidator: { validate: () => [] },
}));

const cardinalityError: ValidationIssue = {
  severity: 'error',
  code: 'structural-cardinality-min',
  message: 'Observation.status: minimum cardinality 1 not met',
  path: 'Observation.status',
};

function makeDeps() {
  return {
    sdLoader: {} as any,
    snapshotGenerator: {} as any,
    // The structural executor DOES find an error against the base SD —
    // exactly what should surface when we fall back.
    structuralExecutor: { validate: async () => [{ ...cardinalityError }] } as any,
    profileExecutor: { validate: async () => [] } as any,
    terminologyExecutor: { validate: async () => [] } as any,
    referenceExecutor: { validate: async () => [] } as any,
    invariantExecutor: { validate: async () => [] } as any,
    customRuleExecutor: { validate: async () => [] } as any,
    metadataExecutor: { validate: async () => [] } as any,
    bestPracticeValidator: { validate: () => [] } as any,
    strictMode: false,
  };
}

describe('multi-aspect-validate-callback — profile fallback', () => {
  it('still runs non-profile aspects when declared profile is unresolvable', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps(),
      ['structural', 'profile', 'invariant', 'reference', 'metadata'],
      { validationStrictness: 'standard', aspects: {} },
    );

    const result = await callback(
      { resourceType: 'Observation' },
      'http://example.org/DoesNotExist',
      'R4',
    );

    // Structural must surface the cardinality error — without the fix this
    // aspect was never invoked and the error was swallowed.
    const structural = result.aspects.find(a => a.aspect === 'structural');
    expect(structural).toBeDefined();
    expect(structural!.issues).toHaveLength(1);
    expect(structural!.issues[0].code).toBe('structural-cardinality-min');

    // Profile aspect carries the fallback warning.
    const profile = result.aspects.find(a => a.aspect === 'profile');
    expect(profile).toBeDefined();
    const fallback = profile!.issues.find(i => i.code === 'profile-not-resolved');
    expect(fallback).toBeDefined();
    expect(fallback!.severity).toBe('warning');

    // All requested aspects actually ran (were not short-circuited).
    const aspectNames = result.aspects.map(a => a.aspect).sort();
    expect(aspectNames).toEqual(['invariant', 'metadata', 'profile', 'reference', 'structural']);
  });

  it('surfaces fallback warning even when profile aspect is not requested', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps(),
      ['structural'],
      { validationStrictness: 'standard', aspects: {} },
    );

    const result = await callback(
      { resourceType: 'Observation' },
      'http://example.org/DoesNotExist',
      'R4',
    );

    // Synthetic profile aspect holds just the warning.
    const profile = result.aspects.find(a => a.aspect === 'profile');
    expect(profile).toBeDefined();
    expect(profile!.issues).toHaveLength(1);
    expect(profile!.issues[0].code).toBe('profile-not-resolved');

    // Structural still ran.
    const structural = result.aspects.find(a => a.aspect === 'structural');
    expect(structural!.issues[0].code).toBe('structural-cardinality-min');
  });
});
