/**
 * Validation Settings Transformers
 * 
 * Transformation utilities for validation settings (migration, version management, etc.).
 */

import type { ValidationSettings } from './settings';
import type { FHIRVersion } from './enums';
import { R4_ALL_RESOURCE_TYPES, R5_ALL_RESOURCE_TYPES, R4_DEFAULT_INCLUDED_RESOURCE_TYPES, R5_DEFAULT_INCLUDED_RESOURCE_TYPES } from './settings-types';

// ============================================================================
// FHIR Version Management Utilities
// ============================================================================

/**
 * Get all resource types for a specific FHIR version
 */
export function getAllResourceTypesForVersion(version: FHIRVersion): readonly string[] {
  return version === 'R4' ? R4_ALL_RESOURCE_TYPES : R5_ALL_RESOURCE_TYPES;
}

/**
 * Get default included resource types for a specific FHIR version
 */
export function getDefaultIncludedTypesForVersion(version: FHIRVersion): string[] {
  return version === 'R4' ? [...R4_DEFAULT_INCLUDED_RESOURCE_TYPES] : [...R5_DEFAULT_INCLUDED_RESOURCE_TYPES];
}

/**
 * Check if a resource type is available in a specific FHIR version
 */
export function isResourceTypeAvailableInVersion(resourceType: string, version: FHIRVersion): boolean {
  const allTypes = getAllResourceTypesForVersion(version);
  return allTypes.includes(resourceType);
}

/**
 * Get resource types that are not available in a specific FHIR version
 */
export function getUnavailableResourceTypes(resourceTypes: string[], version: FHIRVersion): string[] {
  const allTypes = getAllResourceTypesForVersion(version);
  return resourceTypes.filter(type => !allTypes.includes(type));
}

/**
 * Get resource types that are new in R5 (not available in R4)
 */
export function getR5SpecificResourceTypes(): string[] {
  const r4Types = R4_ALL_RESOURCE_TYPES as readonly string[];
  return (R5_ALL_RESOURCE_TYPES as readonly string[]).filter((type: string) => !r4Types.includes(type));
}

/**
 * Migrate resource type settings from one FHIR version to another
 */
export function migrateResourceTypesForVersion(
  resourceTypes: ValidationSettings['resourceTypes'],
  fromVersion: FHIRVersion,
  toVersion: FHIRVersion
): ValidationSettings['resourceTypes'] {
  if (fromVersion === toVersion) {
    return resourceTypes;
  }

  const toAllTypes = getAllResourceTypesForVersion(toVersion);
  
  // Filter out unavailable types
  const migratedIncludedTypes = resourceTypes.includedTypes.filter(type => 
    toAllTypes.includes(type)
  );
  
  const migratedExcludedTypes = resourceTypes.excludedTypes.filter(type => 
    toAllTypes.includes(type)
  );

  // If no included types remain, use defaults for the target version
  const finalIncludedTypes = migratedIncludedTypes.length > 0 
    ? migratedIncludedTypes 
    : getDefaultIncludedTypesForVersion(toVersion);

  return {
    enabled: resourceTypes.enabled,
    includedTypes: finalIncludedTypes,
    excludedTypes: migratedExcludedTypes
  };
}

// ============================================================================
// Resource Type Filtering Utilities
// ============================================================================

/**
 * Get effective resource types to validate based on settings
 */
export function getEffectiveResourceTypes(
  resourceTypes: ValidationSettings['resourceTypes'],
  allAvailableTypes: string[]
): string[] {
  if (!resourceTypes.enabled) {
    return allAvailableTypes;
  }

  let effectiveTypes = resourceTypes.includedTypes.length > 0 
    ? resourceTypes.includedTypes 
    : allAvailableTypes;

  // Remove excluded types
  effectiveTypes = effectiveTypes.filter(type => 
    !resourceTypes.excludedTypes.includes(type)
  );

  return effectiveTypes;
}

/**
 * Check if a resource type should be validated
 */
export function shouldValidateResourceType(
  resourceType: string,
  resourceTypes: ValidationSettings['resourceTypes'],
  allAvailableTypes: string[]
): boolean {
  const effectiveTypes = getEffectiveResourceTypes(resourceTypes, allAvailableTypes);
  return effectiveTypes.includes(resourceType);
}


