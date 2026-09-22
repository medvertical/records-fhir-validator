/**
 * Compatibility surface for batch helpers. Production callers should import
 * the focused resource-planning, profile-preloading, or warmup module.
 */
export {
  chunkArray,
  deduplicateResources,
  groupResourcesByProfile,
  type DeduplicationResult,
} from './batch-resource-planning.js';
export { preloadProfiles } from './profile-batch-preloader.js';
export {
  resetWarmupState,
  warmupProfileCacheFromDatabase,
} from './profile-cache-warmup.js';
