/**
 * Regression coverage for the multi-aspect invariant execution context.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildMultiAspectValidateCallback } from '../multi-aspect-validate-callback';
import type { ValidationIssue } from '../../types';

vi.mock('../profile-loader-utils', () => ({
  loadProfileOrBase: vi.fn().mockResolvedValue({
    structureDef: { id: 'stub', resourceType: 'StructureDefinition' },
    declaredProfileUrl: 'http://test',
    usedBaseFallback: false,
  }),
  createProfileFallbackIssue: vi.fn(),
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
vi.mock('../validators/terminology-resource-validator', () => ({
  terminologyResourceValidator: { validate: () => [] },
}));

const structuralIssue: ValidationIssue = {
  severity: 'error',
  code: 'structural-cardinality-min',
  message: 'Missing required field',
  path: 'Patient.name',
};

const profileIssue: ValidationIssue = {
  severity: 'error',
  code: 'profile-max-value-duration-violation',
  message: 'Birth date exceeds profile maximum',
  path: 'Patient.birthDate',
};

const terminologyIssue: ValidationIssue = {
  severity: 'warning',
  code: 'binding-required-missing',
  message: 'Required binding missing',
  path: 'Patient.gender',
};

function makeDeps(invariantExecutor: { validate: ReturnType<typeof vi.fn> }) {
  return {
    sdLoader: {} as any,
    snapshotGenerator: {} as any,
    structuralExecutor: { validate: async () => [{ ...structuralIssue }] } as any,
    profileExecutor: { validate: async () => [{ ...profileIssue }] } as any,
    terminologyExecutor: { validate: async () => [{ ...terminologyIssue }] } as any,
    referenceExecutor: { validate: async () => [] } as any,
    invariantExecutor: invariantExecutor as any,
    customRuleExecutor: { validate: async () => [] } as any,
    metadataExecutor: { validate: async () => [] } as any,
    bestPracticeValidator: { validate: () => [] } as any,
    strictMode: false,
  };
}

describe('multi-aspect-validate-callback - invariant context', () => {
  it('passes structural, profile, and terminology issues into InvariantExecutor', async () => {
    const invariantExecutor = {
      validate: vi.fn().mockResolvedValue([]),
    };
    const callback = buildMultiAspectValidateCallback(
      makeDeps(invariantExecutor),
      ['structural', 'profile', 'terminology', 'invariant', 'reference', 'metadata'],
      { validationStrictness: 'standard', aspects: {} },
    );

    await callback({ resourceType: 'Patient' }, 'http://test', 'R4');

    expect(invariantExecutor.validate).toHaveBeenCalledTimes(1);
    const context = invariantExecutor.validate.mock.calls[0][0] as {
      existingIssues?: ValidationIssue[];
    };
    expect(context.existingIssues?.map(issue => issue.code).sort()).toEqual([
      'binding-required-missing',
      'profile-max-value-duration-violation',
      'structural-cardinality-min',
    ]);
  });
});
