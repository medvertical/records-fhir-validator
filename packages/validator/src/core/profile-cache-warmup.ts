import type { ProfileCache } from '../cache/profile-cache.js';
import { logger } from '../logger.js';
import { getProfileSource, type ProfileSourceContext } from '../persistence/index.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { ProfileWarmupCoordinator } from './profile-warmup-coordinator.js';

/** @deprecated Reset the owning validator's coordinator through its administration API. */
export function resetWarmupState(
  coordinator: ProfileWarmupCoordinator = new ProfileWarmupCoordinator(),
): ProfileWarmupCoordinator {
  coordinator.reset();
  return coordinator;
}

/** Pre-load recently resolved profiles from the host's persistence source. */
export async function warmupProfileCacheFromDatabase(
  profileCache: ProfileCache,
  limit: number = 300,
  context?: ProfileSourceContext,
): Promise<{ warmedUp: number; timeMs: number }> {
  const startTime = Date.now();
  const source = getProfileSource();
  if (!source.warmupRecent) {
    return { warmedUp: 0, timeMs: Date.now() - startTime };
  }

  try {
    const result = await source.warmupRecent(
      (cacheKey, sd) => profileCache.set(cacheKey, sd),
      (cacheKey) => profileCache.get(cacheKey),
      limit,
      context,
    );
    logger.info(`[Warmup] ✅ Pre-loaded ${result.warmedUp} profiles into memory cache in ${result.timeMs}ms`);
    return result;
  } catch (error: unknown) {
    logger.warn('[Warmup] Failed to warm up profile cache', validationFailureMetadata(error));
    return { warmedUp: 0, timeMs: Date.now() - startTime };
  }
}
