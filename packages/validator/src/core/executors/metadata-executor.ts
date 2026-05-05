/**
 * Metadata Executor
 * 
 * Validates resource metadata:
 * - Provenance validation
 * - Timestamps (lastUpdated)
 * - Identifiers (versionId)
 * - Meta field structure
 * 
 * Delegates to specialized validators in engine/metadata/validators
 */

import type { ValidationIssue } from '../../types';
import { logger } from '../../logger';
import {
  LastUpdatedValidator,
  VersionIdValidator,
  SourceValidator,
} from '../../metadata/field-validators';
import { ProfileValidator } from '../../metadata/profile-validators';
import { SecurityValidator } from '../../metadata/security-validators';
import { TagValidator } from '../../metadata/tag-validators';
import { validateRequiredMetadata } from '../../metadata/completeness-checker';

// ============================================================================
// Types
// ============================================================================

export interface MetadataValidationContext {
  resource: any;
  resourceType?: string; // Optional in interface, but needed for validation
}

// ============================================================================
// Metadata Executor
// ============================================================================

export class MetadataExecutor {
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
   * Validate metadata fields
   */
  async validate(
    context: MetadataValidationContext,
    profileUrl?: string
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      const { resource } = context;
      const resourceType = context.resourceType || resource.resourceType || 'Unknown';

      logger.debug(`[MetadataExecutor] Validating ${resourceType} metadata`);

      // Validate meta field existence and structure
      const metaIssues = this.validateMetaField(resource, resourceType);
      issues.push(...metaIssues);

      // Validate required metadata based on resource type
      const requiredMetadataIssues = validateRequiredMetadata(resource, resourceType);
      issues.push(...requiredMetadataIssues);

      // Skip further validation if meta is invalid or missing
      if (!resource.meta) {
        return issues;
      }

      // Validate lastUpdated field
      if (resource.meta.lastUpdated) {
        const lastUpdatedIssues = this.lastUpdatedValidator.validate(
          resource.meta.lastUpdated,
          resourceType,
          profileUrl
        );
        issues.push(...lastUpdatedIssues);
      }

      // Validate versionId field
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

      // Validate profile URLs
      if (resource.meta.profile !== undefined && resource.meta.profile !== null) {
        const profileUrlIssues = this.profileValidator.validateUrls(
          resource.meta.profile,
          resourceType
        );
        issues.push(...profileUrlIssues);
      }

      // Validate security labels
      if (resource.meta.security !== undefined && resource.meta.security !== null) {
        const securityIssues = this.securityValidator.validate(
          resource.meta.security,
          resourceType
        );
        issues.push(...securityIssues);
      }

      // Validate tags
      if (resource.meta.tag !== undefined && resource.meta.tag !== null) {
        const tagIssues = this.tagValidator.validate(
          resource.meta.tag,
          resourceType
        );
        issues.push(...tagIssues);
      }

      // Validate source URI
      if (resource.meta.source !== undefined && resource.meta.source !== null) {
        const sourceIssues = this.sourceValidator.validate(
          resource.meta.source,
          resourceType
        );
        issues.push(...sourceIssues);
      }

      logger.debug(`[MetadataExecutor] Metadata validation found ${issues.length} issues`);
      return issues;

    } catch (error) {
      logger.error('[MetadataExecutor] Validation error:', error);
      return [{
        id: `metadata-executor-error-${Date.now()}`,
        aspect: 'metadata',
        severity: 'error',
        code: 'validation-error',
        message: `Metadata validation failed: ${error instanceof Error ? error.message : String(error)}`,
        path: '',
        timestamp: new Date()
      }];
    }
  }

  /**
   * Validate meta field existence and basic structure
   */
  private validateMetaField(resource: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for required meta field (information only - HAPI doesn't enforce this)
    // This is a Records value-added check, demoted to information severity
    if (!resource.meta) {
      issues.push({
        id: `metadata-missing-meta-${Date.now()}`,
        aspect: 'metadata',
        severity: 'info',
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
