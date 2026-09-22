import { normalizeProfileSourcesConfig } from '@records-fhir/validation-types';
import { logger } from '../logger.js';
import type { ProfileSourcesConfig } from '@records-fhir/validation-types';
import { sensitiveValueMetadata } from '../utils/sensitive-logging-metadata.js';
import { fingerprintPinnedCanonicals, resolvePinnedCanonical, type PinnedCanonicalFingerprint } from './sd-loader-pinned-canonical.js';
import { recordsEqual } from './sd-loader-policy-cache.js';

interface LoaderPolicyInitialState {
  autoDownload: boolean;
  profileSourcesConfig: ProfileSourcesConfig;
  allowedPackages: string[];
  packageVersionPins: Record<string, string>;
}

export class StructureDefinitionLoaderPolicyState {
  private autoDownload: boolean;
  private profileSourcesConfig: ProfileSourcesConfig;
  private allowedPackages: string[];
  private packageVersionPins: Record<string, string>;
  private selectedCorePackageId: string | undefined;
  private pinnedCanonicals: Map<string, string> | null = null;
  private policyRevision = 0;

  constructor(
    initial: LoaderPolicyInitialState,
    private readonly invalidateCaches: (clearReloadableCache: boolean) => void,
  ) {
    this.autoDownload = initial.autoDownload;
    this.profileSourcesConfig = { ...initial.profileSourcesConfig };
    this.allowedPackages = [...initial.allowedPackages];
    this.packageVersionPins = { ...initial.packageVersionPins };
  }

  get revision(): number {
    return this.policyRevision;
  }

  get autoDownloadEnabled(): boolean {
    return this.autoDownload;
  }

  get profileSources(): ProfileSourcesConfig {
    return this.profileSourcesConfig;
  }

  get allowedPackageList(): string[] {
    return this.allowedPackages;
  }

  get packagePins(): Record<string, string> {
    return this.packageVersionPins;
  }

  get selectedCorePackage(): string | undefined {
    return this.selectedCorePackageId;
  }

  resolvePinnedCanonical(url: string): string {
    return resolvePinnedCanonical(this.pinnedCanonicals, url);
  }

  setPinnedCanonicals(pinned: ReadonlyMap<string, string>): void {
    const next = new Map(pinned);
    if (mapsEqual(this.pinnedCanonicals, next)) return;
    this.pinnedCanonicals = next;
    this.invalidate(true);
    logger.info(`[SDLoader] Pinned ${next.size} canonical(s) — runtime resolution is now deterministic`);
  }

  getPinnedCanonicalCount(): number {
    return this.pinnedCanonicals?.size ?? 0;
  }

  getPinnedCanonicalFingerprint(): PinnedCanonicalFingerprint {
    return fingerprintPinnedCanonicals(this.pinnedCanonicals);
  }

  setAutoDownload(enabled: boolean): void {
    if (this.autoDownload === enabled) return;
    this.autoDownload = enabled;
    this.invalidate(false);
    logger.info(`[SDLoader] Auto-download ${enabled ? 'enabled' : 'disabled'}`);
  }

  setProfileSourcesConfig(config: ProfileSourcesConfig): void {
    const normalized = normalizeProfileSourcesConfig(config);
    if (
      this.profileSourcesConfig.simplifier === normalized.simplifier
      && this.profileSourcesConfig.packageRegistry === normalized.packageRegistry
    ) return;
    this.profileSourcesConfig = normalized;
    this.invalidate(false);
    logger.info(
      `[SDLoader] Profile sources updated: Simplifier=${normalized.simplifier}, Registry=${normalized.packageRegistry}`,
    );
  }

  getProfileSourcesConfig(): ProfileSourcesConfig {
    return { ...this.profileSourcesConfig };
  }

  setAllowedPackages(packages: readonly string[]): void {
    const next = [...packages];
    if (arraysEqual(this.allowedPackages, next)) return;
    this.allowedPackages = next;
    this.invalidate(false);
    logger.info('[SDLoader] Allowed packages updated', {
      packageCount: next.length,
      ...sensitiveValueMetadata(...next),
    });
  }

  getAllowedPackages(): string[] {
    return [...this.allowedPackages];
  }

  setPackageVersionPins(pins: Readonly<Record<string, string>>): void {
    if (recordsEqual(this.packageVersionPins, pins)) return;
    this.packageVersionPins = { ...pins };
    this.invalidate(true);
    logger.info(`[SDLoader] Package version pins updated: ${Object.keys(pins).length} package(s)`);
  }

  getPackageVersionPins(): Record<string, string> {
    return { ...this.packageVersionPins };
  }

  setSelectedCorePackage(packageId: string | undefined): void {
    if (this.selectedCorePackageId === packageId) return;
    this.selectedCorePackageId = packageId;
    this.invalidate(true);
  }

  invalidate(clearReloadableCache = false): void {
    this.policyRevision++;
    this.invalidateCaches(clearReloadableCache);
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mapsEqual(left: ReadonlyMap<string, string> | null, right: ReadonlyMap<string, string>): boolean {
  return left?.size === right.size && [...right].every(([key, value]) => left.get(key) === value);
}
