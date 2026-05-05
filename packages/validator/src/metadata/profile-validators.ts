/**
 * Profile Validators for Metadata
 * 
 * Validates meta.profile field:
 * - URL format and structure
 * - Profile accessibility
 * - Resource type matching
 * 
 * Refactored to use createValidationIssue factory.
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { isValidUrl } from './uri-validators';
import { logger } from '../logger';

/**
 * Validates meta.profile URLs and accessibility
 */
export class ProfileValidator {
  /**
   * Validate profile URLs
   */
  validateUrls(profiles: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    try {
      if (!Array.isArray(profiles)) {
        issues.push(createValidationIssue({
          code: 'metadata-profile-invalid-array',
          path: 'meta.profile',
          resourceType,
          details: { actualValue: profiles },
        }));
        return issues;
      }

      profiles.forEach((profile: any, index: number) => {
        const path = `meta.profile[${index}]`;

        if (typeof profile !== 'string') {
          issues.push(createValidationIssue({
            code: 'metadata-profile-invalid-type',
            path,
            resourceType,
            messageParams: { index },
            details: { actualValue: profile },
          }));
          return;
        }

        // Validate canonical URL format
        const canonicalPattern = /^https?:\/\/.+\/StructureDefinition\/[A-Za-z0-9\-.]+(\|.+)?$/;
        if (!canonicalPattern.test(profile) && !isValidUrl(profile.split('|')[0])) {
          issues.push(createValidationIssue({
            code: 'metadata-profile-invalid-url',
            path,
            resourceType,
            messageParams: { index, value: profile },
          }));
        }

        // Check resource type match
        const profileResourceType = this.extractResourceTypeFromProfile(profile);
        if (profileResourceType && profileResourceType !== resourceType) {
          issues.push(createValidationIssue({
            code: 'metadata-profile-resource-type-mismatch',
            path,
            resourceType,
            messageParams: { index, profileType: profileResourceType, resourceType },
            details: { profileUrl: profile, profileResourceType, actualResourceType: resourceType },
          }));
        }

        // Check for duplicates
        const duplicateIndex = profiles.findIndex((other: any, otherIndex: number) =>
          otherIndex > index && other === profile
        );

        if (duplicateIndex !== -1) {
          issues.push(createValidationIssue({
            code: 'metadata-profile-duplicate',
            path,
            resourceType,
            messageParams: { index, duplicateIndex },
            details: { profileUrl: profile },
          }));
        }
      });

    } catch (error) {
      logger.error('[ProfileValidator] URL validation failed:', error);
    }

    return issues;
  }

  /**
   * Validate profile accessibility (async)
   */
  async validateAccessibility(
    profiles: any,
    resourceType: string,
    _fhirVersion: string = 'R4'
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return issues;
    }

    // Use the embedder's ProfileSource (server-installed
    // ProfileResolver in the monorepo, noop in standalone). When no
    // resolveProfile is wired up — typical for CLI / npm-package
    // callers — this check silently degrades to "not validated" and
    // produces no issues.
    const { getProfileSource } = await import('../persistence');
    const source = getProfileSource();
    if (!source.resolveProfile) {
      return issues;
    }
    const resolveProfile = source.resolveProfile.bind(source);

    try {

      for (let index = 0; index < profiles.length; index++) {
        const profile = profiles[index];
        if (typeof profile !== 'string') continue;

        const path = `meta.profile[${index}]`;
        const [canonicalUrl, version] = profile.split('|');

        try {
          const resolved = await resolveProfile(canonicalUrl, version, undefined);

          if (!resolved) {
            issues.push(createValidationIssue({
              code: 'metadata-profile-not-accessible',
              path,
              resourceType,
              messageParams: { index, value: profile },
              details: { profileUrl: profile, canonicalUrl, version: version || 'latest' },
            }));
            continue;
          }

          // ProfileSource.resolveProfile returns the StructureDefinition
          // directly (not the legacy ProfileResolutionResult wrapper).
          const profileDef = resolved as { type?: string; status?: string };

          if (profileDef.type && profileDef.type !== resourceType) {
            issues.push(createValidationIssue({
              code: 'metadata-profile-wrong-resource-type',
              path,
              resourceType,
              messageParams: { index, profileType: profileDef.type, resourceType },
              details: { profileUrl: profile, profileResourceType: profileDef.type },
            }));
          }

          if (profileDef.status === 'retired') {
            issues.push(createValidationIssue({
              code: 'profile-load-error',
              path,
              resourceType,
              customMessage: `Profile "${profile}" is retired`,
              details: { profileUrl: profile, profileStatus: 'retired' },
            }));
          }

        } catch (error: unknown) {
          const err = error instanceof Error ? error : new Error(String(error));
          issues.push(createValidationIssue({
            code: 'profile-load-error',
            path,
            resourceType,
            customMessage: `Failed to resolve profile "${profile}": ${err.message}`,
            details: { profileUrl: profile, error: err.message },
          }));
        }
      }

    } catch (error: unknown) {
      logger.error('[ProfileValidator] accessibility check failed:', error);
    }

    return issues;
  }

  /**
   * Extract resource type from profile URL
   */
  private extractResourceTypeFromProfile(profileUrl: string): string | null {
    try {
      const urlWithoutVersion = profileUrl.split('|')[0];
      const match = urlWithoutVersion.match(/\/StructureDefinition\/([A-Za-z]+)/);

      if (match && match[1]) {
        const profileName = match[1];
        const commonTypes = [
          'MedicationRequest', 'AllergyIntolerance', 'DiagnosticReport', 'DocumentReference',
          'Observation', 'Condition', 'Procedure', 'Medication', 'Encounter',
          'Organization', 'Practitioner', 'Immunization', 'CarePlan',
          'Bundle', 'Composition', 'Provenance', 'Patient',
        ];

        for (const type of commonTypes) {
          if (profileName === type || profileName.startsWith(type + '-')) {
            return type;
          }
        }

        if (/^[A-Z][a-z]+$/.test(profileName)) {
          return profileName;
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}
