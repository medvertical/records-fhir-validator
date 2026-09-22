/**
 * Metadata Completeness Checker
 * 
 * Validates that required metadata fields are present based on resource type.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { RESOURCE_METADATA_REQUIREMENTS } from './metadata-types.js';
import { isObjectRecord } from './metadata-boundary-utils.js';
import { createMetadataIssue } from './metadata-issue.js';

/**
 * Validate required metadata based on resource type
 */
export function validateRequiredMetadata(resource: unknown, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const meta = isObjectRecord(resource) && isObjectRecord(resource.meta)
    ? resource.meta
    : null;

  // Get requirements for this resource type
  const requirements = RESOURCE_METADATA_REQUIREMENTS[resourceType];
  
  if (!requirements || requirements.length === 0) {
    // No specific requirements for this resource type
    return issues;
  }

  // Check each requirement
  for (const requirement of requirements) {
    const { field, severity, reason } = requirement;
    
    // Check if the required metadata field is present
    let isPresent = false;
    
    switch (field) {
      case 'versionId':
        isPresent = !!(meta && 'versionId' in meta && meta.versionId);
        break;
      case 'lastUpdated':
        isPresent = !!meta?.lastUpdated;
        break;
      case 'profile':
        isPresent = !!(meta?.profile && Array.isArray(meta.profile) && meta.profile.length > 0);
        break;
      case 'security':
        isPresent = !!(meta?.security && Array.isArray(meta.security) && meta.security.length > 0);
        break;
      case 'tag':
        isPresent = !!(meta?.tag && Array.isArray(meta.tag) && meta.tag.length > 0);
        break;
      case 'source':
        isPresent = !!meta?.source;
        break;
    }

    if (!isPresent) {
      issues.push(createMetadataIssue({
        code: `required-metadata-missing-${field}`,
        severity,
        message: `${resourceType} resource is missing recommended metadata field: meta.${field}`,
        path: `meta.${field}`,
        humanReadable: reason,
        resourceType,
        validationMethod: 'required-metadata-check',
        details: {
          requiredField: field,
          severity,
          reason,
        },
      }));
    }
  }

  return issues;
}
