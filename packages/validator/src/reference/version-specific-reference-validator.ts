import {
  extractBundleEntries,
  findReferencesInResource,
} from './bundle-reference-finder.js';
import type {
  VersionedReferenceInfo,
  VersionIntegrityCheckResult,
  VersionConsistencyCheckResult,
  VersionAvailabilityCheckResult,
} from './version-specific-reference-types.js';
import {
  checkVersionConsistency,
  compareReferenceVersions,
  getLatestVersion,
  parseVersionedReference,
  stripReferenceVersion,
  toVersionedReference,
  validateVersionedReference,
} from './version-reference-syntax.js';
import { checkVersionAvailability } from './version-reference-availability.js';

export type {
  VersionedReferenceInfo,
  VersionIntegrityCheckResult,
  VersionConsistencyCheckResult,
  VersionAvailabilityCheckResult,
} from './version-specific-reference-types.js';

export class VersionSpecificReferenceValidator {
  parseVersionedReference(reference: string): VersionedReferenceInfo {
    return parseVersionedReference(reference);
  }

  validateVersionedReference(reference: string): VersionIntegrityCheckResult {
    return validateVersionedReference(reference);
  }

  checkVersionConsistency(references: string[]): VersionConsistencyCheckResult {
    return checkVersionConsistency(references);
  }

  async checkVersionAvailability(
    reference: string,
    httpClient?: (url: string) => Promise<{ status: number; data?: unknown }>
  ): Promise<VersionAvailabilityCheckResult> {
    return checkVersionAvailability(reference, httpClient);
  }

  extractVersionedReferences(resource: unknown): VersionedReferenceInfo[] {
    return findReferencesInResource(resource, '', { includeContained: true })
      .flatMap(({ reference }) => {
        const versionInfo = this.parseVersionedReference(reference);
        if (versionInfo.isVersioned) {
          return [versionInfo];
        }
        return [];
      });
  }

  validateResourceVersionedReferences(resource: unknown): VersionIntegrityCheckResult[] {
    const versionedRefs = this.extractVersionedReferences(resource);
    return versionedRefs.map(versionInfo => 
      this.validateVersionedReference(versionInfo.reference)
    );
  }

  compareVersions(version1: string, version2: string): number {
    return compareReferenceVersions(version1, version2);
  }

  getLatestVersion(references: string[]): VersionedReferenceInfo | null {
    return getLatestVersion(references);
  }

  isLatestVersion(reference: string, allReferences: string[]): boolean {
    const versionInfo = this.parseVersionedReference(reference);
    if (!versionInfo.isVersioned || !versionInfo.versionId) {
      return false;
    }

    const latest = this.getLatestVersion(allReferences);
    if (!latest || !latest.versionId) {
      return false;
    }

    return versionInfo.versionId === latest.versionId;
  }

  toVersionedReference(reference: string, versionId: string): string {
    return toVersionedReference(reference, versionId);
  }

  stripVersion(reference: string): string {
    return stripReferenceVersion(reference);
  }

  validateBundleVersionIntegrity(bundle: unknown): {
    isValid: boolean;
    issues: VersionIntegrityCheckResult[];
    consistencyCheck: VersionConsistencyCheckResult;
  } {
    const issues: VersionIntegrityCheckResult[] = [];
    const allReferences: string[] = [];

    extractBundleEntries(bundle).forEach((entry) => {
      if (entry.resource) {
        const versionedRefs = this.extractVersionedReferences(entry.resource);
        versionedRefs.forEach(versionInfo => {
          allReferences.push(versionInfo.reference);
          const validationResult = this.validateVersionedReference(versionInfo.reference);
          if (!validationResult.isValid) {
            issues.push(validationResult);
          }
        });
      }
    });

    const consistencyCheck = this.checkVersionConsistency(allReferences);

    return {
      isValid: issues.length === 0 && consistencyCheck.isConsistent,
      issues,
      consistencyCheck,
    };
  }
}

export function getVersionSpecificReferenceValidator(): VersionSpecificReferenceValidator {
  return new VersionSpecificReferenceValidator();
}

export function resetVersionSpecificReferenceValidator(): void {
  // Compatibility no-op: validator instances are caller-owned.
}
