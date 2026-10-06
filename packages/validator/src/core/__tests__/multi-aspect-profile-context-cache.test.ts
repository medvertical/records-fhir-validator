import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createProfileConformanceCheck } from '../multi-aspect-profile-conformance.js';
import { createValidationErrorIssue, createValidationInfoIssue } from '../core-validation-issue.js';
import type { MultiAspectDeps } from '../multi-aspect-dependencies.js';
import type { ValidateOneFn } from '../multi-aspect-types.js';

const profileUrl = 'https://example.test/StructureDefinition/ScopedPatient';
const sdLoader = { loadProfile: vi.fn(async () => ({ url: profileUrl, type: 'Patient' })) } as unknown as MultiAspectDeps['sdLoader'];
const resource = () => ({ resourceType: 'Patient', id: 'synthetic-shared' });
const failed = () => createValidationErrorIssue('profile', 'structural-cardinality-min', 'Synthetic required field.');
const report = (issues: ValidationIssue[] = []) => ({ isValid: !issues.some(issue => ['error', 'fatal'].includes(issue.severity)),
  aspects: [{ aspect: 'profile', issues, validationTime: 0, isValid: !issues.some(issue => ['error', 'fatal'].includes(issue.severity)) }] });
const scope = (validateOne: ValidateOneFn) => ({ sdLoader, validateOne, fhirVersion: 'R4' as const, recursionDepth: 0 });

describe('profile verdicts retain their enclosing reference scope', () => {
  it.each(['enclosingBundle', 'containingResource'] as const)('does not reuse false in another %s with the same id', async field => {
    const validateOne = vi.fn<ValidateOneFn>().mockResolvedValueOnce(report([failed()])).mockResolvedValueOnce(report());
    const patient = resource();
    const first = { resourceType: 'Bundle', id: 'same-id' };
    const second = { resourceType: 'Bundle', id: 'same-id' };
    await expect(createProfileConformanceCheck({ ...scope(validateOne), [field]: first })!(patient, profileUrl)).resolves.toBe(false);
    await expect(createProfileConformanceCheck({ ...scope(validateOne), [field]: second })!(patient, profileUrl)).resolves.toBe(true);
    expect(validateOne).toHaveBeenCalledTimes(2);
  });

  it.each(['enclosingBundle', 'containingResource'] as const)('does not reuse true in another %s with the same id', async field => {
    const validateOne = vi.fn<ValidateOneFn>().mockResolvedValueOnce(report()).mockResolvedValueOnce(report([failed()]));
    const patient = resource();
    await expect(createProfileConformanceCheck({ ...scope(validateOne), [field]: { id: 'same-id' } })!(patient, profileUrl)).resolves.toBe(true);
    await expect(createProfileConformanceCheck({ ...scope(validateOne), [field]: { id: 'same-id' } })!(patient, profileUrl)).resolves.toBe(false);
    expect(validateOne).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('reuses the completed %s verdict for the same contextual objects', async verdict => {
    const validateOne = vi.fn<ValidateOneFn>(async () => report(verdict ? [] : [failed()]));
    const patient = resource();
    const context = { ...scope(validateOne), enclosingBundle: { id: 'bundle' }, containingResource: { id: 'container' } };
    await expect(createProfileConformanceCheck(context)!(patient, profileUrl)).resolves.toBe(verdict);
    await expect(createProfileConformanceCheck({ ...context })!(patient, profileUrl)).resolves.toBe(verdict);
    expect(validateOne).toHaveBeenCalledTimes(1);
  });

  it('rechecks unknown evidence before caching recovered complete evidence in the same scope', async () => {
    const unknown = createValidationInfoIssue('profile', 'profile-conformance-incomplete', 'Unknown dependency.', { validationComplete: false });
    const validateOne = vi.fn<ValidateOneFn>().mockResolvedValueOnce(report([unknown])).mockResolvedValue(report());
    const onIncomplete = vi.fn();
    const patient = resource();
    const context = { ...scope(validateOne), enclosingBundle: { id: 'bundle' }, onIncomplete };
    await expect(createProfileConformanceCheck(context)!(patient, profileUrl)).resolves.toBeUndefined();
    await expect(createProfileConformanceCheck(context)!(patient, profileUrl)).resolves.toBe(true);
    await expect(createProfileConformanceCheck(context)!(patient, profileUrl)).resolves.toBe(true);
    expect(validateOne).toHaveBeenCalledTimes(2);
    expect(onIncomplete).toHaveBeenCalledTimes(1);
  });

  it('retains an independent fatal beside unknown evidence without caching the incomplete verdict', async () => {
    const unknown = createValidationInfoIssue('profile', 'profile-conformance-incomplete', 'Unknown dependency.', { validationComplete: false });
    const fatal = { ...failed(), severity: 'fatal' as const };
    const validateOne = vi.fn<ValidateOneFn>(async () => report([fatal, unknown]));
    const patient = resource();
    const context = { ...scope(validateOne), containingResource: { id: 'container' } };
    await expect(createProfileConformanceCheck(context)!(patient, profileUrl)).resolves.toBe(false);
    await expect(createProfileConformanceCheck(context)!(patient, profileUrl)).resolves.toBe(false);
    expect(validateOne).toHaveBeenCalledTimes(2);
  });

  it('keeps context-free calls in the same session cache', async () => {
    const validateOne = vi.fn<ValidateOneFn>(async () => report());
    const patient = resource();
    await expect(createProfileConformanceCheck(scope(validateOne))!(patient, profileUrl)).resolves.toBe(true);
    await expect(createProfileConformanceCheck(scope(validateOne))!(patient, profileUrl)).resolves.toBe(true);
    expect(validateOne).toHaveBeenCalledTimes(1);
  });
});
