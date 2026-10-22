import { afterEach, describe, expect, it } from 'vitest';

import { resolveRecordsValidatorConfig } from './validator-engine-config';

describe('validator engine cache capacity', () => {
  afterEach(() => {
    delete process.env.VALIDATOR_PROFILE_CACHE_MAX_ENTRIES;
  });

  it('uses a bounded profile cache by default', () => {
    expect(resolveRecordsValidatorConfig({}).profileCacheMaxEntries).toBe(192);
  });

  it('allows deployments to tune the profile cache bound', () => {
    process.env.VALIDATOR_PROFILE_CACHE_MAX_ENTRIES = '96';
    expect(resolveRecordsValidatorConfig({}).profileCacheMaxEntries).toBe(96);
  });

  it('prewarms the shared profile source by default', () => {
    expect(resolveRecordsValidatorConfig({}).prewarmProfileSource).toBe(true);
  });

  it('allows scoped validators to skip eager profile-source loading', () => {
    expect(resolveRecordsValidatorConfig({ prewarmProfileSource: false }).prewarmProfileSource)
      .toBe(false);
  });

  it('keeps package discovery eager unless an on-demand source is explicitly configured', () => {
    expect(resolveRecordsValidatorConfig({}).preloadPackageInventory).toBe(true);
    expect(resolveRecordsValidatorConfig({ preloadPackageInventory: false }).preloadPackageInventory).toBe(false);
  });
});
