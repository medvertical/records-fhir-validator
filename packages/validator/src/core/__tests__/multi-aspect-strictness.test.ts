/**
 * multi-aspect-strictness.test.ts
 * -------------------------------
 *
 * Regression test for the bug where `validationStrictness='compatibility'`
 * was silently dropped in the records-validator multi-aspect batch path.
 *
 * The single-aspect `validation-engine-single-aspect.ts` correctly invoked
 * `applyStrictnessSeverity`. The multi-aspect `multi-aspect-validate-callback.ts`
 * did not, so the execution path used by `consolidated-validation-service`
 * (when `useRecordsMultiAspect === true`, which is the default) ignored
 * strictness for errors emitted by the aspect executors — errors kept their
 * 'error' severity even in compatibility mode.
 *
 * The fix wraps every aspect's issues in `applyStrictnessSeverity` before
 * they're pushed onto the collected aspects list. This test anchors that
 * behaviour without booting the full validator (which needs DB + profile
 * cache) — it exercises the callback with stub executors.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildMultiAspectValidateCallback } from '../multi-aspect-validate-callback';
import type { ValidationIssue } from '../../types';

// Mock the profile loader — we don't want real DB/profile-cache lookups.
vi.mock('../profile-loader-utils', () => ({
  loadProfileForValidation: vi.fn().mockResolvedValue({ id: 'stub', resourceType: 'StructureDefinition' }),
  loadProfileOrBase: vi.fn().mockResolvedValue({
    structureDef: { id: 'stub', resourceType: 'StructureDefinition' },
    declaredProfileUrl: 'http://test',
    usedBaseFallback: false,
  }),
  createProfileFallbackIssue: (profileUrl: string, resourceType: string) => ({
    id: `records-profile-not-resolved-stub`,
    aspect: 'profile' as const,
    severity: 'warning' as const,
    code: 'profile-not-resolved',
    message: `Profile ${profileUrl} could not be resolved; validated against base ${resourceType} instead`,
    path: 'meta.profile',
    timestamp: new Date(),
    details: { profile: profileUrl },
  }),
  createProfileResourceTypeMismatchIssue: vi.fn(),
}));

// Mock auxiliary validators — they run in addition to the executor issues,
// and we don't want their noise in this test.
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

const errorIssue: ValidationIssue = {
  severity: 'error',
  code: 'test-error',
  message: 'Test error from structural',
  path: 'Patient.name',
};

const warningIssue: ValidationIssue = {
  severity: 'warning',
  code: 'test-warning',
  message: 'Test warning from profile',
  path: 'Patient.gender',
};

function makeDeps() {
  // Each executor returns a single issue so we can track severity per aspect.
  return {
    sdLoader: {} as any,
    snapshotGenerator: {} as any,
    structuralExecutor: { validate: async () => [{ ...errorIssue }] } as any,
    profileExecutor: { validate: async () => [{ ...warningIssue }] } as any,
    terminologyExecutor: { validate: async () => [] } as any,
    referenceExecutor: { validate: async () => [] } as any,
    invariantExecutor: { validate: async () => [] } as any,
    customRuleExecutor: { validate: async () => [] } as any,
    metadataExecutor: { validate: async () => [] } as any,
    bestPracticeValidator: { validate: () => [] } as any,
    strictMode: false,
  };
}

describe('multi-aspect-validate-callback — strictness propagation', () => {
  it('standard strictness: severities unchanged', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps(),
      ['structural', 'profile'],
      { validationStrictness: 'standard', aspects: {} },
    );

    const result = await callback({ resourceType: 'Patient' }, 'http://test', 'R4');

    const structural = result.aspects.find(a => a.aspect === 'structural')!;
    const profile = result.aspects.find(a => a.aspect === 'profile')!;
    expect(structural.issues[0].severity).toBe('error');
    expect(profile.issues[0].severity).toBe('warning');
  });

  it('compatibility strictness: error → warning, warning → info', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps(),
      ['structural', 'profile'],
      { validationStrictness: 'compatibility', aspects: {} },
    );

    const result = await callback({ resourceType: 'Patient' }, 'http://test', 'R4');

    const structural = result.aspects.find(a => a.aspect === 'structural')!;
    const profile = result.aspects.find(a => a.aspect === 'profile')!;
    // Without the fix these would still be 'error' / 'warning'.
    expect(structural.issues[0].severity).toBe('warning');
    // downgradeSeverity returns 'info' for 'warning' — the schema accepts both aliases.
    expect(profile.issues[0].severity).toBe('info');
    // Downgraded error → warning should flip isValid to true (no errors left).
    expect(structural.isValid).toBe(true);
  });

  it('per-aspect severity cap applies on top of strictness', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps(),
      ['structural'],
      {
        validationStrictness: 'standard',
        aspects: { structural: { enabled: true, severity: 'warning' } },
      },
    );

    const result = await callback({ resourceType: 'Patient' }, 'http://test', 'R4');

    const structural = result.aspects.find(a => a.aspect === 'structural')!;
    // Strictness=standard (no change) + aspect cap=warning → error capped to warning.
    expect(structural.issues[0].severity).toBe('warning');
  });

  it('missing settings falls back to standard (no throw, no downgrade)', async () => {
    const callback = buildMultiAspectValidateCallback(
      makeDeps(),
      ['structural'],
      undefined,
    );

    const result = await callback({ resourceType: 'Patient' }, 'http://test', 'R4');

    const structural = result.aspects.find(a => a.aspect === 'structural')!;
    expect(structural.issues[0].severity).toBe('error');
  });
});
