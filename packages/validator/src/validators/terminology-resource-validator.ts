/**
 * Terminology Resource Validator
 *
 * Validates CodeSystem and ValueSet resources for terminology-specific
 * business rules that the Java reference validator checks:
 *
 * CodeSystem:
 * - caseSensitive SHOULD be stated (warning for HL7-defined CodeSystems)
 * - Concepts SHOULD have a definition (warning for HL7-defined CodeSystems)
 * - Complete CodeSystem with no concepts (warning)
 * - Canonical URL must be absolute
 * - Concept property valueCoding codes must exist in the referenced CodeSystem
 *   (when that CodeSystem is available in the local cache)
 *
 * ValueSet:
 * - Canonical URL must be absolute
 * - compose.include.system must be absolute (not fragment reference)
 * - Contained CodeSystem canonical URL must be absolute
 * - compose.include.filter[].op must be one of the FHIR-defined operators
 * - compose.include.filter[].property must exist on the referenced CodeSystem
 *   (when that CodeSystem is available in the local cache)
 * - For `=` filters on Coding-typed properties, value must be in
 *   `system(|version)#code` format and the code must exist in the referenced
 *   sub-CodeSystem
 * - For `regex` filters, value must compile as a valid JS RegExp
 *
 * UUID validation:
 * - urn:uuid: values must contain valid, lowercase UUIDs
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { validateUrnUuid } from './terminology-resource-utils.js';
import {
  validateCodeSystemResource,
  validateContainedCodeSystemResource,
} from './codesystem-resource-validator.js';
import { validateConceptMapResource } from './conceptmap-resource-validator.js';
import { validateValueSetComposeFilters } from './valueset-compose-filter-validator.js';
import { validateValueSetExpansion } from './valueset-expansion-validator.js';
import { ValueSetCache } from './valueset-cache.js';

// ============================================================================
// Constants
// ============================================================================

// ============================================================================
// Validator
// ============================================================================

export class TerminologyResourceValidator {
  constructor(private readonly cache: ValueSetCache = new ValueSetCache()) {}
  /**
   * Validate terminology-specific business rules on a resource.
   * Returns empty array for non-CodeSystem/ValueSet resources.
   */
  validate(
    resource: unknown,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): ValidationIssue[] {
    const resourceRecord = asRecord(resource);
    if (!resourceRecord) return [];

    switch (resourceRecord.resourceType) {
      case 'CodeSystem':
        return validateCodeSystemResource(resourceRecord, fhirVersion, this.cache);
      case 'ValueSet':
        return this.validateValueSet(resourceRecord);
      case 'ConceptMap':
        return validateConceptMapResource(resourceRecord, this.cache);
      default:
        return [];
    }
  }

  // ==========================================================================
  // ValueSet
  // ==========================================================================

  private validateValueSet(vs: Record<string, unknown>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const url = typeof vs.url === 'string' ? vs.url : '';

    // NOTE: Top-level URL absoluteness is already checked by the
    // structural executor's uri-format-validator, so we skip it here
    // to avoid duplicate errors in the OperationOutcome.

    // --- urn:uuid: must be valid ---
    if (url.startsWith('urn:uuid:')) {
      const { valid, uuid } = validateUrnUuid(url);
      if (!valid) {
        issues.push(createValidationIssue({
          code: 'tx-valueset-url-invalid-uuid',
          path: 'ValueSet.url',
          resourceType: 'ValueSet',
          customMessage: `UUIDs must be valid and lowercase (${uuid})`,
          severityOverride: 'error',
        }));
      }
    }

    // --- Contained CodeSystem checks ---
    if (Array.isArray(vs.contained)) {
      for (let i = 0; i < vs.contained.length; i++) {
        const contained = vs.contained[i];
        if (asRecord(contained)?.resourceType === 'CodeSystem') {
          issues.push(...validateContainedCodeSystemResource(contained, i));
        }
      }
    }

    // --- compose.include.system must be absolute + filter checks ---
    const compose = asRecord(vs.compose);
    if (Array.isArray(compose?.include)) {
      for (let i = 0; i < compose.include.length; i++) {
        const include = compose.include[i];
        const system = asRecord(include)?.system;
        if (typeof system === 'string' && system.startsWith('#')) {
          issues.push(createValidationIssue({
            code: 'tx-valueset-compose-system-fragment',
            path: `ValueSet.compose.include[${i}]`,
            resourceType: 'ValueSet',
            customMessage:
              `URI values in ValueSet.compose.include.system must be absolute. ` +
              `To reference a contained code system, use the full CodeSystem URL ` +
              `and reference it using the http://hl7.org/fhir/StructureDefinition/valueset-system extension`,
            severityOverride: 'error',
          }));
        }

        issues.push(...validateValueSetComposeFilters(
          include,
          `ValueSet.compose.include[${i}]`,
          this.cache,
        ));
      }
    }

    // --- compose.exclude[] filters get the same treatment ---
    if (Array.isArray(compose?.exclude)) {
      for (let i = 0; i < compose.exclude.length; i++) {
        issues.push(...validateValueSetComposeFilters(
          compose.exclude[i],
          `ValueSet.compose.exclude[${i}]`,
          this.cache,
        ));
      }
    }

    // --- ValueSet.expansion best-practice checks ---
    if (vs.expansion && typeof vs.expansion === 'object') {
      issues.push(...validateValueSetExpansion(vs.expansion, compose));
    }

    return issues;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
