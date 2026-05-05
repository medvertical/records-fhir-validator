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

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import {
  WG_PUBLISHER, WG_CONTACT_URL,
  R4_ELEMENT_DEFINITION_ELEMENTS, STATUS_CONSISTENCY,
  CHOICE_TYPE_BASES, VALID_CHOICE_TYPE_SUFFIXES,
  CANONICAL_RESOURCE_TYPES,
} from './sd-wg-mappings';

// ============================================================================
// Validator
// ============================================================================

export class StructureDefinitionValidator {
  validate(resource: any): ValidationIssue[] {
    const rt = resource?.resourceType;
    if (!rt) return [];

    const issues: ValidationIssue[] = [];

    if (CANONICAL_RESOURCE_TYPES.has(rt)) {
      issues.push(...this.validateWgConsistency(resource));
    }

    if (rt === 'StructureDefinition') {
      issues.push(...this.validateStatusConsistency(resource));
      issues.push(...this.validateExtensionFixedUrl(resource));
      issues.push(...this.validateContextValidity(resource));
      issues.push(...this.validateExtensionContextType(resource));
      issues.push(...this.validateRootSlicing(resource));
      issues.push(...this.validateElementNames(resource));
      issues.push(...this.validateDifferentialPaths(resource));
      issues.push(...this.validateSliceMustSupport(resource));
      issues.push(...this.validateBaseDefinition(resource));
      issues.push(...this.validatePatternIdent1(resource));
    }

    return issues;
  }

  /**
   * WG extension -> publisher / contact consistency.
   * Java: "The nominated WG 'fhir' means that the publisher should be X but Y was found"
   */
  private validateWgConsistency(resource: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const rt = resource.resourceType;

    const wgExt = (resource.extension || []).find(
      (e: any) => e?.url === 'http://hl7.org/fhir/StructureDefinition/structuredefinition-wg'
    );
    if (!wgExt?.valueCode) return issues;

    const wg = wgExt.valueCode;
    const expectedPublisher = WG_PUBLISHER[wg];

    if (expectedPublisher && resource.publisher && resource.publisher !== expectedPublisher) {
      issues.push(createValidationIssue({
        code: 'business-rule-wg-publisher',
        path: rt,
        resourceType: rt,
        customMessage:
          `The nominated WG '${wg}' means that the publisher should be ` +
          `'${expectedPublisher}' but '${resource.publisher}' was found`,
        severityOverride: 'warning',
      }));
    }

    const expectedUrl = WG_CONTACT_URL[wg];
    if (expectedUrl) {
      const allContactUrls = extractContactUrls(resource.contact);
      if (!allContactUrls.includes(expectedUrl)) {
        issues.push(createValidationIssue({
          code: 'business-rule-wg-contact',
          path: rt,
          resourceType: rt,
          customMessage:
            `The nominated WG '${wg}' means that the contact url should be ` +
            `'${expectedUrl}' but it was not found`,
          severityOverride: 'warning',
        }));
      }
    }

    return issues;
  }

  /**
   * standards-status vs publication status consistency.
   * Java: "The resource status 'draft' and the standards status 'normative' are not consistent"
   */
  private validateStatusConsistency(sd: any): ValidationIssue[] {
    const stdStatusExt = (sd.extension || []).find(
      (e: any) => e?.url === 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status'
    );
    if (!stdStatusExt?.valueCode || !sd.status) return [];

    const allowed = STATUS_CONSISTENCY[stdStatusExt.valueCode];
    if (allowed && !allowed.includes(sd.status)) {
      return [createValidationIssue({
        code: 'business-rule-sd-status-consistency',
        path: 'StructureDefinition',
        resourceType: 'StructureDefinition',
        customMessage:
          `The resource status '${sd.status}' and the standards status '${stdStatusExt.valueCode}' are not consistent`,
        severityOverride: 'warning',
      })];
    }
    return [];
  }

  /**
   * Extension fixedUri vs canonical URL mismatch.
   *
   * Case 1: fixedUri differs from the SD's own canonical URL.
   * Case 2: derived extension overrides fixedUri (violates fixed-value rule).
   */
  private validateExtensionFixedUrl(sd: any): ValidationIssue[] {
    if (sd.type !== 'Extension' || !sd.url) return [];
    const issues: ValidationIssue[] = [];

    for (const elem of sd.differential?.element || []) {
      if (elem.path !== 'Extension.url' || !elem.fixedUri) continue;

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
  private validateContextValidity(sd: any): ValidationIssue[] {
    if (!Array.isArray(sd.context)) return [];
    const issues: ValidationIssue[] = [];

    for (let i = 0; i < sd.context.length; i++) {
      const ctx = sd.context[i];
      if (ctx?.type !== 'element' || !ctx.expression) continue;
      if (ctx.expression.startsWith('ElementDefinition.')) {
        const sub = ctx.expression.replace('ElementDefinition.', '');
        if (!R4_ELEMENT_DEFINITION_ELEMENTS.has(sub)) {
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
  private validateExtensionContextType(sd: any): ValidationIssue[] {
    if (sd.type !== 'Extension' || !Array.isArray(sd.context)) return [];
    const issues: ValidationIssue[] = [];

    for (let i = 0; i < sd.context.length; i++) {
      const ctx = sd.context[i];
      if (ctx?.type === 'element' && ctx.expression === 'Element') {
        const name = sd.name || sd.id || sd.url?.split('/').pop() || 'unknown';
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
  private validateRootSlicing(sd: any): ValidationIssue[] {
    const diffElements = sd.differential?.element || [];
    if (diffElements.length === 0) return [];

    const root = diffElements[0];
    if (!root?.slicing || root.path !== sd.type) return [];

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
        path: 'StructureDefinition.differential.element[0]',
        resourceType: 'StructureDefinition',
        customMessage: 'Slicing is not allowed at the root of a profile',
        severityOverride: 'error',
      }),
    ];
  }

  /** eld-19 / eld-20: element name constraints in differential. */
  private validateElementNames(sd: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (let i = 0; i < (sd.differential?.element || []).length; i++) {
      const elem = sd.differential.element[i];
      if (!elem?.path) continue;

      const hasEmptySegment = elem.path.includes('..');
      const parts = elem.path.split('.');
      let eld19 = hasEmptySegment;
      let eld20 = false;

      for (const part of parts) {
        if (!part || part === '[x]' || part.endsWith('[x]')) continue;
        if (!eld19 && /[^a-zA-Z0-9_[\]]/.test(part)) eld19 = true;
        const clean = part.replace(/\[x\]$/, '');
        if (clean && !/^[A-Za-z0-9_]{1,64}$/.test(clean)) eld20 = true;
      }

      if (eld19) {
        issues.push(createValidationIssue({
          code: 'sd-eld-19-element-name',
          path: `StructureDefinition.differential.element[${i}]`,
          resourceType: 'StructureDefinition',
          customMessage: `Constraint failed: eld-19: 'Element names cannot include some special characters'`,
          severityOverride: 'error',
        }));
      }
      if (eld20) {
        issues.push(createValidationIssue({
          code: 'sd-eld-20-element-name',
          path: `StructureDefinition.differential.element[${i}]`,
          resourceType: 'StructureDefinition',
          customMessage: `Constraint failed: eld-20: 'Element names should be simple alphanumerics with a max of 64 characters, or code generation tools may be broken'`,
          severityOverride: 'warning',
        }));
      }
    }
    return issues;
  }

  /** Detect bad paths in differential that would cause snapshot generation errors. */
  private validateDifferentialPaths(sd: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const baseType = sd.type;
    if (!baseType) return issues;

    for (const elem of sd.differential?.element || []) {
      if (!elem?.path) continue;
      if (elem.path.includes('..')) {
        issues.push(createValidationIssue({
          code: 'sd-snapshot-error-bad-path', path: 'StructureDefinition',
          resourceType: 'StructureDefinition',
          customMessage:
            `Error generating Snapshot: Invalid path '${elem.path}' in differential` +
            ` in ${sd.url || 'unknown'}: name portion missing ('..') ` +
            `(this usually arises from a problem in the differential)`,
          severityOverride: 'error',
        }));
      }
      if (elem.path.startsWith(baseType + '.')) {
        const sub = elem.path.slice(baseType.length + 1);
        if (!sub.includes('.')) {
          for (const base of CHOICE_TYPE_BASES) {
            if (sub.startsWith(base) && sub !== base && sub !== `${base}[x]`) {
              const suffix = sub.slice(base.length);
              if (suffix.length > 0 && !VALID_CHOICE_TYPE_SUFFIXES.has(suffix)) {
                issues.push(createValidationIssue({
                  code: 'sd-snapshot-error-bad-choice', path: 'StructureDefinition',
                  resourceType: 'StructureDefinition',
                  customMessage:
                    `Error generating Snapshot: The path must be '${baseType}.${base}[x]' ` +
                    `not '${elem.path}' when the type list is not constrained ` +
                    `(this usually arises from a problem in the differential)`,
                  severityOverride: 'error',
                }));
              }
            }
          }
        }
      }
    }
    return issues;
  }

  /** Must-support consistency: sliced elements with mustSupport=true expect slices to match. */
  private validateSliceMustSupport(sd: any): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const diffElements = sd.differential?.element || [];

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

  /**
   * Apply Identifier ident-1 ("Identifier with no value has limited
   * utility") to any patternIdentifier / fixedIdentifier value declared
   * on a differential element. Java raises this warning whenever the
   * pattern carries only a system/use without value or extension —
   * see R5.cw-slice-adds-base baseline. Hard-coded here rather than via
   * a generic pattern-as-instance evaluator; expand this list as more
   * pattern-typed constraints come up in conformance baselines.
   */
  private validatePatternIdent1(sd: any): ValidationIssue[] {
    const elements = sd?.differential?.element || [];
    const issues: ValidationIssue[] = [];
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const ident = el?.patternIdentifier || el?.fixedIdentifier;
      if (!ident || typeof ident !== 'object') continue;
      const hasValue = typeof ident.value === 'string' && ident.value.length > 0;
      const hasExtension = Array.isArray(ident.extension) && ident.extension.length > 0;
      if (hasValue || hasExtension) continue;
      const fieldKey = el.patternIdentifier ? 'patternIdentifier' : 'fixedIdentifier';
      issues.push(createValidationIssue({
        code: 'sd-pattern-ident-1',
        path: `StructureDefinition.differential.element[${i}].${fieldKey}`,
        resourceType: 'StructureDefinition',
        customMessage:
          `Constraint failed: ident-1: 'Identifier with no value has limited utility.  ` +
          `If communicating that an identifier value has been suppressed or missing, ` +
          `the value element SHOULD be present with an extension indicating the missing ` +
          `semantic - e.g. data-absent-reason' (defined in http://hl7.org/fhir/StructureDefinition/Identifier)`,
        severityOverride: 'warning',
      }));
    }
    return issues;
  }

  /** Detect self-referencing baseDefinition (circular). */
  private validateBaseDefinition(sd: any): ValidationIssue[] {
    if (!sd.baseDefinition || sd.baseDefinition !== sd.url) return [];
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

// ============================================================================
// Helpers
// ============================================================================

function extractContactUrls(contacts: any[] | undefined): string[] {
  if (!Array.isArray(contacts)) return [];
  const urls: string[] = [];
  for (const contact of contacts) {
    for (const telecom of contact?.telecom || []) {
      if (telecom?.system === 'url' && telecom.value) urls.push(telecom.value);
    }
  }
  return urls;
}

export const structureDefinitionValidator = new StructureDefinitionValidator();
