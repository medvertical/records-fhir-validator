/**
 * Profile-URL → package-ID detection for the FHIR package registry.
 *
 * Fast path: host/path-aware patterns for common national/IG packages.
 * Fallback: the embedder's DB-backed ProfilePackageMapper (when wired).
 */

import { logger } from '../logger.js';
import { getProfileSource } from '../persistence/index.js';
import {
  isSafePackageId,
  packageErrorMetadata,
  packageReferenceMetadata,
  packageTargetMetadata,
} from './package-artifact-policy.js';
import {
  detectKnownPackageForProfile,
  isResolvableProfileCanonical,
} from './package-profile-patterns.js';

/**
 * Detect package ID from a profile URL.
 * First tries known canonical patterns, then the generic ProfilePackageMapper.
 */
export async function detectPackageForProfile(profileUrl: string): Promise<string | null> {
  logger.info('[PackageRegistry] Detecting package for profile', packageTargetMetadata(profileUrl));
  if (!isResolvableProfileCanonical(profileUrl)) {
    logger.warn('[PackageRegistry] Refusing invalid profile canonical');
    return null;
  }

  const knownMatch = detectKnownPackageForProfile(profileUrl);
  if (knownMatch && isSafePackageId(knownMatch.packageId)) {
    logger.info('[PackageRegistry] Matched known profile pattern', {
      ...packageReferenceMetadata(knownMatch.packageId),
      pattern: knownMatch.pattern,
    });
    return knownMatch.packageId;
  }

  logger.info(
    '[PackageRegistry] Using generic profile package discovery',
    packageTargetMetadata(profileUrl),
  );
  try {
    const findPackage = getProfileSource().findPackageForProfile;
    const packageInfo = findPackage ? await findPackage(profileUrl) : null;
    if (packageInfo && isSafePackageId(packageInfo.packageId)) {
      logger.info('[PackageRegistry] Generic profile package discovery succeeded', {
        ...packageReferenceMetadata(packageInfo.packageId),
        confidence: packageInfo.confidenceScore ?? null,
      });
      return packageInfo.packageId;
    }
  } catch (error: unknown) {
    logger.error(
      '[PackageRegistry] Generic profile package discovery failed',
      packageErrorMetadata(error),
    );
  }

  logger.warn(
    '[PackageRegistry] Could not detect package for profile',
    packageTargetMetadata(profileUrl),
  );
  return null;
}
