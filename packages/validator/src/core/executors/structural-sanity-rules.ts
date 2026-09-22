import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../../issues/index.js';
import { hasBareReferenceToContainer } from './structural-reference-traversal.js';

type ObjectRecord = Record<string, unknown>;

export function validateResourceId(resource: unknown, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const idRegex = /^[A-Za-z0-9\-.]{1,64}$/;
  if (!isObjectRecord(resource)) return issues;

  if (resource.id !== undefined && resource.id !== null) {
    const id = String(resource.id);
    if (!idRegex.test(id)) {
      const reason = id.length > 64
        ? `Too long (${id.length} chars)`
        : `Invalid Characters ('${id}')`;
      issues.push(createValidationIssue({
        code: 'structural-invalid-id',
        path: `${resourceType}.id`,
        resourceType,
        customMessage: `Invalid Resource id: ${reason}`,
        severityOverride: 'error',
      }));
    }
  }

  const idSidecar = isObjectRecord(resource._id) ? resource._id : null;
  if (Array.isArray(idSidecar?.extension) && idSidecar.extension.length > 0) {
    issues.push(createValidationIssue({
      code: 'structural-resource-id-extension',
      path: `${resourceType}.id`,
      resourceType,
      customMessage: 'Extensions are not allowed on Resource.id',
      severityOverride: 'error',
    }));
  }

  if (Array.isArray(resource.contained)) {
    for (let i = 0; i < resource.contained.length; i++) {
      const contained = resource.contained[i];
      if (!isObjectRecord(contained) || contained.id === undefined || contained.id === null) continue;
      const id = String(contained.id);
      if (!idRegex.test(id)) {
        const reason = id.length > 64
          ? `Too long (${id.length} chars)`
          : `Invalid Characters ('${id}')`;
        const cType = getResourceType(contained);
        issues.push(createValidationIssue({
          code: 'structural-invalid-id',
          path: `${resourceType}.contained[${i}]/*${cType}/${id}*/.id`,
          resourceType,
          customMessage: `Invalid Resource id: ${reason}`,
          severityOverride: 'error',
        }));
      }
    }
  }

  return issues;
}

export function validateContainedResourceIdsPresent(resource: unknown, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isObjectRecord(resource)) return issues;
  if (!Array.isArray(resource.contained)) return issues;

  for (let i = 0; i < resource.contained.length; i++) {
    const contained = resource.contained[i];
    if (isObjectRecord(contained) && contained.id !== undefined && contained.id !== null && contained.id !== '') continue;

    issues.push(createValidationIssue({
      code: 'structural-contained-id-missing',
      path: `${resourceType}.contained[${i}]/*${getResourceType(contained)}/null*/`,
      resourceType,
      customMessage: 'Resource requires an id, but none is present',
      severityOverride: 'error',
    }));
  }

  return issues;
}

export function validateUniqueContainedResourceIds(resource: unknown, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isObjectRecord(resource)) return issues;
  if (!Array.isArray(resource.contained)) return issues;

  const firstIndexById = new Map<string, number>();
  for (let i = 0; i < resource.contained.length; i++) {
    const contained = resource.contained[i];
    if (!isObjectRecord(contained) || contained.id === undefined || contained.id === null) continue;

    const id = String(contained.id);
    const firstIndex = firstIndexById.get(id);
    if (firstIndex !== undefined) {
      issues.push(createValidationIssue({
        code: 'duplicate',
        path: `${resourceType}.contained[${i}]/*${getResourceType(contained)}/${id}*/`,
        resourceType,
        customMessage: `Duplicate ID for contained resource: ${id}`,
        severityOverride: 'error',
      }));
      continue;
    }

    firstIndexById.set(id, i);
  }

  return issues;
}

export function validateUniqueElementIds(resource: unknown, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isObjectRecord(resource)) return issues;
  if (resourceType === 'StructureDefinition') return issues;

  const seen = new Map<string, string>();
  const visited = new WeakSet<object>();

  const walk = (node: unknown, path: string, isResourceRoot: boolean): void => {
    if (typeof node !== 'object' || node === null || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i], `${path}[${i}]`, false);
      }
      return;
    }

    if (!isObjectRecord(node)) return;
    if (typeof node.resourceType === 'string' && !isResourceRoot) return;

    for (const key of Object.keys(node)) {
      if (key === 'contained') continue;
      if (key === 'id' && typeof node.id === 'string' && !isResourceRoot) {
        const value = node.id;
        if (seen.has(value)) {
          issues.push(createValidationIssue({
            code: 'structural-duplicate-element-id',
            path,
            resourceType,
            customMessage: `Duplicate id value '${value}'`,
            severityOverride: 'error',
          }));
        } else {
          seen.set(value, path);
        }
        continue;
      }
      walk(node[key], path ? `${path}.${key}` : key, false);
    }
  };

  walk(resource, resourceType, true);
  return issues;
}

export function validateContainedResourcesReferenced(resource: unknown, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isObjectRecord(resource)) return issues;
  if (!Array.isArray(resource.contained) || resource.contained.length === 0) return issues;

  const containedIds = new Map<string, number>();
  for (let i = 0; i < resource.contained.length; i++) {
    const contained = resource.contained[i];
    containedIds.set(isObjectRecord(contained) && contained.id ? String(contained.id) : 'null', i);
  }
  if (containedIds.size === 0) return issues;

  const referencedIds = new Set<string>();
  for (const [id, idx] of containedIds) {
    if (hasBareReferenceToContainer(resource.contained[idx])) {
      referencedIds.add(id);
    }
  }
  const visited = new WeakSet<object>();
  const collectRefs = (obj: unknown): void => {
    if (typeof obj !== 'object' || obj === null || visited.has(obj)) return;
    visited.add(obj);
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === 'string' && item.startsWith('#') && item.length > 1) {
          referencedIds.add(item.substring(1));
        } else {
          collectRefs(item);
        }
      }
      return;
    }
    if (!isObjectRecord(obj)) return;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string' && val.startsWith('#') && val.length > 1) {
        referencedIds.add(val.substring(1));
      } else {
        collectRefs(val);
      }
    }
  };
  collectRefs(resource);

  for (const [id, idx] of containedIds) {
    if (!referencedIds.has(id)) {
      issues.push(createValidationIssue({
        code: 'structural-contained-not-referenced',
        path: `${resourceType}.contained[${idx}]`,
        resourceType,
        customMessage: `The contained resource '${id}' is not referenced to from elsewhere in the containing resource nor does it refer to the containing resource`,
        severityOverride: 'error',
        // constraintKey routes the OperationOutcome converter to Java's
        // `invalid` category for dom-3; containedId keys the dedupe pass.
        details: { constraintKey: 'dom-3', containedId: id },
      }));
    }
  }

  return issues;
}

export {
  validateIllegalXmlCharacterPrimitives,
  validateNoEmptyArrays,
  validateOrphanPrimitiveSidecars,
  validatePrimitiveSidecarArrayAlignment,
  validateWhitespaceOnlyPrimitives,
} from './structural-primitive-sanity-rules.js';

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getResourceType(value: unknown): string {
  return isObjectRecord(value) && typeof value.resourceType === 'string'
    ? value.resourceType
    : 'Resource';
}
