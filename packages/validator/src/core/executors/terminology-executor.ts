/**
 * Terminology Executor
 * 
 * Validates terminology bindings:
 * - ValueSet binding validation
 * - CodeSystem validation
 * - Terminology expansion
 * - Binding strength enforcement
 */

import type { ValidationIssue } from '../../types';
import type { ElementDefinition, StructureDefinition } from '../structure-definition-types';
import { ValueSetValidator, type TerminologyResolutionConfig } from '../../validators/valueset-validator';
import { shouldValidateRequired } from '../../business-rules';
import { logger } from '../../logger';
import {
  UCUM_BEARING_TYPES,
  validateUcumAtPath,
} from './terminology-ucum-rules';
import {
  validateKnownLoincDisplays,
} from './terminology-display-rules';
import { validateExternalCodeSystems } from './terminology-external-code-system-rules';
import {
  effectiveBindingForElement,
  selectSliceScopedValues,
  selectValuesForBinding,
  shouldSuppressNonRequiredBindingForOwnFixedPattern,
  shouldSuppressValueSetSliceMembershipIssue,
  shouldValidateBindingForValue,
} from './terminology-binding-selection';
import { validateCodingHygiene } from './terminology-coding-hygiene-rules';
import { createValidationIssue } from '../../issues';
import { computeValidationIssueId } from '@records-fhir/validation-types';

// ============================================================================
// Types
// ============================================================================

export interface TerminologyValidationContext {
  resource: any;
  structureDef: StructureDefinition;
  getValueAtPath: (resource: any, path: string) => any;
  fhirVersion?: 'R4' | 'R5' | 'R6';
}

// ============================================================================
// Terminology Executor
// ============================================================================

export class TerminologyExecutor {
  private valuesetValidator: ValueSetValidator;

  constructor() {
    this.valuesetValidator = new ValueSetValidator();
  }

  /**
   * Configure terminology resolution strategy
   * Call this when settings change to update the underlying ValueSetValidator
   */
  configureResolution(config: Partial<TerminologyResolutionConfig>): void {
    this.valuesetValidator.setResolutionConfig(config);
    logger.info(`[TerminologyExecutor] Resolution configured: strategy=${config.strategy}`);
  }

  /**
   * Get current resolution configuration
   */
  getResolutionConfig(): TerminologyResolutionConfig {
    return this.valuesetValidator.getResolutionConfig();
  }

  /**
   * Clear caches (call on settings change)
   */
  clearCache(): void {
    this.valuesetValidator.clearCache();
    logger.info('[TerminologyExecutor] Cache cleared');
  }

  /**
   * Validate terminology bindings
   */
  async validate(
    context: TerminologyValidationContext
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      const { resource, structureDef, getValueAtPath } = context;
      const profileUrl = structureDef.url;
      const fhirVersion = context.fhirVersion ?? 'R4';

      if (structureDef.snapshot?.element) {
        for (const elementDef of structureDef.snapshot.element) {
          issues.push(...await this.validateElementDefinition({
            resource,
            elementDef,
            structureDef,
            getValueAtPath,
            profileUrl,
            fhirVersion,
          }));
        }
      }

      issues.push(...validateKnownLoincDisplays(resource));
      issues.push(...validateCodingHygiene(resource, issues));

      return issues;

    } catch (error) {
      logger.error('[TerminologyExecutor] Validation error:', error);
      return [createValidationIssue({
        code: 'validation-error',
        path: '',
        resourceType: context.resource?.resourceType || context.structureDef?.type || 'Resource',
        aspectOverride: 'terminology',
        severityOverride: 'error',
        customMessage: `Terminology validation failed: ${error instanceof Error ? error.message : String(error)}`,
      })];
    }
  }

  private async validateElementDefinition(params: {
    resource: any;
    elementDef: ElementDefinition;
    structureDef: StructureDefinition;
    getValueAtPath: (resource: any, path: string) => any;
    profileUrl?: string;
    fhirVersion: 'R4' | 'R5' | 'R6';
  }): Promise<ValidationIssue[]> {
    const { resource, elementDef, structureDef, getValueAtPath, profileUrl, fhirVersion } = params;
    const issues: ValidationIssue[] = [];

    if (elementDef.binding) {
      issues.push(...await this.validateElementBinding({
        resource,
        elementDef,
        structureDef,
        getValueAtPath,
        profileUrl,
        fhirVersion,
      }));
    }

    const path = elementDef.path;
    const elementTypes = elementDef.type?.map(t => t.code) || [];
    const isCodeableConcept = elementTypes.includes('CodeableConcept');
    const isCodingType = elementTypes.includes('Coding');

    if (isCodeableConcept) {
      const value = getValueAtPath(resource, path);
      const codeableConcepts = Array.isArray(value) ? value : [value];
      for (let index = 0; index < codeableConcepts.length; index++) {
        const concept = codeableConcepts[index];
        if (!concept || typeof concept !== 'object' || !Array.isArray(concept.coding)) {
          continue;
        }
        const codingPath = Array.isArray(value) ? `${path}[${index}].coding` : `${path}.coding`;
        issues.push(...await validateExternalCodeSystems(concept.coding, codingPath, this.valuesetValidator));
      }
    } else if (isCodingType) {
      const value = getValueAtPath(resource, path);
      const codings = Array.isArray(value) ? value : [value];
      if (Array.isArray(codings)) {
        issues.push(...await validateExternalCodeSystems(codings, path, this.valuesetValidator));
      }
    }

    const hasUcumBearingType = elementTypes.some(t => UCUM_BEARING_TYPES.has(t));
    const isPolymorphicWithQuantity = path.endsWith('[x]') && hasUcumBearingType;
    if (hasUcumBearingType || isPolymorphicWithQuantity) {
      issues.push(...validateUcumAtPath(resource, elementDef, path));
    }

    return issues;
  }

  private async validateElementBinding(params: {
    resource: any;
    elementDef: ElementDefinition;
    structureDef: StructureDefinition;
    getValueAtPath: (resource: any, path: string) => any;
    profileUrl?: string;
    fhirVersion: 'R4' | 'R5' | 'R6';
  }): Promise<ValidationIssue[]> {
    const { resource, elementDef, structureDef, getValueAtPath, profileUrl, fhirVersion } = params;
    const path = elementDef.path;
    const sliceSelection = selectSliceScopedValues(resource, elementDef, structureDef, getValueAtPath);
    if (sliceSelection && !sliceSelection.hasMatchingSliceElements) return [];

    const value = sliceSelection
      ? (sliceSelection.values.length === 0
          ? undefined
          : sliceSelection.values.length === 1 ? sliceSelection.values[0] : sliceSelection.values)
      : getValueAtPath(resource, path);

    if (elementDef.binding?.strength === 'required' && (elementDef.min ?? 0) > 0) {
      const shouldReportMissingRequiredBinding = (value === null || value === undefined) &&
        shouldValidateRequired(resource, path) &&
        (Boolean(sliceSelection) || isDirectResourceElementPath(path, resource?.resourceType || structureDef.type));

      if (shouldReportMissingRequiredBinding) {
        const resourceType = resource?.resourceType || structureDef.type || 'Resource';
        const message = `Required binding for '${path}' is missing (binding strength: required)`;
        const details = {
          bindingStrength: 'required',
          fieldPath: path,
        };
        return [{
          id: computeValidationIssueId({
            aspect: 'terminology',
            severity: 'error',
            code: 'binding-required-missing',
            path,
            resourceType,
            message,
            profile: profileUrl,
            details,
          }),
          aspect: 'terminology',
          severity: 'error',
          code: 'binding-required-missing',
          message,
          path,
          timestamp: new Date(),
          profile: profileUrl,
          details,
        }];
      }
    }

    if (value === null || value === undefined || !shouldValidateBindingForValue(elementDef, value)) {
      return [];
    }

    const issues: ValidationIssue[] = [];
    const effectiveBinding = effectiveBindingForElement(elementDef);
    for (const candidateValue of selectValuesForBinding(elementDef, value, structureDef)) {
      if (shouldSuppressNonRequiredBindingForOwnFixedPattern(elementDef, candidateValue)) {
        continue;
      }
      const bindingIssues = await this.valuesetValidator.validateBinding(
        candidateValue,
        effectiveBinding,
        path,
        { profileUrl, fhirVersion },
      );
      if (!shouldSuppressValueSetSliceMembershipIssue(elementDef, structureDef, bindingIssues)) {
        issues.push(...bindingIssues);
      }
    }
    return issues;
  }

}

function isDirectResourceElementPath(path: string, resourceType?: string): boolean {
  if (!resourceType) return false;
  const normalizedPath = path.replace(/\[[^\]]+\]/g, '');
  const segments = normalizedPath.split('.').filter(Boolean);
  return segments.length === 2 && segments[0] === resourceType;
}
