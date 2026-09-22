import type { RecordsValidator } from './core/validator-engine.js';
import type { ValidationSettings } from '@records-fhir/validation-types';
import {
  resolveFhirReleaseContext,
  type FhirReleaseContext,
  type PublicFhirVersion,
} from './public-validation-api.js';

const R4B_DEFAULT_RUNTIME_SCOPE = '__records-public-release__';
const R4B_RUNTIME_SCOPE_SUFFIX = ':release:R4B';

export interface PreparedPublicReleaseRuntime {
  context: FhirReleaseContext;
  runtimeScopeKey?: string;
}

/** R4B shares engine semantics with R4 but must never share its profile caches. */
export function preparePublicReleaseRuntime(
  fhirVersion: PublicFhirVersion = 'R4',
  runtimeScopeKey?: string,
): PreparedPublicReleaseRuntime {
  const context = resolveFhirReleaseContext(fhirVersion);
  return {
    context,
    runtimeScopeKey: context.publicVersion === 'R4B'
      ? `${runtimeScopeKey ?? R4B_DEFAULT_RUNTIME_SCOPE}${R4B_RUNTIME_SCOPE_SUFFIX}`
      : runtimeScopeKey,
  };
}

/** Pin the public core package before adapting execution to an engine family. */
export function configurePublicReleaseRuntime(
  validator: RecordsValidator,
  context: FhirReleaseContext,
): void {
  const { packageId, version } = parseCorePackage(context.corePackage);
  const loader = validator.getSdLoader();
  loader.setSelectedCorePackage(context.publicVersion === 'R4B' ? packageId : undefined);
  const pins = loader.getPackageVersionPins();
  if (pins[packageId] !== version) {
    loader.setPackageVersionPins({ ...pins, [packageId]: version });
  }
  const allowed = loader.getAllowedPackages();
  if (!allowed.includes(packageId) && !allowed.includes('*')) {
    loader.setAllowedPackages([...allowed, packageId]);
  }
}

/** Request settings stay authoritative except for the selected release identity. */
export function settingsWithPublicRelease(
  settings: ValidationSettings | undefined,
  context: FhirReleaseContext,
): ValidationSettings | undefined {
  const packageDownload = settings?.packageDownload;
  if (!settings || !packageDownload) return settings;

  const { packageId, version } = parseCorePackage(context.corePackage);
  return {
    ...settings,
    packageDownload: {
      ...packageDownload,
      pinnedVersions: {
        ...packageDownload.pinnedVersions,
        [packageId]: version,
      },
      approvedPackages: packageDownload.approvedPackages.includes(packageId)
        ? packageDownload.approvedPackages
        : [...packageDownload.approvedPackages, packageId],
    },
  };
}

function parseCorePackage(corePackage: string): { packageId: string; version: string } {
  const separator = corePackage.lastIndexOf('#');
  if (separator <= 0 || separator === corePackage.length - 1) {
    throw new Error(`Invalid FHIR core package identity: ${corePackage}`);
  }
  return {
    packageId: corePackage.slice(0, separator),
    version: corePackage.slice(separator + 1),
  };
}
