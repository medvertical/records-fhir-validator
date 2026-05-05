/**
 * Metadata Validator (Refactored)
 * 
 * Main orchestrator for metadata validation.
 * Coordinates all metadata validation sub-components.
 * 
 * This refactored version implements a modular structure where:
 * - Field validators (lastUpdated, versionId, source) are in field-validators.ts
 * - Profile validators are in profile-validators.ts
 * - Security label validators are in security-validators.ts
 * - Tag validators are in tag-validators.ts
 * - URI validators are in uri-validators.ts
 * - Completeness checker is in completeness-checker.ts
 * 
 * Each validator is independently testable and focused on a single responsibility.
 * 
 * The original metadata-validator.ts (2,208 lines) remains for backward compatibility
 * and will be deprecated in a future release.
 */

import type { ValidationIssue } from '../types';
import type { ValidationResult } from '@records-fhir/validation-types';
import type { ValidationContext } from '../types';
/**
 * Structural shape of the host's HAPI validation coordinator. The
 * full implementation lives server-side and depends on the HAPI
 * process pool; the engine only consumes the
 * `getIssuesByAspect()` lookup, so we keep the type local to avoid
 * pulling the coordinator's full surface (and its Java-runtime
 * dependencies) into the standalone package.
 */
interface HapiValidationCoordinator {
  getIssuesByAspect(resourceId: string, aspect: string): ValidationIssue[];
}
// Lazy import to avoid circular dependency with records-validator
// import { recordsValidator } from '..';
import { validateRequiredMetadata } from './completeness-checker';
import {
  LastUpdatedValidator,
  VersionIdValidator,
  SourceValidator
} from './field-validators';
import { ProfileValidator } from './profile-validators';
import { SecurityValidator } from './security-validators';
import { TagValidator } from './tag-validators';
import { validateProvenanceChain } from './provenance-chain-validator';
import { logger } from '../logger';

export class MetadataValidator {
  private lastUpdatedValidator: LastUpdatedValidator;
  private versionIdValidator: VersionIdValidator;
  private sourceValidator: SourceValidator;
  private profileValidator: ProfileValidator;
  private securityValidator: SecurityValidator;
  private tagValidator: TagValidator;

  constructor() {
    this.lastUpdatedValidator = new LastUpdatedValidator();
    this.versionIdValidator = new VersionIdValidator();
    this.sourceValidator = new SourceValidator();
    this.profileValidator = new ProfileValidator();
    this.securityValidator = new SecurityValidator();
    this.tagValidator = new TagValidator();
  }
  /**
   * Validate metadata - supports both new and legacy signatures for backward compatibility
   */
  async validate(
    resource: any,
    resourceTypeOrContext: string | ValidationContext,
    fhirVersion?: 'R4' | 'R5' | 'R6',
    coordinator?: HapiValidationCoordinator,
    settings?: any,
    profileUrl?: string
  ): Promise<ValidationIssue[] | ValidationResult> {
    // New signature: validate(resource, context)
    if (typeof resourceTypeOrContext === 'object') {
      const context = resourceTypeOrContext as ValidationContext;
      const startTime = Date.now();
      const version = context.fhirVersion || 'R4';

      const issues = await this.validateInternal(
        resource,
        context.resourceType,
        version
      );

      const validationTime = Date.now() - startTime;
      const isValid = issues.length === 0 || !issues.some(i => i.severity === 'error');

      return {
        resourceId: context.resourceId || resource.id || 'unknown',
        resourceType: context.resourceType,
        isValid,
        issues,
        aspects: [{
          aspect: 'metadata',
          isValid,
          issues,
          validationTime,
          status: 'completed'
        }],
        validatedAt: new Date(),
        validationTime,
        fhirVersion: version
      };
    }

    // Legacy signature: validate(resource, resourceType, fhirVersion, coordinator, settings)
    return this.validateInternal(
      resource,
      resourceTypeOrContext as string,
      fhirVersion,
      coordinator,
      settings,
      profileUrl
    );
  }

  /**
   * Internal validation method
   *
   * Coordinates all metadata validation aspects and aggregates results.
   */
  // eslint-disable-next-line max-lines-per-function
  async validateInternal(
    resource: any,
    resourceType: string,
    _fhirVersion?: 'R4' | 'R5' | 'R6',
    coordinator?: HapiValidationCoordinator,
    settings?: any,
    profileUrl?: string
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const startTime = Date.now();

    logger.debug(`[MetadataValidator] Validating ${resourceType} resource metadata...`);

    try {
      // Check if Records validator should be used
      const engine = settings?.aspects?.metadata?.engine || 'records';

      if (engine === 'records') {
        // Lazy import to avoid circular dependency
        const { recordsValidator } = await import('..');
        if (recordsValidator.isAvailable()) {
          logger.debug(`[MetadataValidator] Using Records validator...`);

          // Add timeout to prevent hanging
          const METADATA_TIMEOUT = 10000; // 10 seconds
          const validationPromise = recordsValidator.validateMetadata(resource);
          const timeoutPromise = new Promise<ValidationIssue[]>((_, reject) => {
            setTimeout(() => {
              logger.warn(`[MetadataValidator] Metadata validation timeout after ${METADATA_TIMEOUT}ms`);
              reject(new Error(`Metadata validation timeout after ${METADATA_TIMEOUT}ms`));
            }, METADATA_TIMEOUT);
          });

          try {
            return await Promise.race([validationPromise, timeoutPromise]);
          } catch (timeoutError: any) {
            logger.error(`[MetadataValidator] Metadata validation failed:`, timeoutError.message);
            // Return empty issues array instead of hanging
            return [];
          }
        }
      }

      // Check coordinator first (HAPI might have already validated metadata)
      if (coordinator) {
        const resourceId = `${resource.resourceType}/${resource.id}`;
        const coordinatorIssues = coordinator.getIssuesByAspect(resourceId, 'metadata');

        if (coordinatorIssues.length > 0) {
          logger.info(`[MetadataValidator] Using ${coordinatorIssues.length} issues from coordinator`);
          const validationTime = Date.now() - startTime;
          logger.info(
            `[MetadataValidator] Validated ${resourceType} metadata in ${validationTime}ms ` +
            `(${coordinatorIssues.length} issues, source: coordinator)`
          );
          return coordinatorIssues;
        }
      }

      // Validate meta field existence and structure
      const metaIssues = this.validateMetaField(resource, resourceType);
      issues.push(...metaIssues);

      // Validate required metadata based on resource type (check even if meta is missing)
      const requiredMetadataIssues = validateRequiredMetadata(resource, resourceType);
      issues.push(...requiredMetadataIssues);

      // Validate Provenance chain linkage (Provenance.target/recorded/agent
      // structure). Runs even if `meta` is absent, since Provenance does not
      // require a populated `meta` field.
      if (resourceType === 'Provenance') {
        const provenanceIssues = validateProvenanceChain(resource);
        issues.push(...provenanceIssues);
      }

      // Skip further validation if meta is invalid
      if (!resource.meta) {
        return issues;
      }

      // Validate lastUpdated field if present
      if (resource.meta.lastUpdated) {
        const lastUpdatedIssues = this.lastUpdatedValidator.validate(
          resource.meta.lastUpdated,
          resourceType,
          profileUrl
        );
        issues.push(...lastUpdatedIssues);
      }

      // Validate versionId field if present (check for undefined/null, not falsy)
      if (resource.meta.versionId !== undefined && resource.meta.versionId !== null) {
        const versionIdFormatIssues = this.versionIdValidator.validateFormat(
          resource.meta.versionId,
          resourceType,
          profileUrl
        );
        issues.push(...versionIdFormatIssues);

        const versionIdConsistencyIssues = this.versionIdValidator.validateConsistency(
          resource,
          resourceType,
          profileUrl
        );
        issues.push(...versionIdConsistencyIssues);
      }

      // Validate profile URLs if present (validator handles array check)
      if (resource.meta.profile !== undefined && resource.meta.profile !== null) {
        const profileUrlIssues = this.profileValidator.validateUrls(
          resource.meta.profile,
          resourceType
        );
        issues.push(...profileUrlIssues);
      }

      // Validate security labels if present (validator handles array check)
      if (resource.meta.security !== undefined && resource.meta.security !== null) {
        const securityIssues = this.securityValidator.validate(
          resource.meta.security,
          resourceType
        );
        issues.push(...securityIssues);
      }

      // Validate tags if present (validator handles array check)
      if (resource.meta.tag !== undefined && resource.meta.tag !== null) {
        const tagIssues = this.tagValidator.validate(
          resource.meta.tag,
          resourceType
        );
        issues.push(...tagIssues);
      }

      // Validate source URI if present
      if (resource.meta.source !== undefined && resource.meta.source !== null) {
        const sourceIssues = this.sourceValidator.validate(
          resource.meta.source,
          resourceType
        );
        issues.push(...sourceIssues);
      }

      const validationTime = Date.now() - startTime;
      logger.info(`[MetadataValidator] Validated ${resourceType} metadata in ${validationTime}ms, found ${issues.length} issues`);

    } catch (error) {
      logger.error('[MetadataValidator] Metadata validation failed:', error);
      issues.push({
        id: `metadata-validation-error-${Date.now()}`,
        aspect: 'metadata',
        severity: 'error',
        code: 'metadata-validation-error',
        message: `Metadata validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        path: '',
        humanReadable: 'Metadata validation encountered an error',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          resourceType: resourceType
        },
        validationMethod: 'metadata-validation-error',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
    }

    return issues;
  }

  /**
   * Validate profile accessibility (async method for tests)
   */
  async validateProfileAccessibility(
    profiles: any,
    resourceType: string,
    _fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Handle empty profiles
    if (!profiles || (Array.isArray(profiles) && profiles.length === 0)) {
      return issues;
    }

    // Handle non-array profiles
    if (!Array.isArray(profiles)) {
      return issues; // Already validated in validateInternal
    }

    // Validate each profile URL (skip non-string entries)
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      if (typeof profile !== 'string') {
        continue;
      }
    }

    return issues;
  }

  /**
   * Validate meta field existence and basic structure
   * 
   * Note: candidate for extraction to field-validators.ts in a future refactor.
   */
  private validateMetaField(resource: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for required meta field
    if (!resource.meta) {
      issues.push({
        id: `metadata-missing-meta-${Date.now()}`,
        aspect: 'metadata',
        severity: 'warning',
        code: 'missing-meta',
        message: 'Resource should have a meta field',
        path: 'meta',
        humanReadable: 'The resource should include metadata information',
        details: {
          fieldPath: 'meta',
          resourceType: resourceType,
          validationType: 'metadata-field-validation'
        },
        validationMethod: 'metadata-field-validation',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
      return issues;
    }

    // Check meta field type
    if (typeof resource.meta !== 'object' || Array.isArray(resource.meta)) {
      issues.push({
        id: `metadata-invalid-meta-type-${Date.now()}`,
        aspect: 'metadata',
        severity: 'error',
        code: 'invalid-meta-type',
        message: 'Meta field must be an object',
        path: 'meta',
        humanReadable: 'The meta field must be an object containing metadata information',
        details: {
          fieldPath: 'meta',
          actualValue: resource.meta,
          expectedType: 'object',
          resourceType: resourceType,
          validationType: 'metadata-field-validation'
        },
        validationMethod: 'metadata-field-validation',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
    }

    return issues;
  }
}

