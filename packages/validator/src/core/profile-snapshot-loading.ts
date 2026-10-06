import { copyProfilePackageProvenance } from '../package/canonical-pin-provenance.js';
import { profileDefinitionSourceKey, profileResolutionOwnerKey, selectedProfileLookup } from './profile-reference-authority.js';
import { withProfileSourceSnapshot } from '../persistence/profile-source.js';
import { captureValidationDependency } from '../validation-dependency-snapshot.js';
import type { ProfileCache } from '../cache/profile-cache.js';
import { logger } from '../logger.js';
import type { ProfileSourceContext } from '../persistence/index.js';
import type { ValidationSettings } from '@records-fhir/validation-types';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { sameProfileDefinition } from './sd-loader-profile-identity.js';
import type { SnapshotGenerator } from './snapshot-generator.js';
import type { StructureDefinitionLoader } from './structure-definition-loader.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';
import {
  isTenantScopedProfileRequest,
  resolvedProfileMatchesRequest,
  resolveTenantProfileFromSource,
} from './tenant-profile-source-resolution.js';

export interface FhirClientLike {
  getResource?(resourceType: string, id: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  searchResources?(
    resourceType: string,
    params: Record<string, string>,
    count?: number,
    options?: Record<string, unknown>,
  ): Promise<{ entry?: Array<{ resource: StructureDefinition }> }>;
}

export async function loadProfileWithSnapshot(
  sdLoader: StructureDefinitionLoader,
  profileCache: ProfileCache,
  snapshotGenerator: SnapshotGenerator,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  _fhirClient?: FhirClientLike,
): Promise<StructureDefinition | null> {
  const captureScope = sdLoader.getDependencyCaptureScope?.();
  return captureValidationDependency('profile', 'loadProfileWithSnapshot', [profileUrl, fhirVersion, sdLoader.getProfileResolutionContext?.(), selectedProfileLookup(profileUrl, fhirVersion)?.key], () => withProfileSourceSnapshot(async () => {
    const cacheKey = `${profileUrl}:${fhirVersion}:snapshot`;
    const structureDef = await sdLoader.loadProfile(profileUrl, fhirVersion);
    if (!structureDef || !resolvedProfileMatchesRequest(structureDef, profileUrl, fhirVersion)) return null;
    return ensureSnapshot(structureDef, snapshotGenerator, profileCache, cacheKey, profileUrl, fhirVersion, profileResolutionOwnerKey(captureScope));
  }), captureScope, sdLoader.getDependencyCaptureScope ? () => sdLoader.getDependencyCaptureScope() : undefined);
}

export async function loadProfileForValidation(
  sdLoader: StructureDefinitionLoader,
  snapshotGenerator: SnapshotGenerator,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  profileCache?: ProfileCache,
  _fhirClient?: FhirClientLike,
  resolutionContext?: ProfileSourceContext,
  settings?: ValidationSettings,
): Promise<StructureDefinition | null> {
  const captureScope = sdLoader.getDependencyCaptureScope?.();
  const context = structuredClone(resolutionContext ?? sdLoader.getProfileResolutionContext?.());
  const capturedSettings = settings && structuredClone(settings);
  return captureValidationDependency('profile', 'loadProfileForValidation', [profileUrl, fhirVersion, context, capturedSettings, selectedProfileLookup(profileUrl, fhirVersion)?.key], () => withProfileSourceSnapshot(async () => {
    const cacheKey = `${profileUrl}:${fhirVersion}:snapshot`;
    const tenantScoped = isTenantScopedProfileRequest(profileUrl, context);
    const effectiveUrl = sdLoader.resolveProfileUrl ? sdLoader.resolveProfileUrl(profileUrl, fhirVersion) : profileUrl;
    if (!effectiveUrl) return null;
    const loaderContext = sdLoader.getProfileResolutionContext?.();
    const loaderOwnsScope = loaderContext?.organizationId === context?.organizationId
      && loaderContext?.serverId === context?.serverId;

    // A scoped loader miss is authoritative. A caller supplying a different
    // scope resolves through that host source instead of a shared loader.
    const structureDef = tenantScoped && !loaderOwnsScope
      ? await resolveTenantProfile(effectiveUrl, fhirVersion, context, capturedSettings)
      : await sdLoader.loadProfile(profileUrl, fhirVersion);
    if (!structureDef || !resolvedProfileMatchesRequest(structureDef, profileUrl, fhirVersion, effectiveUrl)) return null;
    return ensureSnapshot(structureDef, snapshotGenerator, profileCache, cacheKey, profileUrl, fhirVersion, profileResolutionOwnerKey(captureScope));
  }), captureScope, sdLoader.getDependencyCaptureScope ? () => sdLoader.getDependencyCaptureScope() : undefined);
}

async function resolveTenantProfile(
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  context: ProfileSourceContext,
  settings?: ValidationSettings,
): Promise<StructureDefinition | null> {
  try {
    const profile = await resolveTenantProfileFromSource(
      profileUrl,
      fhirVersion,
      context,
      settings,
    );
    return profile
      && resolvedProfileMatchesRequest(profile, profileUrl, fhirVersion)
      ? profile
      : null;
  } catch (error: unknown) {
    logger.debug('[RecordsValidator] Tenant profile resolver fallback failed', validationFailureMetadata(error));
    return null;
  }
}

async function ensureSnapshot(
  structureDef: StructureDefinition,
  snapshotGenerator: SnapshotGenerator,
  profileCache: ProfileCache | undefined,
  cacheKey: string,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  ownerKey: string,
): Promise<StructureDefinition | null> {
  if (ownerKey) cacheKey = `${cacheKey}:owner:${ownerKey}`;
  const sourceKey = profileDefinitionSourceKey(structureDef);
  if (sourceKey) cacheKey = `${cacheKey}:${sourceKey}`;
  if (structureDef.snapshot || !structureDef.differential || !structureDef.baseDefinition) {
    profileCache?.set(cacheKey, structureDef);
    return structureDef;
  }
  const cached = profileCache?.get(cacheKey) as StructureDefinition | undefined;
  if (!sourceKey && cached?.snapshot && sameProfileDefinition(cached, structureDef)) {
    return cached;
  }
  if (cached) profileCache?.delete(cacheKey);
  logger.info('[RecordsValidator] Profile has no snapshot; generating from differential');
  const snapshotElements = await snapshotGenerator.generateSnapshot(structureDef, { fhirVersion, ...(sourceKey ? { cacheResults: false } : {}) });
  if (!snapshotElements?.length) {
    logger.error('[RecordsValidator] Failed to generate profile snapshot', profileCanonicalMetadata(profileUrl));
    return null;
  }
  const materialized = { ...structureDef, snapshot: { element: snapshotElements } };
  copyProfilePackageProvenance(structureDef, materialized);
  profileCache?.set(cacheKey, materialized);
  return materialized;
}
