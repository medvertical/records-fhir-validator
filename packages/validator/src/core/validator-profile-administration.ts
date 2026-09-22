import type { ProfileCache } from '../cache/profile-cache.js';
import { logger } from '../logger.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { loadProfileWithSnapshot } from './profile-loader-utils.js';

type FhirVersion = 'R4' | 'R5' | 'R6';

export class ValidatorProfileAdministration {
  constructor(
    private readonly sdLoader: StructureDefinitionLoader,
    private readonly profileCache: ProfileCache,
    private readonly snapshotGenerator: SnapshotGenerator,
  ) {}

  async isProfileSupported(profileUrl: string, fhirVersion: FhirVersion): Promise<boolean> {
    return (await this.loadProfileWithSnapshot(profileUrl, fhirVersion)) !== null;
  }

  getSupportedProfiles(): string[] {
    return this.sdLoader.getAvailableProfiles();
  }

  getSdLoader(): StructureDefinitionLoader {
    return this.sdLoader;
  }

  loadProfileWithSnapshot(
    profileUrl: string,
    fhirVersion: FhirVersion,
  ): Promise<StructureDefinition | null> {
    return loadProfileWithSnapshot(
      this.sdLoader,
      this.profileCache,
      this.snapshotGenerator,
      profileUrl,
      fhirVersion,
    );
  }

  clearProfileCache(): void {
    this.sdLoader.clearCache();
    this.profileCache.clear();
    this.snapshotGenerator.clearCache();
    logger.info('[RecordsValidator] Profile cache cleared');
  }

  evictProfile(profileUrl: string, fhirVersion: FhirVersion): void {
    this.snapshotGenerator.evict(profileUrl);
    this.profileCache.delete(`${profileUrl}:${fhirVersion}:snapshot`);
  }

  setPinnedCanonicals(pinned: Map<string, string>): void {
    this.sdLoader.setPinnedCanonicals(pinned);
  }

  getPinnedCanonicalCount(): number {
    return this.sdLoader.getPinnedCanonicalCount();
  }

  getPinnedCanonicalFingerprint(): ReturnType<StructureDefinitionLoader['getPinnedCanonicalFingerprint']> {
    return this.sdLoader.getPinnedCanonicalFingerprint();
  }
}
