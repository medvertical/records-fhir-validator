import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createProfileConformanceCheck } from '../multi-aspect-profile-conformance.js';
import type { MultiAspectDeps } from '../multi-aspect-dependencies.js';
import type { ValidateOneFn } from '../multi-aspect-types.js';

const profileUrl = 'http://example.test/StructureDefinition/completeness-Organization';
const incomplete = (code: string): ValidationIssue => ({
  id: code, aspect: 'profile', severity: 'information', code, message: code,
  details: { validationComplete: false },
});
const completed = (issues: ValidationIssue[] = []): Awaited<ReturnType<ValidateOneFn>> => ({
  isValid: !issues.some(issue => ['error', 'fatal'].includes(issue.severity)),
  aspects: [{ aspect: 'profile', issues, validationTime: 0, isValid: true }],
});
const scope = (validateOne: ValidateOneFn, onIncomplete: (issue: ValidationIssue) => void) => ({
  sdLoader: { loadProfile: async () => ({ url: profileUrl, type: 'Organization' }) } as unknown as MultiAspectDeps['sdLoader'],
  fhirVersion: 'R4' as const, recursionDepth: 0, validateOne, onIncomplete,
});

describe('profile conformance completeness reporting', () => {
  it.each(['terminology-codesystem-unverified', 'profile-slice-validation-incomplete'])(
    'reports %s as unknown information and retries before caching a completed verdict', async code => {
      const onIncomplete = vi.fn();
      const validateOne = vi.fn<ValidateOneFn>(async () => completed([incomplete(code)]));
      const check = createProfileConformanceCheck(scope(validateOne, onIncomplete))!;
      const resource = { resourceType: 'Organization' };
      await expect(check(resource, profileUrl)).resolves.toBeUndefined();
      expect(onIncomplete).toHaveBeenCalledWith(expect.objectContaining({
        code: 'profile-conformance-incomplete', severity: 'info',
        details: { validationComplete: false, profile: profileUrl, causes: [code] },
      }));
      validateOne.mockResolvedValue(completed());
      await expect(check(resource, profileUrl)).resolves.toBe(true);
      await expect(check(resource, profileUrl)).resolves.toBe(true);
      expect(validateOne).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['error', 'fatal'] as const)('retains independently proved %s with incomplete information', async severity => {
    const onIncomplete = vi.fn();
    const validateOne = vi.fn<ValidateOneFn>(async () => completed([
      { ...incomplete('structural-cardinality-min'), severity, details: undefined },
      incomplete('terminology-codesystem-unverified'),
    ]));
    const check = createProfileConformanceCheck(scope(validateOne, onIncomplete))!;
    await expect(check({ resourceType: 'Organization' }, profileUrl)).resolves.toBe(false);
    expect(onIncomplete).toHaveBeenCalledWith(expect.objectContaining({
      code: 'profile-conformance-incomplete', severity: 'info',
      details: expect.objectContaining({ validationComplete: false }),
    }));
  });

  it.each(['internal-error', 'validation-error'])(
    'preserves returned %s execution evidence as an error', async code => {
      const onIncomplete = vi.fn();
      const validateOne = vi.fn<ValidateOneFn>(async () => completed([
        { ...incomplete(code), severity: 'error' }, incomplete('terminology-codesystem-unverified'),
      ]));
      await expect(createProfileConformanceCheck(scope(validateOne, onIncomplete))!(
        { resourceType: 'Organization' }, profileUrl,
      )).resolves.toBeUndefined();
      expect(onIncomplete).toHaveBeenCalledWith(expect.objectContaining({
        code: 'validation-error', severity: 'error',
        details: expect.objectContaining({ validationComplete: false }),
      }));
    },
  );
});
