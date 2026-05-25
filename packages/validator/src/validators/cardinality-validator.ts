/* eslint-disable max-lines-per-function */
/**
 * Cardinality Validator
 *
 * Validates min/max occurrence constraints on FHIR elements
 * Supports: 0..1, 1..1, 0..*, 1..*, and specific numbers
 * 
 * Handles conditional cardinality: child elements are only required
 * when their parent elements exist (e.g., Patient.communication.language
 * is only required if Patient.communication exists)
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { ElementDefinition } from '../core/structure-definition-types';
import { shouldValidateRequired, getValidationTargets } from '../business-rules';
import { logger } from '../logger';

// ============================================================================
// Cardinality Validator
// ============================================================================

const CHOICE_BASES = [
  'value', 'effective', 'onset', 'abatement', 'deceased', 'multipleBirth',
  'defaultValue', 'medication', 'reported', 'occurrence', 'timing',
  'product', 'serviced', 'location', 'allowed', 'used',
  'rate', 'born', 'age',
];

function hasChoiceValue(element: any, base: string): boolean {
  if (!element || typeof element !== 'object') return false;
  if (element[base] !== undefined && element[base] !== null) return true;

  return Object.keys(element).some(key =>
    key.startsWith(base) &&
    key.length > base.length &&
    key[base.length] === key[base.length].toUpperCase() &&
    element[key] !== undefined &&
    element[key] !== null
  );
}

function hasAnyChoiceValue(element: any): boolean {
  return CHOICE_BASES.some(base => hasChoiceValue(element, base));
}

function shouldSkipObservationAlternativeMustSupport(resource: any, path: string): boolean {
  if (!resource || resource.resourceType !== 'Observation') return false;

  if (/^Observation\.value\[x\]$/i.test(path)) {
    return (resource.dataAbsentReason !== undefined && resource.dataAbsentReason !== null) ||
      (Array.isArray(resource.component) && resource.component.some(hasAnyChoiceValue));
  }

  if (/^Observation\.component$/i.test(path)) {
    return hasChoiceValue(resource, 'value') ||
      (resource.dataAbsentReason !== undefined && resource.dataAbsentReason !== null);
  }

  if (/^Observation\.dataAbsentReason$/i.test(path)) {
    return hasChoiceValue(resource, 'value') ||
      (Array.isArray(resource.component) && resource.component.some(hasAnyChoiceValue));
  }

  if (/^Observation\.component(?::[^.]+)?\.dataAbsentReason$/i.test(path)) {
    return Array.isArray(resource.component) &&
      resource.component.length > 0 &&
      resource.component.every(hasAnyChoiceValue);
  }

  return false;
}

function shouldSkipContextualMustSupport(resource: any, path: string): boolean {
  if (!resource) return false;

  if (resource.resourceType === 'Encounter' && /^Encounter\.hospitalization$/i.test(path)) {
    const classCode = resource.class?.code;
    return typeof classCode === 'string' && classCode !== 'IMP';
  }

  if (resource.resourceType === 'Encounter' && /^Encounter\.reasonCode$/i.test(path)) {
    return (Array.isArray(resource.type) && resource.type.length > 0) ||
      (Array.isArray(resource.reasonReference) && resource.reasonReference.length > 0) ||
      (Array.isArray(resource.diagnosis) && resource.diagnosis.length > 0);
  }

  if (resource.resourceType === 'Patient' && /^Patient\.address\.period$/i.test(path)) {
    return !Array.isArray(resource.address) ||
      !resource.address.some((address: any) => address?.use === 'old');
  }

  return false;
}

function resourceTypeFromPath(path: string): string {
  const firstSegment = path.split('.')[0]?.replace(/\[[^\]]+\]/g, '');
  return firstSegment || 'Unknown';
}

export class CardinalityValidator {
  private mustSupportSeverity: 'error' | 'warning' | 'information' = 'warning';

  /**
   * Configure mustSupport validation severity
   */
  setMustSupportSeverity(severity: 'error' | 'warning' | 'information'): void {
    this.mustSupportSeverity = severity;
  }

  /**
   * Validate cardinality of an element
   * 
   * @param value - Current value at the element path
   * @param elementDef - Element definition from StructureDefinition
   * @param path - Element path (e.g., "Patient.communication.language")
   * @param profileUrl - Profile URL for error context
   * @param resource - Full resource for parent existence checking
   */
  validate(
    value: any,
    elementDef: ElementDefinition,
    path: string,
    profileUrl?: string,
    resource?: any
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Get min and max from element definition
    const min = elementDef.min ?? 0;
    const max = elementDef.max ?? '*';

    // Determine actual count
    const count = this.getCount(value);

    // Check for array vs scalar type mismatch (HAPI parity)
    // If element is repeating (max > 1 or *) but value is a non-array scalar
    // BUT skip if the path implies we are validating a specific array item (ends in [n])
    if (value !== undefined && value !== null && !Array.isArray(value) && this.isRepeating(elementDef) && !path.match(/\[\d+\]$/)) {
      // Get the element name from path for better error message
      const elementName = path.split('.').pop() || path;
      issues.push(createValidationIssue({
        code: 'structural-validation-error',
        path,
        resourceType: resource?.resourceType || resourceTypeFromPath(path),
        profile: profileUrl,
        customMessage: `Element '${elementName}' must be an array (max cardinality is ${max})`,
        messageParams: { element: elementName, max },
        severityOverride: 'error',  // Match HAPI severity
      }));
    }

    // Validate minimum cardinality
    // Only check if parent exists (conditional cardinality)
    if (count < min) {
      // Check if parent element exists before flagging as error
      const shouldValidate = resource ? shouldValidateRequired(resource, path) : true;

      if (shouldValidate) {
        issues.push(createValidationIssue({
          code: 'structural-cardinality-min',
          path,
          resourceType: resource?.resourceType || resourceTypeFromPath(path),
          profile: profileUrl,
          messageParams: { element: path, actual: count, min },
        }));
      } else {
        // Parent doesn't exist - child element is not required
        logger.debug(
          `[CardinalityValidator] Skipping min cardinality check for '${path}' ` +
          `(parent doesn't exist - conditional cardinality)`
        );
      }
    }

    // Validate maximum cardinality (if not unbounded)
    if (max !== '*') {
      const maxNum = parseInt(max, 10);
      if (!isNaN(maxNum) && count > maxNum) {
        issues.push(createValidationIssue({
          code: 'structural-cardinality-max',
          path,
          resourceType: resource?.resourceType || resourceTypeFromPath(path),
          profile: profileUrl,
          messageParams: { element: path, actual: count, max },
        }));
      }
    }

    // Validate mustSupport
    if (elementDef.mustSupport === true) {
      // Only validate mustSupport if parent element exists (conditional mustSupport)
      const shouldValidateMustSupport = resource ? shouldValidateRequired(resource, path) : true;
      const shouldSkipObservationAlternative =
        shouldSkipObservationAlternativeMustSupport(resource, path);
      const shouldSkipContextual =
        shouldSkipContextualMustSupport(resource, path);

      if (
        shouldValidateMustSupport &&
        !shouldSkipObservationAlternative &&
        !shouldSkipContextual
      ) {
        // Double-check that element truly doesn't exist before reporting mustSupport-missing
        // The 'value' parameter might be undefined even if the element exists in the resource
        let elementActuallyExists = count > 0;

        if (!elementActuallyExists && resource) {
          // Use getValidationTargets to check if element exists (handles arrays correctly)
          const validationTargets = getValidationTargets(resource, path);
          if (validationTargets.length > 0) {
            // Check if any target has a non-empty value
            const hasNonEmptyValue = validationTargets.some(target => {
              const targetValue = target.value;
              if (targetValue === undefined || targetValue === null) {
                return false;
              }
              if (Array.isArray(targetValue)) {
                return targetValue.length > 0;
              }
              if (typeof targetValue === 'object') {
                return Object.keys(targetValue).length > 0;
              }
              if (typeof targetValue === 'string') {
                return targetValue.trim().length > 0;
              }
              return true;
            });
            elementActuallyExists = hasNonEmptyValue;
          }
        }

        const mustSupportIssues = this.validateMustSupport(
          value,
          count,
          path,
          profileUrl,
          elementActuallyExists,
          resource?.resourceType || resourceTypeFromPath(path)
        );
        issues.push(...mustSupportIssues);
      } else if (!shouldValidateMustSupport) {
        // Parent doesn't exist - child element is not mustSupport required
        logger.debug(
          `[CardinalityValidator] Skipping mustSupport check for '${path}' ` +
          `(parent doesn't exist - conditional mustSupport)`
        );
      } else {
        logger.debug(
          `[CardinalityValidator] Skipping mustSupport check for '${path}' ` +
          `(contextual applicability rule matched)`
        );
      }
    }

    return issues;
  }

  /**
   * Validate mustSupport elements
   */
  private validateMustSupport(
    value: any,
    count: number,
    path: string,
    profileUrl?: string,
    elementActuallyExists?: boolean,
    resourceType?: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // If mustSupport element is missing (count = 0) AND it actually doesn't exist, flag it
    // elementActuallyExists is an optional parameter that indicates a double-check was performed
    // If it's true, the element exists even though count might be 0 (e.g., due to path resolution issues)
    if (count === 0 && elementActuallyExists !== true) {
      issues.push(createValidationIssue({
        code: 'profile-mustsupport-missing',
        path,
        resourceType: resourceType || resourceTypeFromPath(path),
        profile: profileUrl,
        messageParams: { element: path },
        severityOverride: this.mustSupportSeverity === 'information'
          ? 'info'
          : this.mustSupportSeverity,
      }));
    }

    return issues;
  }

  /**
   * Get count of elements
   * Returns 0 if undefined/null, 1 if single value, array.length if array
   */
  private getCount(value: any): number {
    if (value === undefined || value === null) {
      return 0;
    }

    if (Array.isArray(value)) {
      return value.length;
    }

    return 1;
  }

  /**
   * Check if element is required (min > 0)
   */
  isRequired(elementDef: ElementDefinition): boolean {
    return (elementDef.min ?? 0) > 0;
  }

  /**
   * Check if element is repeating (max > 1 or *)
   * Returns false when max is undefined – elements without an explicit max constraint
   * are not considered repeating (avoids false positives from differential-only SDs
   * where child elements are added without inheriting parent cardinality).
   */
  isRepeating(elementDef: ElementDefinition): boolean {
    const max = elementDef.max;
    if (max === undefined || max === null) {
      return false;
    }
    if (max === '*') {
      return true;
    }

    const maxNum = parseInt(max, 10);
    return !isNaN(maxNum) && maxNum > 1;
  }

  /**
   * Get cardinality as string (e.g., "0..1", "1..*")
   */
  getCardinalityString(elementDef: ElementDefinition): string {
    const min = elementDef.min ?? 0;
    const max = elementDef.max ?? '*';
    return `${min}..${max}`;
  }
}
