import { describe, expect, it, vi } from 'vitest';

import { ValidatorProfileAdministration } from './validator-profile-administration';

describe('ValidatorProfileAdministration', () => {
  it('clears loader, resolved-profile, and generated-snapshot caches together', () => {
    const sdLoader = { clearCache: vi.fn() };
    const profileCache = { clear: vi.fn() };
    const snapshotGenerator = { clearCache: vi.fn() };
    const administration = new ValidatorProfileAdministration(
      sdLoader as any,
      profileCache as any,
      snapshotGenerator as any,
    );

    administration.clearProfileCache();

    expect(sdLoader.clearCache).toHaveBeenCalledOnce();
    expect(profileCache.clear).toHaveBeenCalledOnce();
    expect(snapshotGenerator.clearCache).toHaveBeenCalledOnce();
  });
});
