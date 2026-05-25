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

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import { validateUrnUuid } from './terminology-resource-utils';
import {
  validateCodeSystemResource,
  validateContainedCodeSystemResource,
} from './codesystem-resource-validator';
import { validateConceptMapResource } from './conceptmap-resource-validator';
import { validateValueSetComposeFilters } from './valueset-compose-filter-validator';
import { validateValueSetExpansion } from './valueset-expansion-validator';

// ============================================================================
// Constants
// ============================================================================

// ============================================================================
// Validator
// ============================================================================

export class TerminologyResourceValidator {
  /**
   * Validate terminology-specific business rules on a resource.
   * Returns empty array for non-CodeSystem/ValueSet resources.
   */
  validate(resource: any): ValidationIssue[] {
    if (!resource || typeof resource !== 'object') return [];

    switch (resource.resourceType) {
      case 'CodeSystem':
        return validateCodeSystemResource(resource);
      case 'ValueSet':
        return this.validateValueSet(resource);
      case 'ConceptMap':
        return validateConceptMapResource(resource);
      default:
        return [];
    }
  }

  // ==========================================================================
  // ValueSet
  // ==========================================================================

  private validateValueSet(vs: any): ValidationIssue[] {
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
        if (contained?.resourceType === 'CodeSystem') {
          issues.push(...validateContainedCodeSystemResource(contained, i));
        }
      }
    }

    // --- compose.include.system must be absolute + filter checks ---
    if (vs.compose?.include && Array.isArray(vs.compose.include)) {
      for (let i = 0; i < vs.compose.include.length; i++) {
        const include = vs.compose.include[i];
        const system = include?.system;
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
        ));
      }
    }

    // --- compose.exclude[] filters get the same treatment ---
    if (vs.compose?.exclude && Array.isArray(vs.compose.exclude)) {
      for (let i = 0; i < vs.compose.exclude.length; i++) {
        issues.push(...validateValueSetComposeFilters(
          vs.compose.exclude[i],
          `ValueSet.compose.exclude[${i}]`,
        ));
      }
    }

    // --- ValueSet.expansion best-practice checks ---
    if (vs.expansion && typeof vs.expansion === 'object') {
      issues.push(...validateValueSetExpansion(vs.expansion));
    }

    return issues;
  }
}

// Singleton
export const terminologyResourceValidator = new TerminologyResourceValidator();
