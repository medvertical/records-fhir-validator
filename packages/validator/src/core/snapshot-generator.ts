import { createHash } from 'node:crypto';
import { recordSnapshotTypeSources, snapshotTypeProfileKey, snapshotTypeSource, snapshotTargetProfileSource, snapshotTypeRecursionKey } from './snapshot-type-profile-authority.js';
import { ProfileReferenceUnavailableError, profileResolutionOwnerKey, profileDefinitionSourceKey } from './profile-reference-authority.js';
import type { StructureDefinition, ElementDefinition } from './structure-definition-types.js';
import { StructureDefinitionLoader } from './structure-definition-loader.js';
import { logger } from '../logger.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { SnapshotCache } from './snapshot-cache.js';
import { SnapshotElementMerger } from './snapshot-element-merger.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';

export interface SnapshotGenerationOptions {
  includeBaseElements?: boolean;
  applyConstraints?: boolean;
  cacheResults?: boolean;
  /**
   * Release whose core definitions the base profile is resolved from. Without
   * it every base resolved as R4, so a profile validated under R5 inherited R4
   * cardinality — `Encounter.class` is `1..1` in R4 and `0..*` in R5.
   */
  fhirVersion?: 'R4' | 'R5' | 'R6';
}

export class SnapshotGenerator {
  private sdLoader: StructureDefinitionLoader;
  private readonly snapshotCache: SnapshotCache;
  private readonly elementMerger = new SnapshotElementMerger();

  constructor(sdLoader: StructureDefinitionLoader, maxCacheEntries: number = 192) {
    this.sdLoader = sdLoader;
    this.snapshotCache = new SnapshotCache(maxCacheEntries);
  }

  async generateSnapshot(
    profileSD: StructureDefinition,
    options: SnapshotGenerationOptions = {}
  ): Promise<ElementDefinition[]> {
    return this.generate(profileSD, options, new Set());
  }

  /**
   * `expanding` holds the type profiles this generation is already inside,
   * so a profile reached through itself stops; concurrent generations keep
   * their own, or one would cache another's unexpanded result.
   */
  private async generate(
    profileSD: StructureDefinition,
    options: SnapshotGenerationOptions,
    expanding: ReadonlySet<string>,
  ): Promise<ElementDefinition[]> {
    const owner = this.sdLoader.getDependencyCaptureScope?.();
    const ownerKey = profileResolutionOwnerKey(owner);
    // The basis is built after resolving the current parent and type definitions,
    // including their package authority; a package version alone is insufficient.
    const cacheResults = options.cacheResults !== false;
    try {
      if (profileSD.snapshot && profileSD.snapshot.element && profileSD.snapshot.element.length > 0) {
        recordSnapshotTypeSources(profileSD.snapshot.element, profileSD);
        logger.debug('[SnapshotGenerator] Snapshot already exists', profileCanonicalMetadata(profileSD.url));
        return profileSD.snapshot.element;
      }

      logger.info('[SnapshotGenerator] Generating snapshot', profileCanonicalMetadata(profileSD.url));

      const baseProfile = await this.loadBaseProfile(profileSD, options.fhirVersion);

      if (!baseProfile) {
        logger.warn('[SnapshotGenerator] No base profile found; using differential', profileCanonicalMetadata(profileSD.url));
        return profileSD.differential?.element || [];
      }

      let baseSnapshot = baseProfile.snapshot?.element || [];

      if (baseSnapshot.length === 0 && baseProfile.differential) {
        baseSnapshot = await this.generate(baseProfile, options, expanding);
      }

      const differential = this.elementMerger.normalizeDifferential(profileSD.differential?.element || []);
      recordSnapshotTypeSources(baseSnapshot, baseProfile);
      recordSnapshotTypeSources(differential, profileSD);
      const effectiveElements = this.elementMerger.merge(baseSnapshot, differential, false);
      const typeProfiles = await this.loadTypeProfiles(effectiveElements, differential, options, profileSD, expanding);
      const family = options.fhirVersion ?? 'R4';
      const sources = (elements: readonly ElementDefinition[], fallback: StructureDefinition) => [...new Set(elements.flatMap(element =>
        (element.type ?? []).flatMap(type => [
          snapshotTypeRecursionKey('', snapshotTypeSource(type, fallback), family),
          snapshotTypeRecursionKey('', snapshotTargetProfileSource(type, fallback), family),
        ])))];
      // A stable host installation does not attest unchanged parent/type-profile bytes.
      const basisKey = cacheResults ? createHash('sha256').update(JSON.stringify([
        profileSD, profileDefinitionSourceKey(baseProfile), baseSnapshot, differential, [...typeProfiles], options.applyConstraints !== false,
        sources(baseSnapshot, baseProfile), sources(differential, profileSD),
        [...typeProfiles.values()].flatMap(elements => sources(elements, profileSD)),
      ])).digest('hex') : undefined;
      const cacheKey = cacheResults ? this.snapshotCache.keyFor(profileSD, ownerKey, family, basisKey) : undefined;
      const cachedSnapshot = cacheKey ? this.snapshotCache.get(cacheKey) : undefined;
      if (cachedSnapshot) return cachedSnapshot;
      const snapshot = this.elementMerger.merge(baseSnapshot, differential, options.applyConstraints !== false, typeProfiles);

      if (cacheKey && owner === this.sdLoader.getDependencyCaptureScope?.()) {
        this.snapshotCache.set(cacheKey, snapshot);
      }

      logger.info('[SnapshotGenerator] Snapshot generated', {
        ...profileCanonicalMetadata(profileSD.url),
        elementCount: snapshot.length,
      });
      return snapshot;

    } catch (error: unknown) {
      if (error instanceof ProfileReferenceUnavailableError) throw error;
      logger.error(
        '[SnapshotGenerator] Snapshot generation failed',
        validationFailureMetadata(error),
      );
      return profileSD.differential?.element || [];
    }
  }

  /**
   * The snapshots of the profiled types the differential walks into, which
   * the merge hangs below the constrained element.
   */
  private async loadTypeProfiles(
    elements: ElementDefinition[],
    differential: ElementDefinition[],
    options: SnapshotGenerationOptions,
    source: StructureDefinition,
    expanding: ReadonlySet<string>,
  ): Promise<Map<string, ElementDefinition[]>> {
    const walkedInto = (element: ElementDefinition) => {
      const id = element.id ?? element.path;
      return Boolean(id && differential.some(child => (child.id ?? child.path ?? '').startsWith(`${id}.`)));
    };
    const profiles = new Map<string, ElementDefinition[]>();
    for (const element of elements) {
      const key = snapshotTypeProfileKey(element);
      const type = element.type?.[0];
      const url = type?.profile?.[0];
      if (!key || !type || !url || !element.path?.includes('.') || !walkedInto(element)) continue;
      const definer = snapshotTypeSource(type, source);
      const recursionKey = snapshotTypeRecursionKey(url, definer, options.fhirVersion ?? 'R4');
      const [canonical, edition] = url.split('|');
      if ((canonical === definer.url && (!edition || edition === definer.version)) || expanding.has(recursionKey)) continue;
      try {
        const profile = await this.sdLoader.loadReferencedProfile(url, definer, options.fhirVersion ?? 'R4');
        if (profile) profiles.set(key, await this.generate(profile, options, new Set([...expanding, recursionKey])));
      } catch (error: unknown) {
        if (error instanceof ProfileReferenceUnavailableError) throw error;
        // An unreadable type profile leaves the element as its base defines it.
      }
    }
    return profiles;
  }

  private async loadBaseProfile(
    profileSD: StructureDefinition,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<StructureDefinition | null> {
    if (!profileSD.baseDefinition) {
      return null;
    }

    try {
      logger.debug('[SnapshotGenerator] Loading base profile', profileCanonicalMetadata(profileSD.baseDefinition));
      return await this.sdLoader.loadReferencedProfile(profileSD.baseDefinition, profileSD, fhirVersion);
    } catch (error: unknown) {
      if (error instanceof ProfileReferenceUnavailableError) throw error;
      logger.warn(
        '[SnapshotGenerator] Base profile load failed',
        validationFailureMetadata(error),
      );
      return null;
    }
  }

  clearCache(): void {
    this.snapshotCache.clear();
    logger.debug('[SnapshotGenerator] Cache cleared');
  }

  evict(profileUrl: string): boolean {
    return this.snapshotCache.evict(profileUrl);
  }

  getCacheStats(): { size: number; profiles: string[] } {
    return this.snapshotCache.stats();
  }
}
