import type { ValidationIssue } from '@records-fhir/validation-types';
import type {
  ReferenceResolver,
  SlicingValidator,
} from '../../validators/slicing-validator.js';
import { getValidationTargets } from '../../business-rules/index.js';
import { resolveFhirSegmentValue } from '../fhir-primitive-sidecar.js';
import type { StructureDefinition } from '../structure-definition-types.js';
import { prepareNestedSliceBindings } from './profile-nested-slice-bindings.js';
import { resolveValueOccurrences } from '../../validators/slicing-content-paths.js';
import type { ProfileConformanceCheck } from '../../validators/sd-fhirpath-profile-conformance.js';
import {
  resolveNestedSliceParentItems,
  scopeParentItemsToNestedSlice,
} from './profile-nested-slice-scoping.js';

interface ProfileSlicingValidationInput {
  extensionIssues: ValidationIssue[];
  resource: unknown;
  structureDef: StructureDefinition;
  getValueAtPath: (resource: unknown, path: string) => unknown;
  referenceResolver?: ReferenceResolver | null;
  fhirVersion: 'R4' | 'R5' | 'R6';
  profileConformance?: ProfileConformanceCheck;
  elementPaths?: ReadonlySet<string>;
}

/** Owns profile slice traversal and its overlap policy with extension validation. */
export class ProfileSlicingValidation {
  constructor(private readonly slicingValidator: SlicingValidator) {}

  setMustSupportSeverity(severity: 'warning' | 'information'): void {
    this.slicingValidator.setMustSupportSeverity(severity);
  }

  async validate(input: ProfileSlicingValidationInput): Promise<ValidationIssue[]> {
    const slicingIssues = await this.validateAllSlicing(
      input.resource,
      input.structureDef,
      input.getValueAtPath,
      input.referenceResolver,
      input.fhirVersion,
      input.profileConformance,
      input.elementPaths,
    );
    return this.suppressDuplicateExtensionSliceMinimum(
      input.extensionIssues,
      slicingIssues,
    );
  }

  private async validateAllSlicing(
    resource: unknown,
    structureDef: StructureDefinition,
    getValueAtPath: (resource: unknown, path: string) => unknown,
    referenceResolver?: ReferenceResolver | null,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
    profileConformance?: ProfileConformanceCheck,
    elementPaths?: ReadonlySet<string>,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const conformance = profileConformance ? [profileConformance] as const : [] as const;
    await prepareNestedSliceBindings(structureDef, valueSet => this.slicingValidator.loadValueSetCodes(valueSet));
    for (const elementDef of structureDef.snapshot!.element!) {
      if (!elementDef.slicing || elementPaths && !elementPaths.has(elementDef.path)) continue;
      const path = elementDef.path;
      const nestedSliceParentItems = resolveNestedSliceParentItems(
        resource,
        elementDef,
        structureDef,
        getValueAtPath,
      );
      const parentItems = nestedSliceParentItems
        ?? this.resolveParentArrayItems(resource, path, structureDef, getValueAtPath);

      if (parentItems) {
        const scopedParents = nestedSliceParentItems
          ?? scopeParentItemsToNestedSlice(parentItems, elementDef, structureDef)
          ?? parentItems;
        const leafKey = path.split('.').pop()!;
        const parentPaths = instancePathsOf(resource, path.slice(0, path.lastIndexOf('.')));
        for (const parentItem of scopedParents) {
          const childVal = resolveFhirSegmentValue(parentItem, leafKey);
          const parentPath = parentPaths.get(parentItem);
          issues.push(...await this.slicingValidator.validateSlicing(
            this.coerceToArray(childVal),
            path,
            structureDef,
            referenceResolver,
            elementDef.id,
            fhirVersion,
            resource,
            parentPath ? `${parentPath}.${leafKey}` : path,
            ...conformance,
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
        // A single parent (one `item`) still has a place in the instance.
        const parents = [...instancePathsOf(resource, path.slice(0, path.lastIndexOf('.'))).values()];
        const instancePath = parents.length === 1 ? `${parents[0]}.${path.split('.').pop()!}` : path;
        // Pass an empty array when the element is absent so required
        // slices still produce profile-slice-min-cardinality + ghost children.
        const slicingArgs = [slicedValue, path, structureDef, referenceResolver, elementDef.id, fhirVersion, resource] as const;
        issues.push(...await (instancePath === path && !profileConformance
          ? this.slicingValidator.validateSlicing(...slicingArgs)
          : this.slicingValidator.validateSlicing(...slicingArgs, instancePath, ...conformance)));
      }
    }
    return issues;
  }

  private elementMin(elementDef: { min?: number | string }): number {
    const min = typeof elementDef.min === 'string'
      ? Number.parseInt(elementDef.min, 10)
      : elementDef.min;
    return Number.isFinite(min) ? min as number : 0;
  }

  private slicedElementParentExists(
    resource: unknown,
    slicedPath: string,
    getValueAtPath: (resource: unknown, path: string) => unknown,
  ): boolean {
    const parts = slicedPath.split('.');
    if (parts.length <= 2) return true;

    const parentPath = parts.slice(0, -1).join('.');
    if (isObjectRecord(resource) && parentPath === resource.resourceType) return true;

    try {
      const parentValue = getValueAtPath(resource, parentPath);
      if (Array.isArray(parentValue)) return parentValue.length > 0;
      return parentValue !== null && parentValue !== undefined;
    } catch {
      return false;
    }
  }

  private coerceToArray(val: unknown): unknown[] {
    if (val === undefined || val === null) return [];
    return Array.isArray(val) ? val : [val];
  }

  private suppressDuplicateExtensionSliceMinimum(
    extensionIssues: ValidationIssue[],
    slicingIssues: ValidationIssue[],
  ): ValidationIssue[] {
    const extensionMinPaths = new Set(
      extensionIssues
        .filter(issue => issue.code === 'profile-extension-min-cardinality')
        .map(issue => this.normalizePath(issue.path))
        .filter(path => this.isExtensionPath(path)),
    );

    if (extensionMinPaths.size === 0) {
      return [...extensionIssues, ...slicingIssues];
    }

    return [
      ...extensionIssues,
      ...slicingIssues.filter(issue => {
        if (issue.code !== 'profile-slice-min-cardinality') return true;
        const path = this.normalizePath(issue.path);
        return !this.isExtensionPath(path) || !extensionMinPaths.has(path);
      }),
    ];
  }

  private normalizePath(path: string | undefined): string {
    return (path || '')
      .replace(/\[\d+\]/g, '')
      .replace(/:[^.]+/g, '')
      .toLowerCase();
  }

  private isExtensionPath(path: string): boolean {
    return path.endsWith('.extension') || path.endsWith('.modifierextension');
  }

  /** Resolve the nearest repeating parent for a nested sliced element. */
  private resolveParentArrayItems(
    resource: unknown,
    slicedPath: string,
    structureDef: StructureDefinition,
    getValueAtPath: (resource: unknown, path: string) => unknown,
  ): unknown[] | null {
    const parts = slicedPath.split('.');
    if (parts.length < 3) return null;

    for (let i = parts.length - 2; i >= 1; i--) {
      const ancestorPath = parts.slice(0, i + 1).join('.');
      const ancestorDef = structureDef.snapshot?.element?.find(
        element => element.path === ancestorPath && !element.sliceName,
      );
      if (ancestorDef && this.isRepeatingMax(ancestorDef.max)) {
        const parentVal = getValueAtPath(resource, ancestorPath);
        if (Array.isArray(parentVal) && parentVal.length > 1) {
          const remainingParts = parts.slice(i + 1, parts.length - 1);
          if (remainingParts.length === 0) return parentVal;
          // A primitive parent (a coding's display) holds its sliced
          // extensions in its `_display` sidecar.
          const resolved = parentVal.flatMap(item =>
            resolveValueOccurrences(item, remainingParts.join('.'), true).map(occurrence => occurrence.value));
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Where each object at `path` sits in the resource, found by identity. */
function instancePathsOf(resource: unknown, path: string): Map<unknown, string> {
  const paths = new Map<unknown, string>();
  for (const target of getValidationTargets(resource, path)) {
    if (target.value !== null && typeof target.value === 'object') paths.set(target.value, target.fullPath);
  }
  return paths;
}
