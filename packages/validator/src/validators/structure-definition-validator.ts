/**
 * StructureDefinition Business Rule Validator
 *
 * Validates StructureDefinition-specific business rules that the Java
 * validator enforces. These are meta-validation rules about SDs
 * themselves — not profile-driven validation of instance resources.
 *
 * Lookup tables live in `sd-wg-mappings.ts` to keep this file under
 * the 400-line lint threshold.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import {
  R4_ELEMENT_DEFINITION_ELEMENTS, R4_ELEMENT_DEFINITION_NESTED_CONTEXT_ELEMENTS,
} from './sd-wg-mappings.js';
import {
  validateStructureDefinitionStatusConsistency,
  validateStructureDefinitionWgConsistency,
} from './structure-definition-metadata-rules.js';
import type {
  ElementDefinition,
  StructureDefinition,
} from '../core/structure-definition-types.js';
import { validateStructureDefinitionPatterns } from './structure-definition-pattern-rules.js';
import {
  validateStructureDefinitionDifferentialPaths,
  validateStructureDefinitionElementNames,
} from './structure-definition-element-path-rules.js';

// ============================================================================
// Validator
// ============================================================================

export class StructureDefinitionValidator {
  validate(resource: unknown): ValidationIssue[] {
    if (!isRecord(resource) || resource.resourceType !== 'StructureDefinition') return [];
    const sd = resource as StructureDefinition;

    const issues: ValidationIssue[] = [];
    issues.push(...validateStructureDefinitionWgConsistency(sd));
    issues.push(...validateStructureDefinitionStatusConsistency(sd));
    issues.push(...this.validateExtensionFixedUrl(sd));
    issues.push(...this.validateContextValidity(sd));
    issues.push(...this.validateExtensionContextType(sd));
    issues.push(...this.validateRootSlicing(sd));
    issues.push(...validateStructureDefinitionElementNames(sd));
    issues.push(...validateStructureDefinitionDifferentialPaths(sd));
    issues.push(...this.validateSliceMustSupport(sd));
    issues.push(...this.validateBaseDefinition(sd));
    issues.push(...validateStructureDefinitionPatterns(sd));

    return issues;
  }

  /**
   * Extension fixedUri vs canonical URL mismatch.
   *
   * Case 1: fixedUri differs from the SD's own canonical URL.
   * Case 2: derived extension overrides fixedUri (violates fixed-value rule).
   */
  private validateExtensionFixedUrl(sd: StructureDefinition): ValidationIssue[] {
    if (sd.type !== 'Extension' || typeof sd.url !== 'string' || !sd.url) return [];
    const issues: ValidationIssue[] = [];

    for (const elem of getDifferentialElements(sd)) {
      if (elem.path !== 'Extension.url' || typeof elem.fixedUri !== 'string') continue;

      if (elem.fixedUri !== sd.url) {
        issues.push(createValidationIssue({
          code: 'sd-extension-url-mismatch',
          path: 'StructureDefinition',
          resourceType: 'StructureDefinition',
          customMessage:
            `The fixed value for the extension URL is ${elem.fixedUri} ` +
            `which doesn't match the canonical URL ${sd.url}`,
          severityOverride: 'error',
        }));
      } else if (
        sd.baseDefinition
        && sd.baseDefinition !== 'http://hl7.org/fhir/StructureDefinition/Extension'
        && typeof sd.baseDefinition === 'string'
        && looksLikeStructureDefinitionCanonical(sd.baseDefinition)
        && sd.url !== sd.baseDefinition
      ) {
        // Derived extension overrides fixedUri from parent
        issues.push(createValidationIssue({
          code: 'sd-extension-fixed-url-override',
          path: 'Extension.url',
          resourceType: 'StructureDefinition',
          customMessage:
            `Value is '${elem.fixedUri}' but is fixed to '${sd.baseDefinition}' ` +
            `in the profile , because the value must match the fixed value`,
          severityOverride: 'error',
        }));
      }
    }
    return issues;
  }

  /** Validate context expressions — e.g. ElementDefinition.targetProfile is not valid in R4. */
  private validateContextValidity(sd: StructureDefinition): ValidationIssue[] {
    const contexts = getRecordArray(sd.context);
    const issues: ValidationIssue[] = [];

    for (let i = 0; i < contexts.length; i++) {
      const ctx = contexts[i];
      if (ctx.type !== 'element' || typeof ctx.expression !== 'string') continue;
      if (ctx.expression.startsWith('ElementDefinition.')) {
        const sub = ctx.expression.replace('ElementDefinition.', '');
        if (
          !R4_ELEMENT_DEFINITION_ELEMENTS.has(sub) &&
          !R4_ELEMENT_DEFINITION_NESTED_CONTEXT_ELEMENTS.has(sub)
        ) {
          issues.push(createValidationIssue({
            code: 'sd-context-invalid-element',
            path: `StructureDefinition.context[${i}]`,
            resourceType: 'StructureDefinition',
            customMessage: `The element ${ctx.expression} is not valid`,
            severityOverride: 'error',
          }));
        }
      }
    }
    return issues;
  }

  /** Extension context type review — "Element" context is suspicious. */
  private validateExtensionContextType(sd: StructureDefinition): ValidationIssue[] {
    const contexts = getRecordArray(sd.context);
    if (sd.type !== 'Extension') return [];
    const issues: ValidationIssue[] = [];

    for (let i = 0; i < contexts.length; i++) {
      const ctx = contexts[i];
      if (ctx.type === 'element' && ctx.expression === 'Element') {
        const canonicalName = typeof sd.url === 'string' ? sd.url.split('/').pop() : undefined;
        const name = sd.name || sd.id || canonicalName || 'unknown';
        issues.push(createValidationIssue({
          code: 'business-rule-extension-context-element',
          path: `StructureDefinition.context[${i}]`,
          resourceType: 'StructureDefinition',
          customMessage:
            `Review the extension type for ${name}: extensions should not have a context of ` +
            `Element unless it's really intended that they can be used anywhere`,
          severityOverride: 'warning',
        }));
      }
    }
    return issues;
  }

  /** sdf-20: No slicing on the root element. */
  private validateRootSlicing(sd: StructureDefinition): ValidationIssue[] {
    const diffElements = getDifferentialElements(sd);
    if (diffElements.length === 0) return [];

    const rootIndex = diffElements.findIndex((element) => element.path === sd.type && element.slicing);
    if (rootIndex < 0) return [];

    return [
      createValidationIssue({
        code: 'sd-sdf-20-root-slicing',
        path: 'StructureDefinition.differential',
        resourceType: 'StructureDefinition',
        customMessage: `Constraint failed: sdf-20: 'No slicing on the root element'`,
        severityOverride: 'error',
      }),
      createValidationIssue({
        code: 'sd-root-slicing-invalid',
        path: `StructureDefinition.differential.element[${rootIndex}]`,
        resourceType: 'StructureDefinition',
        customMessage: 'Slicing is not allowed at the root of a profile',
        severityOverride: 'error',
      }),
    ];
  }

  /** Must-support consistency: sliced elements with mustSupport=true expect slices to match. */
  private validateSliceMustSupport(sd: StructureDefinition): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const diffElements = getDifferentialElements(sd);

    for (const elem of diffElements) {
      if (!elem?.slicing || elem.mustSupport !== true) continue;
      for (const slice of diffElements) {
        if (!slice?.id || slice === elem || slice.path !== elem.path) continue;
        const colonIdx = slice.id.lastIndexOf(':');
        if (colonIdx < 0) continue;
        if (slice.mustSupport === false) {
          issues.push(createValidationIssue({
            code: 'sd-slice-must-support',
            path: 'StructureDefinition.differential',
            resourceType: 'StructureDefinition',
            customMessage:
              `The slice '${slice.id.slice(colonIdx + 1)}' on path '${elem.path}' is not marked as ` +
              `'must-support' which is not consistent with the element that defines the slicing, where 'must-support' is true`,
            severityOverride: 'warning',
          }));
        }
      }
    }
    return issues;
  }

  /** Detect self-referencing baseDefinition (circular). */
  private validateBaseDefinition(sd: StructureDefinition): ValidationIssue[] {
    if (
      typeof sd.baseDefinition !== 'string' ||
      typeof sd.url !== 'string' ||
      sd.baseDefinition !== sd.url
    ) return [];
    return [createValidationIssue({
      code: 'sd-base-circular',
      path: 'StructureDefinition',
      resourceType: 'StructureDefinition',
      customMessage:
        `Unable to find base ${sd.baseDefinition} for StructureDefinition, so can't check the differential`,
      severityOverride: 'warning',
    })];
  }
}

function getDifferentialElements(sd: StructureDefinition): ElementDefinition[] {
  return getElementArray(sd.differential);
}

function getElementArray(section: unknown): ElementDefinition[] {
  if (!isRecord(section) || !Array.isArray(section.element)) return [];
  return section.element.filter(isRecord) as ElementDefinition[];
}

function getRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeStructureDefinitionCanonical(value: string): boolean {
  return /\/StructureDefinition\/[^/]+$/.test(value);
}
