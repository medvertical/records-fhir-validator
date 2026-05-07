/**
 * Unit tests for profile-loader-utils
 *
 * Tests the three-tier profile loading chain:
 *   L1 ProfileCache → L2 FHIR Client → L3 StructureDefinitionLoader
 * and snapshot generation when a profile only ships a differential.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadProfileWithSnapshot,
  loadProfileForValidation,
} from '../profile-loader-utils';
import type { StructureDefinition } from '../structure-definition-types';

// ============================================================================
// Helpers
// ============================================================================

function makeSD(overrides: Partial<StructureDefinition> = {}): StructureDefinition {
  return {
    resourceType: 'StructureDefinition',
    id: 'test-sd',
    url: 'http://example.org/StructureDefinition/TestProfile',
    name: 'TestProfile',
    status: 'active',
    kind: 'resource',
    abstract: false,
    type: 'Patient',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
    derivation: 'constraint',
    snapshot: { element: [{ id: 'Patient', path: 'Patient' }] },
    ...overrides,
  } as unknown as StructureDefinition;
}

function makeMocks() {
  const sdLoader = {
    loadProfile: vi.fn<[string, string], Promise<StructureDefinition | null>>(),
  };
  const profileCache = {
    get: vi.fn<[string], StructureDefinition | null>(),
    set: vi.fn<[string, StructureDefinition], void>(),
  };
  const snapshotGenerator = {
    generateSnapshot: vi.fn<[StructureDefinition], Promise<StructureDefinition['snapshot']['element'] | null>>(),
  };
  const fhirClient = {
    searchResources: vi.fn<[string, Record<string, string>, number?, Record<string, unknown>?], Promise<{ entry?: Array<{ resource: StructureDefinition }> }>>(),
  };
  return { sdLoader, profileCache, snapshotGenerator, fhirClient };
}

const PROFILE_URL = 'http://example.org/StructureDefinition/TestProfile';
const FHIR_VERSION = 'R4' as const;
const CACHE_KEY = `${PROFILE_URL}:${FHIR_VERSION}:snapshot`;

// ============================================================================
// loadProfileWithSnapshot
// ============================================================================

describe('loadProfileWithSnapshot', () => {
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('returns cached SD on cache hit (L1)', async () => {
    const sd = makeSD();
    mocks.profileCache.get.mockReturnValue(sd);

    const result = await loadProfileWithSnapshot(
      mocks.sdLoader as any,
      mocks.profileCache as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
    );

    expect(result).toBe(sd);
    expect(mocks.sdLoader.loadProfile).not.toHaveBeenCalled();
    expect(mocks.fhirClient.searchResources).not.toHaveBeenCalled();
  });

  it('falls through to loader (L3) on cache miss with no client', async () => {
    const sd = makeSD();
    mocks.profileCache.get.mockReturnValue(null);
    mocks.sdLoader.loadProfile.mockResolvedValue(sd);

    const result = await loadProfileWithSnapshot(
      mocks.sdLoader as any,
      mocks.profileCache as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
    );

    expect(result).toBe(sd);
    expect(mocks.sdLoader.loadProfile).toHaveBeenCalledWith(PROFILE_URL, FHIR_VERSION);
    // Profile already has a snapshot — no snapshot generation needed
    expect(mocks.snapshotGenerator.generateSnapshot).not.toHaveBeenCalled();
  });

  it('uses FHIR client (L2) when available before falling to loader', async () => {
    const clientSd = makeSD({ id: 'from-client' });
    mocks.profileCache.get.mockReturnValue(null);
    mocks.fhirClient.searchResources.mockResolvedValue({
      entry: [{ resource: clientSd }],
    });

    const result = await loadProfileWithSnapshot(
      mocks.sdLoader as any,
      mocks.profileCache as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
      mocks.fhirClient as any,
    );

    expect(result).toBe(clientSd);
    expect(mocks.sdLoader.loadProfile).not.toHaveBeenCalled();
  });

  it('does not load core FHIR StructureDefinitions from the target server', async () => {
    const coreUrl = 'http://hl7.org/fhir/StructureDefinition/Encounter';
    const loaderSd = makeSD({ id: 'r4-encounter', url: coreUrl, type: 'Encounter', fhirVersion: '4.0.1' } as any);
    mocks.profileCache.get.mockReturnValue(null);
    mocks.fhirClient.searchResources.mockResolvedValue({
      entry: [{ resource: makeSD({ id: 'r5-encounter-from-server', url: coreUrl, type: 'Encounter', fhirVersion: '5.0.0' } as any) }],
    });
    mocks.sdLoader.loadProfile.mockResolvedValue(loaderSd);

    const result = await loadProfileWithSnapshot(
      mocks.sdLoader as any,
      mocks.profileCache as any,
      mocks.snapshotGenerator as any,
      coreUrl,
      FHIR_VERSION,
      mocks.fhirClient as any,
    );

    expect(result).toBe(loaderSd);
    expect(mocks.fhirClient.searchResources).not.toHaveBeenCalled();
    expect(mocks.sdLoader.loadProfile).toHaveBeenCalledWith(coreUrl, FHIR_VERSION);
  });

  it('ignores FHIR client profiles from the wrong FHIR version', async () => {
    const r5ClientSd = makeSD({ id: 'from-client-r5', fhirVersion: '5.0.0' } as any);
    const r4LoaderSd = makeSD({ id: 'from-loader-r4', fhirVersion: '4.0.1' } as any);
    mocks.profileCache.get.mockReturnValue(null);
    mocks.fhirClient.searchResources.mockResolvedValue({
      entry: [{ resource: r5ClientSd }],
    });
    mocks.sdLoader.loadProfile.mockResolvedValue(r4LoaderSd);

    const result = await loadProfileWithSnapshot(
      mocks.sdLoader as any,
      mocks.profileCache as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
      mocks.fhirClient as any,
    );

    expect(result).toBe(r4LoaderSd);
    expect(mocks.sdLoader.loadProfile).toHaveBeenCalledWith(PROFILE_URL, FHIR_VERSION);
  });

  it('falls back to loader when FHIR client returns empty bundle', async () => {
    const loaderSd = makeSD({ id: 'from-loader' });
    mocks.profileCache.get.mockReturnValue(null);
    mocks.fhirClient.searchResources.mockResolvedValue({ entry: [] });
    mocks.sdLoader.loadProfile.mockResolvedValue(loaderSd);

    const result = await loadProfileWithSnapshot(
      mocks.sdLoader as any,
      mocks.profileCache as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
      mocks.fhirClient as any,
    );

    expect(result).toBe(loaderSd);
    expect(mocks.sdLoader.loadProfile).toHaveBeenCalled();
  });

  it('falls back to loader when FHIR client throws', async () => {
    const loaderSd = makeSD({ id: 'from-loader' });
    mocks.profileCache.get.mockReturnValue(null);
    mocks.fhirClient.searchResources.mockRejectedValue(new Error('Network error'));
    mocks.sdLoader.loadProfile.mockResolvedValue(loaderSd);

    const result = await loadProfileWithSnapshot(
      mocks.sdLoader as any,
      mocks.profileCache as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
      mocks.fhirClient as any,
    );

    expect(result).toBe(loaderSd);
  });

  it('returns null when all sources fail', async () => {
    mocks.profileCache.get.mockReturnValue(null);
    mocks.sdLoader.loadProfile.mockResolvedValue(null);

    const result = await loadProfileWithSnapshot(
      mocks.sdLoader as any,
      mocks.profileCache as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
    );

    expect(result).toBeNull();
  });

  it('generates snapshot when profile only has differential', async () => {
    const sdWithDiff = makeSD({
      snapshot: undefined,
      differential: { element: [{ id: 'Patient', path: 'Patient' }] },
    } as any);
    const generatedElements = [{ id: 'Patient', path: 'Patient' }];

    mocks.profileCache.get.mockReturnValue(null);
    mocks.sdLoader.loadProfile.mockResolvedValue(sdWithDiff);
    mocks.snapshotGenerator.generateSnapshot.mockResolvedValue(generatedElements as any);

    const result = await loadProfileWithSnapshot(
      mocks.sdLoader as any,
      mocks.profileCache as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
    );

    expect(result).not.toBeNull();
    expect(result!.snapshot).toEqual({ element: generatedElements });
    expect(mocks.profileCache.set).toHaveBeenCalledWith(CACHE_KEY, result);
  });

  it('caches profiles that already have snapshots', async () => {
    const sd = makeSD();
    mocks.profileCache.get.mockReturnValue(null);
    mocks.sdLoader.loadProfile.mockResolvedValue(sd);

    await loadProfileWithSnapshot(
      mocks.sdLoader as any,
      mocks.profileCache as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
    );

    expect(mocks.profileCache.set).toHaveBeenCalledWith(CACHE_KEY, sd);
  });
});

// ============================================================================
// loadProfileForValidation
// ============================================================================

describe('loadProfileForValidation', () => {
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('returns cached SD on cache hit', async () => {
    const sd = makeSD();
    mocks.profileCache.get.mockReturnValue(sd);

    const result = await loadProfileForValidation(
      mocks.sdLoader as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
      mocks.profileCache as any,
    );

    expect(result).toBe(sd);
    expect(mocks.sdLoader.loadProfile).not.toHaveBeenCalled();
  });

  it('works without a profile cache', async () => {
    const sd = makeSD();
    mocks.sdLoader.loadProfile.mockResolvedValue(sd);

    const result = await loadProfileForValidation(
      mocks.sdLoader as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
      // no profileCache
    );

    expect(result).toBe(sd);
  });

  it('returns null when profile not found anywhere', async () => {
    mocks.sdLoader.loadProfile.mockResolvedValue(null);

    const result = await loadProfileForValidation(
      mocks.sdLoader as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
    );

    expect(result).toBeNull();
  });

  it('generates snapshot for differential-only profile and returns null on failure', async () => {
    const sdWithDiff = makeSD({
      snapshot: undefined,
      differential: { element: [{ id: 'Patient', path: 'Patient' }] },
    } as any);

    mocks.sdLoader.loadProfile.mockResolvedValue(sdWithDiff);
    // Snapshot generation returns empty array → failure path
    mocks.snapshotGenerator.generateSnapshot.mockResolvedValue([] as any);

    const result = await loadProfileForValidation(
      mocks.sdLoader as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
    );

    expect(result).toBeNull();
  });

  it('uses FHIR client before loader', async () => {
    const clientSd = makeSD({ id: 'from-client' });
    mocks.fhirClient.searchResources.mockResolvedValue({
      entry: [{ resource: clientSd }],
    });

    const result = await loadProfileForValidation(
      mocks.sdLoader as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
      undefined,
      mocks.fhirClient as any,
    );

    expect(result).toBe(clientSd);
    expect(mocks.sdLoader.loadProfile).not.toHaveBeenCalled();
  });

  it('falls back to loader when FHIR client returns wrong FHIR version', async () => {
    const r5ClientSd = makeSD({ id: 'from-client-r5', fhirVersion: '5.0.0' } as any);
    const r4LoaderSd = makeSD({ id: 'from-loader-r4', fhirVersion: '4.0.1' } as any);
    mocks.fhirClient.searchResources.mockResolvedValue({
      entry: [{ resource: r5ClientSd }],
    });
    mocks.sdLoader.loadProfile.mockResolvedValue(r4LoaderSd);

    const result = await loadProfileForValidation(
      mocks.sdLoader as any,
      mocks.snapshotGenerator as any,
      PROFILE_URL,
      FHIR_VERSION,
      undefined,
      mocks.fhirClient as any,
    );

    expect(result).toBe(r4LoaderSd);
    expect(mocks.sdLoader.loadProfile).toHaveBeenCalledWith(PROFILE_URL, FHIR_VERSION);
  });
});
