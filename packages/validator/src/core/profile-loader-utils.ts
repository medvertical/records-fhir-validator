/**
 * Profile Loader Utilities
 * 
 * Utilities for loading StructureDefinitions and generating snapshots.
 * Extracted from validator-engine.ts to comply with global.mdc guidelines.
 */

import type { StructureDefinition } from './structure-definition-types';
import type { ValidationIssue } from '../types';
import { StructureDefinitionLoader } from './structure-definition-loader';
import { ProfileCache } from '../cache/profile-cache';
import { SnapshotGenerator } from './snapshot-generator';
import { logger } from '../logger';
import { getIncompatibleProfileResourceType } from './profile-resource-type';

/** Minimal interface for FHIR client to avoid circular dependencies */
export interface FhirClientLike {
  searchResources(resourceType: string, params: Record<string, string>, count?: number, options?: Record<string, unknown>): Promise<{ entry?: Array<{ resource: StructureDefinition }> }>;
}

/**
 * Load a profile with snapshot generation if needed
 */
export async function loadProfileWithSnapshot(
  sdLoader: StructureDefinitionLoader,
  profileCache: ProfileCache,
  snapshotGenerator: SnapshotGenerator,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  _fhirClient?: FhirClientLike
): Promise<StructureDefinition | null> {
  const cacheKey = `${profileUrl}:${fhirVersion}:snapshot`;

  // 1. Check ProfileCache first (L1)
  const cached = profileCache.get(cacheKey);
  if (cached) {
    logger.debug(`[RecordsValidator] Cache hit for ${profileUrl}`);
    return cached as StructureDefinition;
  }

  // 2. Load through the configured profile loader. It checks local cache,
  // bundled packages, Simplifier, and the package registry; it does not query
  // the selected resource FHIR server for StructureDefinitions.
  let structureDef = await sdLoader.loadProfile(profileUrl, fhirVersion);

  if (!structureDef) {
    return null;
  }

  // Generate snapshot if missing (with caching)
  if (!structureDef.snapshot && structureDef.differential && structureDef.baseDefinition) {
    logger.info(`[RecordsValidator] Profile has no snapshot, generating from differential...`);
    const elements = await snapshotGenerator.generateSnapshot(structureDef);

    if (elements && elements.length > 0) {
      const withSnapshot: StructureDefinition = {
        ...structureDef,
        snapshot: { element: elements }
      };
      profileCache.set(cacheKey, withSnapshot);
      structureDef = withSnapshot;
    }
  } else {
    // Cache the loaded profile even if it already had a snapshot
    profileCache.set(cacheKey, structureDef);
  }

  return structureDef;
}

/**
 * Result of loading a profile with base-SD fallback.
 * `usedBaseFallback` is true when the declared profile was unresolvable
 * and we fell back to the resource type's base StructureDefinition so
 * callers can still emit a warning and run the non-profile aspects.
 */
export interface ProfileLoadResult {
  structureDef: StructureDefinition | null;
  declaredProfileUrl: string;
  usedBaseFallback: boolean;
  incompatibleProfileType?: string;
}

/**
 * Load a profile with base-SD fallback.
 *
 * Why this exists: if a resource declares `meta.profile` pointing at a URL
 * the loader can't resolve (unknown IG, typo), returning null causes the
 * batch validator to skip ALL aspects. HAPI falls back to the resource
 * type's base SD in that case. We do the same so structural / invariant /
 * reference / metadata issues still surface.
 */
export async function loadProfileOrBase(
  sdLoader: StructureDefinitionLoader,
  snapshotGenerator: SnapshotGenerator,
  declaredProfileUrl: string,
  resourceType: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  profileCache?: ProfileCache,
  fhirClient?: FhirClientLike
): Promise<ProfileLoadResult> {
  const declared = await loadProfileForValidation(
    sdLoader,
    snapshotGenerator,
    declaredProfileUrl,
    fhirVersion,
    profileCache,
    fhirClient
  );
  if (declared) {
    const incompatibleProfileType = getIncompatibleProfileResourceType(declared, resourceType);
    if (incompatibleProfileType) {
      const baseUrl = `http://hl7.org/fhir/StructureDefinition/${resourceType}`;
      const base = declaredProfileUrl === baseUrl
        ? null
        : await loadProfileForValidation(
          sdLoader,
          snapshotGenerator,
          baseUrl,
          fhirVersion,
          profileCache,
          fhirClient
        );
      return {
        structureDef: base,
        declaredProfileUrl,
        usedBaseFallback: base !== null,
        incompatibleProfileType,
      };
    }
    return { structureDef: declared, declaredProfileUrl, usedBaseFallback: false };
  }
  const baseUrl = `http://hl7.org/fhir/StructureDefinition/${resourceType}`;
  if (declaredProfileUrl === baseUrl) {
    return { structureDef: null, declaredProfileUrl, usedBaseFallback: false };
  }
  const base = await loadProfileForValidation(
    sdLoader,
    snapshotGenerator,
    baseUrl,
    fhirVersion,
    profileCache,
    fhirClient
  );
  return {
    structureDef: base,
    declaredProfileUrl,
    usedBaseFallback: base !== null,
  };
}

/**
 * Build the warning issue emitted when a declared profile couldn't be
 * resolved and validation fell back to the resource type's base SD.
 */
export function createProfileFallbackIssue(
  profileUrl: string,
  resourceType: string
): ValidationIssue {
  return {
    id: `records-profile-not-resolved-${Date.now()}`,
    aspect: 'profile',
    severity: 'warning',
    code: 'profile-not-resolved',
    message: `Profile ${profileUrl} could not be resolved; validated against base ${resourceType} instead`,
    path: 'meta.profile',
    timestamp: new Date(),
    details: { profile: profileUrl },
  };
}

export { createProfileResourceTypeMismatchIssue } from './profile-resource-type';

/**
 * Load a profile and ensure snapshot exists (for validate method)
 */
export async function loadProfileForValidation(
  sdLoader: StructureDefinitionLoader,
  snapshotGenerator: SnapshotGenerator,
  profileUrl: string,
  fhirVersion: 'R4' | 'R5' | 'R6',
  profileCache?: ProfileCache, // Optional for backward compat, but recommended
  _fhirClient?: FhirClientLike
): Promise<StructureDefinition | null> {
  const cacheKey = `${profileUrl}:${fhirVersion}:snapshot`;

  // 1. Check ProfileCache (L1)
  if (profileCache) {
    const cached = profileCache.get(cacheKey);
    if (cached) {
      return cached as StructureDefinition;
    }
  }

  // 2. Load through the configured profile loader. The resource FHIR client is
  // intentionally not a profile source.
  let structureDef = await sdLoader.loadProfile(profileUrl, fhirVersion);

  if (!structureDef) {
    return null;
  }

  // Generate snapshot if missing (profile only has differential)
  if (!structureDef.snapshot && structureDef.differential && structureDef.baseDefinition) {
    logger.info(`[RecordsValidator] ⚠️  Profile has no snapshot, only differential. Generating snapshot...`);

    // Log differential constraints before generation
    const diffRootConstraints = structureDef.differential.element
      ?.find(el => el.path === structureDef.type)
      ?.constraint?.filter(c => !c.key.startsWith('dom-')) || [];
    logger.info(`[RecordsValidator] 📋 Profile-specific constraints in differential: ${diffRootConstraints.map(c => c.key).join(', ') || 'none'}`);

    const snapshotElements = await snapshotGenerator.generateSnapshot(structureDef);

    if (snapshotElements && snapshotElements.length > 0) {
      structureDef.snapshot = { element: snapshotElements };

      // Log constraints after snapshot generation
      const snapshotRootConstraints = snapshotElements
        .find(el => el.path === structureDef.type)
        ?.constraint?.filter(c => !c.key.startsWith('dom-')) || [];
      logger.info(`[RecordsValidator] ✅ Generated snapshot with ${snapshotElements.length} elements`);
      logger.info(`[RecordsValidator] 📋 Profile-specific constraints in snapshot: ${snapshotRootConstraints.map(c => c.key).join(', ') || 'none'}`);

      if (profileCache) profileCache.set(cacheKey, structureDef);
    } else {
      logger.error(`[RecordsValidator] ✗ Failed to generate snapshot for ${profileUrl}`);
      return null;
    }
  } else if (profileCache) {
    // Cache result
    profileCache.set(cacheKey, structureDef);
  }

  return structureDef;
}
