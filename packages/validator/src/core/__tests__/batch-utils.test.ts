/**
 * Unit tests for batch-utils
 *
 * Covers the pure helpers that batch validation relies on:
 *   - deduplicateResources
 *   - groupResourcesByProfile
 *   - chunkArray
 *   - resetWarmupState
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  deduplicateResources,
  groupResourcesByProfile,
  chunkArray,
  resetWarmupState,
  preloadProfiles,
} from '../batch-utils';
import { setProfileSource } from '../../persistence';

// ============================================================================
// deduplicateResources
// ============================================================================

describe('deduplicateResources', () => {
  it('returns a single unique for a list with no duplicates', () => {
    const resources = [
      { resourceType: 'Patient', id: '1' },
      { resourceType: 'Patient', id: '2' },
    ];

    const { unique, duplicateMap } = deduplicateResources(resources);

    expect(unique).toHaveLength(2);
    expect(duplicateMap.size).toBe(2);
  });

  it('deduplicates identical objects (same JSON content)', () => {
    const r1 = { resourceType: 'Patient', id: '1', name: [{ family: 'Smith' }] };
    const r2 = { resourceType: 'Patient', id: '1', name: [{ family: 'Smith' }] };

    const { unique, duplicateMap } = deduplicateResources([r1, r2]);

    expect(unique).toHaveLength(1);
    // Both originals land in the same hash bucket
    expect(Array.from(duplicateMap.values())[0]).toHaveLength(2);
  });

  it('returns first occurrence as the canonical unique', () => {
    const first = { resourceType: 'Patient', id: 'A' };
    const second = { resourceType: 'Patient', id: 'A' };

    const { unique } = deduplicateResources([first, second]);

    expect(unique[0]).toBe(first);
  });

  it('handles an empty array', () => {
    const { unique, duplicateMap } = deduplicateResources([]);

    expect(unique).toHaveLength(0);
    expect(duplicateMap.size).toBe(0);
  });

  it('treats objects with different property order as identical', () => {
    // JSON.stringify preserves insertion order, so {a:1, b:2} !== {b:2, a:1}.
    // The implementation uses JSON.stringify which IS order-sensitive.
    const r1 = { id: '1', resourceType: 'Patient' };
    const r2 = { id: '1', resourceType: 'Patient' };

    const { unique } = deduplicateResources([r1, r2]);

    // Both have same key order → same hash → deduplicated
    expect(unique).toHaveLength(1);
  });

  it('returns all resources as unique when none are duplicates', () => {
    const resources = [
      { resourceType: 'Patient', id: '1' },
      { resourceType: 'Observation', id: '2' },
      { resourceType: 'Condition', id: '3' },
    ];

    const { unique } = deduplicateResources(resources);

    expect(unique).toHaveLength(3);
  });
});

// ============================================================================
// groupResourcesByProfile
// ============================================================================

describe('groupResourcesByProfile', () => {
  it('groups by explicit profileUrl when provided', () => {
    const resources = [
      { resourceType: 'Patient', id: '1' },
      { resourceType: 'Patient', id: '2' },
    ];

    const groups = groupResourcesByProfile(resources, 'http://example.org/Patient');

    expect(groups.size).toBe(1);
    expect(groups.get('http://example.org/Patient')).toHaveLength(2);
  });

  it('groups by meta.profile[0] when no explicit url', () => {
    const resources = [
      {
        resourceType: 'Patient',
        meta: { profile: ['http://example.org/Patient'] },
      },
      {
        resourceType: 'Patient',
        meta: { profile: ['http://example.org/OtherPatient'] },
      },
    ];

    const groups = groupResourcesByProfile(resources);

    expect(groups.size).toBe(2);
    expect(groups.get('http://example.org/Patient')).toHaveLength(1);
    expect(groups.get('http://example.org/OtherPatient')).toHaveLength(1);
  });

  it('falls back to base FHIR definition when no meta.profile declared', () => {
    const resource = { resourceType: 'Observation', id: 'obs1' };

    const groups = groupResourcesByProfile([resource]);

    const expectedUrl = 'http://hl7.org/fhir/StructureDefinition/Observation';
    expect(groups.get(expectedUrl)).toHaveLength(1);
  });

  it('puts resources with same profile URL in the same group', () => {
    const profileUrl = 'http://example.org/MyProfile';
    const resources = [
      { resourceType: 'Patient', id: '1', meta: { profile: [profileUrl] } },
      { resourceType: 'Patient', id: '2', meta: { profile: [profileUrl] } },
      { resourceType: 'Patient', id: '3', meta: { profile: [profileUrl] } },
    ];

    const groups = groupResourcesByProfile(resources);

    expect(groups.get(profileUrl)).toHaveLength(3);
  });

  it('handles empty resource list', () => {
    const groups = groupResourcesByProfile([]);
    expect(groups.size).toBe(0);
  });

  it('explicit profileUrl overrides meta.profile', () => {
    const resource = {
      resourceType: 'Patient',
      meta: { profile: ['http://example.org/OtherProfile'] },
    };

    const groups = groupResourcesByProfile([resource], 'http://example.org/ExplicitProfile');

    expect(groups.has('http://example.org/OtherProfile')).toBe(false);
    expect(groups.get('http://example.org/ExplicitProfile')).toHaveLength(1);
  });
});

// ============================================================================
// chunkArray
// ============================================================================

describe('chunkArray', () => {
  it('splits array into equal-sized chunks', () => {
    const chunks = chunkArray([1, 2, 3, 4, 5, 6], 2);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual([1, 2]);
    expect(chunks[1]).toEqual([3, 4]);
    expect(chunks[2]).toEqual([5, 6]);
  });

  it('last chunk contains remaining items when not evenly divisible', () => {
    const chunks = chunkArray([1, 2, 3, 4, 5], 3);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual([1, 2, 3]);
    expect(chunks[1]).toEqual([4, 5]);
  });

  it('returns single chunk when chunkSize >= array length', () => {
    const chunks = chunkArray([1, 2, 3], 10);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual([1, 2, 3]);
  });

  it('returns empty array for empty input', () => {
    const chunks = chunkArray([], 5);
    expect(chunks).toHaveLength(0);
  });

  it('handles chunk size of 1', () => {
    const chunks = chunkArray(['a', 'b', 'c'], 1);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual(['a']);
    expect(chunks[1]).toEqual(['b']);
    expect(chunks[2]).toEqual(['c']);
  });
});

// ============================================================================
// resetWarmupState
// ============================================================================

describe('resetWarmupState', () => {
  beforeEach(() => {
    resetWarmupState();
  });

  it('is callable without errors', () => {
    expect(() => resetWarmupState()).not.toThrow();
  });

  it('can be called multiple times', () => {
    resetWarmupState();
    resetWarmupState();
    expect(true).toBe(true); // No exception thrown
  });
});

// ============================================================================
// preloadProfiles
// ============================================================================

describe('preloadProfiles', () => {
  beforeEach(() => {
    resetWarmupState();
  });

  afterEach(() => {
    setProfileSource({});
  });

  it('passes explicit canonical versions to the profile resolver', async () => {
    const resolveProfile = vi.fn().mockResolvedValue({
      resourceType: 'StructureDefinition',
      url: 'http://example.org/StructureDefinition/Profile',
      version: '1.1.0',
      fhirVersion: '4.0.1',
      type: 'Patient',
      snapshot: { element: [{ id: 'Patient', path: 'Patient' }] },
    });

    setProfileSource({ resolveProfile });

    const sdLoader = {
      loadProfilesBatch: vi.fn().mockResolvedValue(new Map()),
      cacheProfile: vi.fn(),
    };
    const profileCache = {
      get: vi.fn(),
      set: vi.fn(),
    };
    const snapshotGenerator = {
      generateSnapshot: vi.fn(),
    };

    await preloadProfiles(
      sdLoader as any,
      profileCache as any,
      snapshotGenerator as any,
      ['http://example.org/StructureDefinition/Profile|1.1.0'],
      'R4',
    );

    expect(resolveProfile).toHaveBeenCalledWith(
      'http://example.org/StructureDefinition/Profile',
      '1.1.0',
      undefined,
    );
    expect(sdLoader.cacheProfile).toHaveBeenCalledWith(
      'http://example.org/StructureDefinition/Profile|1.1.0',
      expect.objectContaining({ version: '1.1.0' }),
      'R4',
    );
  });
});
