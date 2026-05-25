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
import { ucumCodeHasAnnotation, validateUcumCode } from '../../validators/ucum-validator';
import { logger } from '../../logger';
import {
  buildInvalidUcumIssueDetails,
  buildInvalidUcumMessage,
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

// ============================================================================
// Types
// ============================================================================

export interface TerminologyValidationContext {
  resource: any;
  structureDef: StructureDefinition;
  getValueAtPath: (resource: any, path: string) => any;
  fhirVersion?: 'R4' | 'R5' | 'R6';
}

function isCodingHygienePath(path: string): boolean {
  return (
    /\.coding\[\d+\]$/.test(path) ||
    /\.(?:value|answer|pattern|fixed)Coding$/.test(path)
  );
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
      issues.push(...this.validateCodingHygiene(resource, issues));

      return issues;

    } catch (error) {
      logger.error('[TerminologyExecutor] Validation error:', error);
      return [{
        id: `terminology-executor-error-${Date.now()}`,
        aspect: 'terminology',
        severity: 'error',
        code: 'validation-error',
        message: `Terminology validation failed: ${error instanceof Error ? error.message : String(error)}`,
        path: '',
        timestamp: new Date()
      }];
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
      if (sliceSelection && (value === null || value === undefined) && shouldValidateRequired(resource, path)) {
        return [{
          id: `terminology-required-binding-missing-${Date.now()}`,
          aspect: 'terminology',
          severity: 'error',
          code: 'binding-required-missing',
          message: `Required binding for '${path}' is missing (binding strength: required)`,
          path,
          timestamp: new Date(),
          profile: profileUrl,
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

  private validateCodingHygiene(resource: any, existingIssues: ValidationIssue[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const seen = new Set(existingIssues.map(issue => `${issue.code}|${issue.path}`));
    const root = resource?.resourceType || 'Resource';

    const pushOnce = (issue: Omit<ValidationIssue, 'id' | 'aspect' | 'timestamp'>): void => {
      const key = `${issue.code}|${issue.path}`;
      if (seen.has(key)) return;
      seen.add(key);
      issues.push({
        id: `terminology-coding-hygiene-${Date.now()}-${issues.length}`,
        aspect: 'terminology',
        timestamp: new Date(),
        ...issue,
      });
    };

    const visit = (value: any, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}[${index}]`));
        return;
      }

      if (!value || typeof value !== 'object') return;

      if (typeof value.code === 'string' && !value.system && isCodingHygienePath(path)) {
        pushOnce({
          severity: 'warning',
          code: 'terminology-coding-missing-system',
          message: 'Coding has no system. A code with no system has no defined meaning, and it cannot be validated. A system should be provided',
          path,
        });
      }

      if (value.system === 'http://unitsofmeasure.org' && typeof value.code === 'string') {
        const result = validateUcumCode(value.code);
        if (result.valid && ucumCodeHasAnnotation(value.code)) {
          pushOnce({
            severity: 'information',
            code: 'terminology-ucum-annotation',
            message: `UCUM code '${value.code}' at ${path}.code contains a human-readable annotation. UCUM annotations are ignored semantically, so validation should not depend on them`,
            path: `${path}.code`,
          });
        } else if (!result.valid) {
          pushOnce({
            severity: 'error',
            code: 'terminology-code-invalid',
            message: buildInvalidUcumMessage(value.code, `${path}.code`, result.message),
            path: `${path}.code`,
            details: buildInvalidUcumIssueDetails(value.code, `${path}.code`, result.message),
          });
        }
      }

      for (const [key, child] of Object.entries(value)) {
        if (root === 'Bundle' && key === 'resource' && /^Bundle\.entry\[\d+\]$/.test(path)) {
          continue;
        }
        visit(child, `${path}.${key}`);
      }
    };

    visit(resource, root);
    return issues;
  }

}
