import type { PackageDownloader } from '../package/package-downloader.js';
import type { PackageRegistryClient } from '../package/package-registry-client.js';
import type { ProfileSourcesConfig } from '@records-fhir/validation-types';
import type { PackageProfileIndexCache } from './sd-loader-package-profile-index.js';
import type { StructureDefinition } from './structure-definition-types.js';

/** Shared dependencies and cache ownership exposed to remote profile sources. */
export interface AutoDownloadSourceContext {
  registryClient: PackageRegistryClient;
  packageDownloader: PackageDownloader;
  allowedPackages: string[];
  packageVersionPins?: Record<string, string>;
  /** Explicit release-selected core package; never infer R4B from a mixed lock. */
  selectedCorePackageId?: string;
  packageSources: string[];
  cache: Map<string, StructureDefinition>;
  availableProfiles: Set<string>;
  /** Profile sources settings (optional - defaults to all enabled) */
  profileSourcesConfig?: ProfileSourcesConfig;
  /** FHIR version for package filtering (defaults to R4) */
  fhirVersion?: 'R4' | 'R5' | 'R6';
  /** Prevent late writes after the loader's resolution policy changes. */
  canCache?: () => boolean;
  packageProfileIndexCache?: PackageProfileIndexCache;
}
