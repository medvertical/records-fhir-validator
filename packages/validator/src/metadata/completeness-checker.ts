/**
 * Metadata Completeness Checker
 * 
 * Validates that required metadata fields are present based on resource type.
 */

import type { ValidationIssue } from '../types';
import { RESOURCE_METADATA_REQUIREMENTS } from './metadata-types';

/**
 * Validate required metadata based on resource type
 */
export function validateRequiredMetadata(resource: any, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

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
        isPresent = !!(resource.meta && 'versionId' in resource.meta && resource.meta.versionId);
        break;
      case 'lastUpdated':
        isPresent = !!(resource.meta && resource.meta.lastUpdated);
        break;
      case 'profile':
        isPresent = !!(resource.meta && resource.meta.profile && Array.isArray(resource.meta.profile) && resource.meta.profile.length > 0);
        break;
      case 'security':
        isPresent = !!(resource.meta && resource.meta.security && Array.isArray(resource.meta.security) && resource.meta.security.length > 0);
        break;
      case 'tag':
        isPresent = !!(resource.meta && resource.meta.tag && Array.isArray(resource.meta.tag) && resource.meta.tag.length > 0);
        break;
      case 'source':
        isPresent = !!(resource.meta && resource.meta.source);
        break;
    }

    if (!isPresent) {
      issues.push({
        id: `metadata-required-field-missing-${resourceType}-${field}-${Date.now()}`,
        aspect: 'metadata',
        severity: severity,
        code: `required-metadata-missing-${field}`,
        message: `${resourceType} resource is missing recommended metadata field: meta.${field}`,
        path: `meta.${field}`,
        humanReadable: reason,
        details: {
          fieldPath: `meta.${field}`,
          resourceType: resourceType,
          requiredField: field,
          severity: severity,
          reason: reason,
          validationType: 'required-metadata-check'
        },
        validationMethod: 'required-metadata-check',
        timestamp: new Date().toISOString(),
        resourceType: resourceType,
        schemaVersion: 'R4'
      });
    }
  }

  return issues;
}

