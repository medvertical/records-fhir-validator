import type { ProfileCache } from '../cache/profile-cache.js';
import { logger } from '../logger.js';
import { getProfileSource, type ProfileSourceContext } from '../persistence/index.js';
import type { ValidationSettings } from '@records-fhir/validation-types';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { chunkArray } from './batch-resource-planning.js';
import { warmupProfileCacheFromDatabase } from './profile-cache-warmup.js';
import type { FhirClientLike } from './profile-loader-utils.js';
import type { ProfileWarmupCoordinator } from './profile-warmup-coordinator.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { StructureDefinition } from './structure-definition-types.js';

function splitVersionedCanonical(url: string): { canonicalUrl: string; version?: string } {
  const [canonicalUrl, version] = url.split('|');
  return version ? { canonicalUrl, version } : { canonicalUrl };
}

function isCoreStructureDefinition(url: string): boolean {
  return splitVersionedCanonical(url).canonicalUrl.startsWith(
    'http://hl7.org/fhir/StructureDefinition/',
  );
}

function profileMatchesRequest(
  profile: StructureDefinition,
  explicitVersion: string | undefined,
  fhirVersion: 'R4' | 'R5' | 'R6',
): boolean {
  if (explicitVersion && (profile as { version?: string }).version !== explicitVersion) return false;
  const profileFhirVersion = (profile as { fhirVersion?: string }).fhirVersion;
  if (!profileFhirVersion) return true;
  const expectedPrefix = fhirVersion === 'R4' ? '4.' : fhirVersion === 'R5' ? '5.' : '6.';
  return profileFhirVersion.startsWith(expectedPrefix);
}

/** Preload requested profiles and generate missing snapshots for batch validation. */
export async function preloadProfiles(
  sdLoader: StructureDefinitionLoader,
  profileCache: ProfileCache,
  snapshotGenerator: SnapshotGenerator,
  profileUrls: string[],
  fhirVersion: 'R4' | 'R5' | 'R6',
  fhirClient?: FhirClientLike,
  settings?: ValidationSettings,
  context?: ProfileSourceContext,
  warmupCoordinator?: ProfileWarmupCoordinator,
): Promise<void> {
  const startTime = Date.now();
  const profilesMap = new Map<string, StructureDefinition>();

  await warmupOwnedProfileCache(warmupCoordinator, context, profileCache);
  logger.info(`[RecordsValidator] ⚡ Loading ${profileUrls.length} profiles (DB/Cache priority)...`);

  const source = getProfileSource();
  const scopedContext: ProfileSourceContext | undefined = context
    ? { ...context, fhirVersion }
    : undefined;
  const tenantUrls = context?.organizationId !== undefined
    ? profileUrls.filter(url => !isCoreStructureDefinition(url))
    : [];
  const tenantUrlSet = new Set(tenantUrls);
  const loaderUrls = profileUrls.filter(url => !tenantUrlSet.has(url));
  const sdLoaderResults = await sdLoader.loadProfilesBatch(loaderUrls, fhirVersion);

  for (const [url, sd] of sdLoaderResults.entries()) profilesMap.set(url, sd);

  const urlsToResolve: string[] = [...tenantUrls];
  for (const url of profileUrls) {
    if (!tenantUrlSet.has(url) && !sdLoaderResults.has(url) && !profilesMap.has(url)) {
      urlsToResolve.push(url);
    }
  }

  logger.info(`[RecordsValidator] ✓ Loaded ${profilesMap.size}/${profileUrls.length} from cache. Need to resolve ${urlsToResolve.length} via ProfileResolver.`);

  if (urlsToResolve.length > 0 && source.resolveProfile) {
    const resolveProfile = source.resolveProfile.bind(source);
    try {
      logger.info(`[RecordsValidator] 🔄 Resolving ${urlsToResolve.length} profiles via ProfileSource...`);
      const chunks = chunkArray(urlsToResolve, 15);
      let resolvedCount = 0;

      for (const chunk of chunks) {
        await Promise.all(chunk.map(async (url) => {
          try {
            const { canonicalUrl, version } = splitVersionedCanonical(url);
            const profile = await resolveProfile(canonicalUrl, version, settings, scopedContext);
            if (profile && profileMatchesRequest(profile, version, fhirVersion)) {
              profilesMap.set(url, profile);
              sdLoader.cacheProfile(url, profile, fhirVersion);
              resolvedCount++;
            }
          } catch {
            logger.debug(
              '[RecordsValidator] Failed to resolve profile',
              profileCanonicalMetadata(url),
            );
          }
        }));
      }

      logger.info(`[RecordsValidator] ✓ ProfileSource resolved ${resolvedCount} additional profiles.`);
    } catch {
      logger.warn('[RecordsValidator] ProfileSource resolveProfile threw, skipping advanced resolution.');
    }
  }

  logger.info(`[RecordsValidator] Loaded ${profilesMap.size}/${profileUrls.length} profiles in batch`);
  const snapshotPromises: Promise<void>[] = [];

  for (const [profileUrl, structureDef] of profilesMap.entries()) {
    if (!structureDef.snapshot && structureDef.differential && structureDef.baseDefinition) {
      const snapshotCacheKey = `${profileUrl}:${fhirVersion}:snapshot`;
      const cachedSnapshot = profileCache.get(snapshotCacheKey) as StructureDefinition | undefined;

      if (cachedSnapshot?.snapshot) {
        logger.debug(
          '[RecordsValidator] Using cached snapshot',
          profileCanonicalMetadata(profileUrl),
        );
        structureDef.snapshot = cachedSnapshot.snapshot;
      } else {
        snapshotPromises.push((async () => {
          try {
            const elements = await snapshotGenerator.generateSnapshot(structureDef, { fhirVersion });
            if (elements && elements.length > 0) {
              const withSnapshot: StructureDefinition = {
                ...structureDef,
                snapshot: { element: elements },
              };
              profileCache.set(snapshotCacheKey, withSnapshot);
              logger.debug(
                '[RecordsValidator] Cached generated snapshot',
                profileCanonicalMetadata(profileUrl),
              );
            }
          } catch (error) {
            logger.warn('[RecordsValidator] Failed to generate snapshot', {
              ...profileCanonicalMetadata(profileUrl),
              ...validationFailureMetadata(error),
            });
          }
        })());
      }
    } else if (structureDef) {
      const cacheKey = `${profileUrl}:${fhirVersion}:snapshot`;
      if (!profileCache.get(cacheKey)) profileCache.set(cacheKey, structureDef);
    }
  }

  if (snapshotPromises.length > 0) {
    logger.info(`[RecordsValidator] Generating ${snapshotPromises.length} snapshot(s) in parallel...`);
    await Promise.all(snapshotPromises);
  }

  logger.info(`[RecordsValidator] Profile preloading complete in ${Date.now() - startTime}ms`);
}

async function warmupOwnedProfileCache(
  coordinator: ProfileWarmupCoordinator | undefined,
  context: ProfileSourceContext | undefined,
  profileCache: ProfileCache,
): Promise<void> {
  if (!coordinator || context?.organizationId !== undefined) return;
  const result = await coordinator.runOnce(() => warmupProfileCacheFromDatabase(profileCache));
  if (result && result.warmedUp > 0) {
    logger.info(`[RecordsValidator] 🔥 Warmup: ${result.warmedUp} profiles pre-loaded in ${result.timeMs}ms`);
  }
}
