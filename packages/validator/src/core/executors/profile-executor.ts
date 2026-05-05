/**
 * Profile Executor
 * 
 * Validates FHIR profile conformance:
 * - StructureDefinition conformance
 * - Extension validation
 * - Slicing validation
 * - Profile constraint validation
 */

import type { ValidationIssue } from '../../types';
import type { StructureDefinition } from '../structure-definition-types';
import { ExtensionValidator } from '../../validators/extension-validator';
import { SlicingValidator } from '../../validators/slicing-validator';
import { ConstraintValidator } from '../../validators/constraint-validator';
import { GermanIdentifierValidator } from '../../validators/german-identifier-validator';
import { GermanExtensionValidator } from '../../validators/german-extension-validator';
import { logger } from '../../logger';

// ============================================================================
// Types
// ============================================================================

export interface ProfileValidationContext {
  resource: any;
  resourceType: string;
  profileUrl: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  structureDef: StructureDefinition;
  strictMode: boolean;
  getValueAtPath: (resource: any, path: string) => any;
}

// ============================================================================
// Profile Executor
// ============================================================================

export class ProfileExecutor {
  private extensionValidator: ExtensionValidator;
  private slicingValidator: SlicingValidator;
  private constraintValidator: ConstraintValidator;
  private germanIdentifierValidator: GermanIdentifierValidator;
  private germanExtensionValidator: GermanExtensionValidator;

  constructor(
    extensionValidator: ExtensionValidator,
    slicingValidator: SlicingValidator,
    constraintValidator: ConstraintValidator
  ) {
    this.extensionValidator = extensionValidator;
    this.slicingValidator = slicingValidator;
    this.constraintValidator = constraintValidator;
    this.germanIdentifierValidator = new GermanIdentifierValidator();
    this.germanExtensionValidator = new GermanExtensionValidator();
  }

  /**
   * Validate profile conformance aspects
   */
  async validate(
    context: ProfileValidationContext
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      const { resource, structureDef, profileUrl, fhirVersion, strictMode, getValueAtPath } = context;

      // 1. Validate extensions
      const extensionIssues = await this.extensionValidator.validateExtensions(
        resource,
        structureDef,
        {
          resource,
          profileSD: structureDef,
          strictMode,
          fhirVersion,
          profileUrl,
          getValueAtPath
        }
      );
      issues.push(...extensionIssues);

      // 2. Validate slicing (check for sliced elements like Patient.identifier)
      if (structureDef.snapshot?.element) {
        issues.push(...await this.validateAllSlicing(
          resource, structureDef, getValueAtPath
        ));

        // 3. Validate FHIRPath constraints
        // Using snapshot elements which contain the constraints
        const constraintIssues = await this.constraintValidator.validate(
          resource,
          structureDef.snapshot.element,
          profileUrl,
          { strictMode, fhirVersion } // Pass strictMode for severity escalation + FHIR version for FHIRPath model
        );
        issues.push(...constraintIssues);
      }

      // 4. Validate German identifier systems (GKV/PKV assigner validation)
      if (this.germanIdentifierValidator.isGermanProfile(profileUrl)) {
        const germanIdIssues = this.germanIdentifierValidator.validateIdentifiers(
          resource,
          profileUrl
        );
        issues.push(...germanIdIssues);

        // 5. Validate German extension requirements (gender extension for "other")
        const germanExtIssues = this.germanExtensionValidator.validateExtensions(
          resource,
          profileUrl
        );
        issues.push(...germanExtIssues);
      }

      return issues;

    } catch (error) {
      logger.error('[ProfileExecutor] Validation error:', error);
      return [{
        id: `profile-executor-error-${Date.now()}`,
        aspect: 'profile',
        severity: 'error',
        code: 'validation-error',
        message: `Profile validation failed: ${error instanceof Error ? error.message : String(error)}`,
        path: '',
        timestamp: new Date()
      }];
    }
  }

  /**
   * Walk every sliced element in the snapshot and delegate to the slicing
   * validator — handling both globally-sliced paths and slices nested under
   * array ancestors (cardinality checked per parent item).
   */
  private async validateAllSlicing(
    resource: any,
    structureDef: StructureDefinition,
    getValueAtPath: (resource: any, path: string) => any,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    for (const elementDef of structureDef.snapshot!.element!) {
      if (!elementDef.slicing) continue;
      if (this.isSlicingNestedUnderSlice(elementDef)) continue;
      const path = elementDef.path;
      const parentItems = this.resolveParentArrayItems(resource, path, structureDef, getValueAtPath);

      if (parentItems) {
        for (const parentItem of parentItems) {
          const leafKey = path.split('.').pop()!;
          let childVal = parentItem[leafKey];
          if (childVal === undefined && leafKey.endsWith('[x]')) {
            const prefix = leafKey.slice(0, -3);
            const actualKey = Object.keys(parentItem).find(k => k.startsWith(prefix));
            if (actualKey) childVal = parentItem[actualKey];
          }
          issues.push(...await this.slicingValidator.validateSlicing(
            this.coerceToArray(childVal), path, structureDef
          ));
        }
      } else {
        if (!this.slicedElementParentExists(resource, path, getValueAtPath)) {
          continue;
        }
        const slicedValue = this.coerceToArray(getValueAtPath(resource, path));
        if (slicedValue.length === 0 && this.elementMin(elementDef) > 0) {
          continue;
        }
        // Pass an empty array when the element is absent so required
        // slices still produce profile-slice-min-cardinality + ghost children.
        issues.push(...await this.slicingValidator.validateSlicing(
          slicedValue, path, structureDef
        ));
      }
    }
    return issues;
  }

  private isSlicingNestedUnderSlice(elementDef: { id?: string; path?: string }): boolean {
    const id = elementDef.id;
    if (!id || !elementDef.path) return false;
    const segments = id.split('.');
    const pathDepth = elementDef.path.split('.').length;
    return segments.length >= pathDepth && segments.slice(0, -1).some(segment => segment.includes(':'));
  }

  private elementMin(elementDef: { min?: number | string }): number {
    const min = typeof elementDef.min === 'string'
      ? Number.parseInt(elementDef.min, 10)
      : elementDef.min;
    return Number.isFinite(min) ? min as number : 0;
  }

  private slicedElementParentExists(
    resource: any,
    slicedPath: string,
    getValueAtPath: (resource: any, path: string) => any,
  ): boolean {
    const parts = slicedPath.split('.');
    if (parts.length <= 2) return true;

    const parentPath = parts.slice(0, -1).join('.');
    if (parentPath === resource.resourceType) return true;

    try {
      const parentValue = getValueAtPath(resource, parentPath);
      if (Array.isArray(parentValue)) return parentValue.length > 0;
      return parentValue !== null && parentValue !== undefined;
    } catch {
      return false;
    }
  }

  private coerceToArray(val: any): any[] {
    if (val === undefined || val === null) return [];
    return Array.isArray(val) ? val : [val];
  }

  /**
   * When a sliced element is nested inside an array parent
   * (e.g. Medication.ingredient.item[x]), return the individual parent items
   * so slicing cardinality can be checked per item.
   * Returns null if no array ancestor exists.
   */
  private resolveParentArrayItems(
    resource: any,
    slicedPath: string,
    structureDef: StructureDefinition,
    getValueAtPath: (resource: any, path: string) => any,
  ): any[] | null {
    const parts = slicedPath.split('.');
    if (parts.length < 3) return null; // Need at least ResourceType.parent.child

    // Walk from the immediate parent upward to find the nearest array ancestor
    for (let i = parts.length - 2; i >= 1; i--) {
      const ancestorPath = parts.slice(0, i + 1).join('.');
      // Check if this ancestor is max=* in the StructureDefinition
      const ancestorDef = structureDef.snapshot?.element?.find(
        (e: any) => e.path === ancestorPath && !e.sliceName,
      );
      if (ancestorDef && this.isRepeatingMax(ancestorDef.max)) {
        const parentVal = getValueAtPath(resource, ancestorPath);
        if (Array.isArray(parentVal) && parentVal.length > 1) {
          // If the sliced element is more than one level below the array ancestor,
          // resolve the intermediate path within each parent item
          const remainingParts = parts.slice(i + 1, parts.length - 1);
          if (remainingParts.length === 0) return parentVal;
          const resolved: any[] = [];
          for (const item of parentVal) {
            let current: any = item;
            for (const seg of remainingParts) {
              if (current == null) break;
              current = current[seg];
            }
            if (current != null) resolved.push(current);
          }
          return resolved.length > 0 ? resolved : null;
        }
      }
    }
    return null;
  }

  private isRepeatingMax(max: string | undefined): boolean {
    if (max === '*') return true;
    if (!max) return false;
    const parsed = Number.parseInt(max, 10);
    return Number.isFinite(parsed) && parsed > 1;
  }
}
