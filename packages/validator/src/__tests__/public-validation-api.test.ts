import { describe, expect, it, vi } from 'vitest';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  normalizeValidationRequests,
  validateAllResources,
  type PublicValidationDeps,
} from '../public-validation-api';

function patient(id: string): Record<string, unknown> {
  return { resourceType: 'Patient', id };
}

function issue(code: string): ValidationIssue {
  return {
    id: code,
    aspect: 'structural',
    severity: 'error',
    code,
    message: code,
    path: '',
    timestamp: new Date(),
  };
}

function makeDeps(): PublicValidationDeps & {
  validate: ReturnType<typeof vi.fn>;
  validateBatch: ReturnType<typeof vi.fn>;
} {
  return {
    validate: vi.fn(async () => []),
    validateBatch: vi.fn(async (resources: unknown[]) =>
      new Map(resources.map((resource) => [resource, []]))
    ),
  };
}

describe('public validation API helpers', () => {
  it.each([
    ['warning', true],
    ['information', true],
    ['error', false],
    ['fatal', false],
  ] as const)('derives validity from %s severity without dropping issues', async (severity, isValid) => {
    const resource = patient('severity');
    const finding = { ...issue('finding'), severity };
    const deps = makeDeps();
    deps.validateBatch.mockResolvedValue(new Map([[resource, [finding]]]));

    const [result] = await validateAllResources(deps, [resource]);

    expect(result).toMatchObject({ isValid, issues: [finding] });
  });

  it('normalizes raw resources and request wrappers with default options', () => {
    const raw = patient('raw');
    const wrapped = { resource: patient('wrapped'), profileUrl: 'http://example.org/Profile' };

    const requests = normalizeValidationRequests([raw, wrapped], { fhirVersion: 'R4B' });

    expect(requests[0]).toMatchObject({ resource: raw, fhirVersion: 'R4B' });
    expect(requests[1]).toMatchObject({
      resource: wrapped.resource,
      profileUrl: 'http://example.org/Profile',
      fhirVersion: 'R4B',
    });
  });

  it('uses batch validation for homogeneous inputs and preserves input order', async () => {
    const first = patient('a');
    const second = patient('b');
    const secondIssue = issue('second-error');
    const deps = makeDeps();
    deps.validateBatch.mockResolvedValue(new Map([
      [first, []],
      [second, [secondIssue]],
    ]));

    const results = await validateAllResources(deps, [first, second], {
      fhirVersion: 'R4B',
      profileUrl: 'http://example.org/Profile',
      maxConcurrency: 2,
    });

    expect(deps.validateBatch).toHaveBeenCalledWith(
      [first, second],
      expect.objectContaining({
        fhirVersion: 'R4',
        profileUrl: 'http://example.org/Profile',
        maxConcurrency: 2,
      }),
      expect.objectContaining({
        publicVersion: 'R4B',
        corePackage: 'hl7.fhir.r4b.core#4.3.0',
      }),
    );
    expect(deps.validate).not.toHaveBeenCalled();
    expect(results.map((result) => result.index)).toEqual([0, 1]);
    expect(results[0]).toMatchObject({ resourceType: 'Patient', id: 'a', isValid: true });
    expect(results[1]).toMatchObject({ resourceType: 'Patient', id: 'b', isValid: false });
    expect(results[1].issues).toEqual([secondIssue]);
  });

  it('validates individually when per-item profile settings differ', async () => {
    const deps = makeDeps();
    const first = { resource: patient('a'), profileUrl: 'http://example.org/A' };
    const second = { resource: patient('b'), profileUrl: 'http://example.org/B', fhirVersion: 'R5' as const };

    const results = await validateAllResources(deps, [first, second], { maxConcurrency: 1 });

    expect(deps.validateBatch).not.toHaveBeenCalled();
    expect(deps.validate).toHaveBeenCalledTimes(2);
    expect(deps.validate).toHaveBeenNthCalledWith(
      1,
      first.resource,
      'http://example.org/A',
      expect.objectContaining({ publicVersion: 'R4', engineVersion: 'R4' }),
      undefined,
      undefined,
    );
    expect(deps.validate).toHaveBeenNthCalledWith(
      2,
      second.resource,
      'http://example.org/B',
      expect.objectContaining({ publicVersion: 'R5', engineVersion: 'R5' }),
      undefined,
      undefined,
    );
    expect(results.map((result) => result.id)).toEqual(['a', 'b']);
  });

  it('can return per-resource execution errors when continueOnError is enabled', async () => {
    const deps = makeDeps();
    deps.validate.mockImplementation(async (resource: unknown) => {
      if ((resource as { id?: string }).id === 'bad') {
        throw new Error('boom');
      }
      return [];
    });

    const results = await validateAllResources(deps, [
      { resource: patient('good'), profileUrl: 'http://example.org/A' },
      { resource: patient('bad'), profileUrl: 'http://example.org/B' },
    ], { continueOnError: true });

    expect(results[0]).toMatchObject({ id: 'good', isValid: true });
    expect(results[1]).toMatchObject({ id: 'bad', isValid: false });
    expect(results[1].issues[0]).toMatchObject({
      aspect: 'general',
      severity: 'error',
      code: 'validation-execution-error',
      message:
        'Validation could not be completed because the validator encountered an operational error.',
    });
    expect(JSON.stringify(results[1].issues)).not.toContain('boom');
  });

  it('handles hostile non-Error throw values and keeps fallback IDs stable', async () => {
    const thrown = {
      toString() {
        throw new Error('string conversion failed');
      },
    };
    const deps = makeDeps();
    deps.validateBatch.mockRejectedValue(new Error('batch failed'));
    deps.validate.mockRejectedValue(thrown);
    const input = [{
      resource: patient('bad'),
      profileUrl: 'http://example.org/A',
    }];

    const first = await validateAllResources(deps, input, { continueOnError: true });
    const second = await validateAllResources(deps, input, { continueOnError: true });

    expect(first[0]?.issues[0]).toMatchObject({
      code: 'validation-execution-error',
      message:
        'Validation could not be completed because the validator encountered an operational error.',
      details: {
        inputIndex: 0,
      },
    });
    expect(first[0]?.issues[0]?.id).toBe(second[0]?.issues[0]?.id);
  });

  it('falls back to individual validation when a batch omits an input result', async () => {
    const first = patient('a');
    const second = patient('b');
    const deps = makeDeps();
    deps.validateBatch.mockResolvedValue(new Map([[first, []]]));

    const results = await validateAllResources(deps, [first, second], {
      continueOnError: true,
    });

    expect(deps.validateBatch).toHaveBeenCalledOnce();
    expect(deps.validate).toHaveBeenCalledTimes(2);
    expect(results.map(result => result.id)).toEqual(['a', 'b']);
    expect(results.every(result => result.isValid)).toBe(true);
  });

  it('rejects malformed batch results instead of marking resources valid', async () => {
    const resource = patient('a');
    const deps = makeDeps();
    deps.validateBatch.mockResolvedValue(new Map([[resource, { issues: [] }]]));

    await expect(validateAllResources(deps, [resource])).rejects.toThrow(
      'Batch validation returned a malformed issue list',
    );
  });
});
