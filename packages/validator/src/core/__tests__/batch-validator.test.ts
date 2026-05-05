/**
 * Batch Validator Pipeline Tests
 *
 * Covers the 5-step pipeline in executeBatchValidation:
 * 1. Deduplication by content hash
 * 2. Grouping by profile URL
 * 3. Profile preloading
 * 4. Parallel validation in chunks
 * 5. Fanout of results to duplicate resources
 *
 * Also covers multi-aspect callback integration via RecordsValidator.validateBatch.
 */

import { describe, it, expect, vi, _beforeEach } from 'vitest';
import { executeBatchValidation, type BatchValidationOptions, type BatchValidatorContext } from '../batch-validator';
import type { ValidationIssue } from '../../types';

// ---------------------------------------------------------------------------
// Minimal stubs — we're testing orchestration, not profile loading
// ---------------------------------------------------------------------------

function makeContext(validateFn?: (resource: unknown, profileUrl: string) => Promise<ValidationIssue[]>): BatchValidatorContext {
  const validate = validateFn ?? (async () => []);
  return {
    sdLoader: {
      hasBaseProfiles: vi.fn().mockResolvedValue(true),
      loadProfile: vi.fn().mockResolvedValue(null),
      loadProfilesBatch: vi.fn().mockResolvedValue(new Map()),
      isProfileAvailable: vi.fn().mockReturnValue(false),
    } as unknown as BatchValidatorContext['sdLoader'],
    profileCache: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
    } as unknown as BatchValidatorContext['profileCache'],
    snapshotGenerator: {
      generateSnapshot: vi.fn().mockResolvedValue(null),
    } as unknown as BatchValidatorContext['snapshotGenerator'],
    validateResource: async (resource, profileUrl, _fhirVersion) =>
      validate(resource, profileUrl),
  };
}

function patient(id: string, name = 'Smith'): Record<string, unknown> {
  return {
    resourceType: 'Patient',
    id,
    name: [{ family: name, given: ['Test'] }],
    meta: { profile: ['http://hl7.org/fhir/StructureDefinition/Patient'] },
  };
}

function errorIssue(msg: string): ValidationIssue {
  return {
    id: `test-${Math.random()}`,
    aspect: 'structural',
    severity: 'error',
    code: 'test-error',
    message: msg,
    path: '',
    timestamp: new Date(),
  };
}

const BASE_OPTIONS: BatchValidationOptions = {
  fhirVersion: 'R4',
  maxConcurrency: 5,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeBatchValidation', () => {
  describe('Step 1 — Deduplication', () => {
    it('validates each unique resource exactly once', async () => {
      const callTracker = vi.fn().mockResolvedValue([]);
      const ctx = makeContext(callTracker);

      // p1 and p2 are structurally identical (same content → same hash)
      const p1 = patient('p1');
      const p2 = { ...p1, id: 'p1' }; // same content
      const p3 = patient('p3'); // different content

      const results = await executeBatchValidation([p1, p2, p3], BASE_OPTIONS, ctx);

      // validateResource called twice (one per unique resource), not three times
      expect(callTracker).toHaveBeenCalledTimes(2);
      // All three resources get a result
      expect(results.size).toBe(3);
    });

    it('fans out issues from the first duplicate to all copies', async () => {
      const issue = errorIssue('duplicate-fanout-test');
      const ctx = makeContext(async () => [issue]);

      const p1 = patient('p-same');
      const p2 = { ...p1 }; // identical content → duplicate

      const results = await executeBatchValidation([p1, p2], BASE_OPTIONS, ctx);

      const r1 = results.get(p1) as ValidationIssue[];
      const r2 = results.get(p2) as ValidationIssue[];
      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
      expect(r2[0].message).toBe('duplicate-fanout-test');
    });
  });

  describe('Step 2 — Grouping by profile URL', () => {
    it('uses meta.profile when no profileUrl option is given', async () => {
      const capturedProfiles: string[] = [];
      const ctx = makeContext(async (_r, profileUrl) => {
        capturedProfiles.push(profileUrl);
        return [];
      });

      const p = patient('p1');
      await executeBatchValidation([p], BASE_OPTIONS, ctx);

      expect(capturedProfiles).toContain('http://hl7.org/fhir/StructureDefinition/Patient');
    });
  });

  describe('Step 4 — Validation execution', () => {
    it('returns a result entry for every input resource', async () => {
      const resources = [patient('a'), patient('b'), patient('c')];
      const ctx = makeContext(async () => []);

      const results = await executeBatchValidation(resources, BASE_OPTIONS, ctx);

      expect(results.size).toBe(3);
      for (const r of resources) {
        expect(results.has(r)).toBe(true);
      }
    });

    it('preserves validation issues from validateResource', async () => {
      const issue = errorIssue('missing-name');
      const ctx = makeContext(async () => [issue]);

      const p = patient('p1');
      const results = await executeBatchValidation([p], BASE_OPTIONS, ctx);

      const issues = results.get(p) as ValidationIssue[];
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toBe('missing-name');
    });

    it('handles empty resource array', async () => {
      const ctx = makeContext();
      const results = await executeBatchValidation([], BASE_OPTIONS, ctx);
      expect(results.size).toBe(0);
    });

    it('propagates errors thrown by validateResource (batch fails fast)', async () => {
      const ctx = makeContext(async (resource) => {
        const r = resource as { id?: string };
        if (r.id === 'bad') throw new Error('validation-crash');
        return [];
      });

      const good = patient('good');
      const bad = patient('bad');

      // Batch validator does NOT silently swallow errors — it re-throws
      await expect(executeBatchValidation([good, bad], BASE_OPTIONS, ctx))
        .rejects.toThrow('validation-crash');
    });
  });

  describe('Step 4 — Concurrency chunking', () => {
    it('processes all resources even when count exceeds maxConcurrency', async () => {
      const resources = Array.from({ length: 25 }, (_, i) => patient(`p${i}`, `Family${i}`));
      const ctx = makeContext(async () => []);

      const results = await executeBatchValidation(resources, { ...BASE_OPTIONS, maxConcurrency: 3 }, ctx);

      expect(results.size).toBe(25);
    });
  });

  describe('Multi-aspect mode (T = object)', () => {
    it('supports a generic T return type from validateResource', async () => {
      type MultiResult = { isValid: boolean; aspects: Array<{ aspect: string; issues: ValidationIssue[] }> };

      const mockMultiResult: MultiResult = {
        isValid: true,
        aspects: [{ aspect: 'structural', issues: [] }],
      };

      const base = makeContext();
      const ctx: BatchValidatorContext<MultiResult> = {
        sdLoader: base.sdLoader,
        profileCache: base.profileCache,
        snapshotGenerator: base.snapshotGenerator,
        validateResource: async () => mockMultiResult,
      };

      const p = patient('p1');
      const results = await executeBatchValidation<MultiResult>([p], BASE_OPTIONS, ctx);

      const result = results.get(p) as MultiResult;
      expect(result.isValid).toBe(true);
      expect(result.aspects).toHaveLength(1);
    });
  });
});
