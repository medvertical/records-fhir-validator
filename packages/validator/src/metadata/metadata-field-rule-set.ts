import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  LastUpdatedValidator,
  SourceValidator,
  VersionIdValidator,
} from './field-validators.js';
import type { FhirObject } from './metadata-boundary-utils.js';
import { ProfileValidator } from './profile-validators.js';
import { SecurityValidator } from './security-validators.js';
import { TagValidator } from './tag-validators.js';

/** Applies format and consistency rules for fields within a resource's meta object. */
export class MetadataFieldRuleSet {
  private readonly lastUpdatedValidator = new LastUpdatedValidator();
  private readonly versionIdValidator = new VersionIdValidator();
  private readonly sourceValidator = new SourceValidator();
  private readonly profileValidator = new ProfileValidator();
  private readonly securityValidator = new SecurityValidator();
  private readonly tagValidator = new TagValidator();

  validate(
    resource: FhirObject,
    meta: Record<string, unknown>,
    resourceType: string,
    profileUrl?: string,
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (meta.lastUpdated) {
      issues.push(...this.lastUpdatedValidator.validate(
        meta.lastUpdated,
        resourceType,
        profileUrl,
      ));
    }

    if (meta.versionId !== undefined && meta.versionId !== null) {
      issues.push(...this.versionIdValidator.validateFormat(
        meta.versionId,
        resourceType,
        profileUrl,
      ));
      issues.push(...this.versionIdValidator.validateConsistency(
        resource,
        resourceType,
        profileUrl,
      ));
    }

    if (meta.profile !== undefined && meta.profile !== null) {
      issues.push(...this.profileValidator.validateUrls(meta.profile, resourceType));
    }

    if (meta.security !== undefined && meta.security !== null) {
      issues.push(...this.securityValidator.validate(meta.security, resourceType));
    }

    if (meta.tag !== undefined && meta.tag !== null) {
      issues.push(...this.tagValidator.validate(meta.tag, resourceType));
    }

    if (meta.source !== undefined && meta.source !== null) {
      issues.push(...this.sourceValidator.validate(meta.source, resourceType));
    }

    return issues;
  }
}
