import type { ValidationIssue } from '../../types';
import { createValidationIssue } from '../../issues';

export function validateResourceId(resource: any, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const idRegex = /^[A-Za-z0-9\-.]{1,64}$/;

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

  if (Array.isArray(resource.contained)) {
    for (let i = 0; i < resource.contained.length; i++) {
      const contained = resource.contained[i];
      if (contained?.id === undefined || contained?.id === null) continue;
      const id = String(contained.id);
      if (!idRegex.test(id)) {
        const reason = id.length > 64
          ? `Too long (${id.length} chars)`
          : `Invalid Characters ('${id}')`;
        const cType = contained.resourceType || 'Resource';
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

export function validateContainedResourceIdsPresent(resource: any, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(resource.contained)) return issues;

  for (let i = 0; i < resource.contained.length; i++) {
    const contained = resource.contained[i];
    if (contained?.id !== undefined && contained?.id !== null && contained.id !== '') continue;

    issues.push(createValidationIssue({
      code: 'invalid',
      path: `${resourceType}.contained[${i}]/*${contained?.resourceType || 'Resource'}/null*/`,
      resourceType,
      customMessage: 'Resource requires an id, but none is present',
      severityOverride: 'error',
    }));
  }

  return issues;
}

export function validateUniqueContainedResourceIds(resource: any, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(resource.contained)) return issues;

  const firstIndexById = new Map<string, number>();
  for (let i = 0; i < resource.contained.length; i++) {
    const contained = resource.contained[i];
    if (contained?.id === undefined || contained?.id === null) continue;

    const id = String(contained.id);
    const firstIndex = firstIndexById.get(id);
    if (firstIndex !== undefined) {
      issues.push(createValidationIssue({
        code: 'duplicate',
        path: `${resourceType}.contained[${i}]/*${contained.resourceType || 'Resource'}/${id}*/`,
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

export function validateUniqueElementIds(resource: any, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!resource || typeof resource !== 'object') return issues;
  if (resourceType === 'StructureDefinition') return issues;

  const seen = new Map<string, string>();

  const walk = (node: any, path: string, isResourceRoot: boolean): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i], `${path}[${i}]`, false);
      }
      return;
    }

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

export function validateContainedResourcesReferenced(resource: any, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(resource.contained) || resource.contained.length === 0) return issues;

  const containedIds = new Map<string, number>();
  for (let i = 0; i < resource.contained.length; i++) {
    const contained = resource.contained[i];
    containedIds.set(contained?.id ? String(contained.id) : 'null', i);
  }
  if (containedIds.size === 0) return issues;

  const referencedIds = new Set<string>();
  const collectRefs = (obj: any, skipContained: boolean): void => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === 'string' && item.startsWith('#') && item.length > 1) {
          referencedIds.add(item.substring(1));
        } else {
          collectRefs(item, false);
        }
      }
      return;
    }
    for (const key of Object.keys(obj)) {
      if (skipContained && key === 'contained') continue;
      const val = obj[key];
      if (typeof val === 'string' && val.startsWith('#') && val.length > 1) {
        referencedIds.add(val.substring(1));
      } else {
        collectRefs(val, false);
      }
    }
  };
  collectRefs(resource, false);

  for (const [id, idx] of containedIds) {
    if (!referencedIds.has(id)) {
      issues.push(createValidationIssue({
        code: 'invalid',
        path: `${resourceType}.contained[${idx}]`,
        resourceType,
        customMessage: `The contained resource '${id}' is not referenced to from elsewhere in the containing resource nor does it refer to the containing resource`,
        severityOverride: 'error',
      }));
    }
  }

  return issues;
}

export function validateNoEmptyArrays(resource: any, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  findEmptyArrays(resource, resourceType, issues);
  return issues;
}

export function validateWhitespaceOnlyPrimitives(resource: any, resourceType: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const wsOnly = /^\s+$/;

  const walk = (obj: any, path: string) => {
    if (obj == null || typeof obj !== 'object') return;
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'resourceType' || key === 'div' || key.startsWith('_')) continue;
      const childPath = path ? `${path}.${key}` : key;
      if (typeof val === 'string' && val.length > 0 && wsOnly.test(val)) {
        issues.push(createValidationIssue({
          code: 'invalid',
          path: childPath,
          resourceType,
          customMessage: 'Primitive types should not only be whitespace',
          severityOverride: 'warning',
        }));
      } else if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          const item = val[i];
          if (typeof item === 'string' && item.length > 0 && wsOnly.test(item)) {
            issues.push(createValidationIssue({
              code: 'invalid',
              path: `${childPath}[${i}]`,
              resourceType,
              customMessage: 'Primitive types should not only be whitespace',
              severityOverride: 'warning',
            }));
          } else if (item && typeof item === 'object') {
            walk(item, `${childPath}[${i}]`);
          }
        }
      } else if (typeof val === 'object') {
        walk(val, childPath);
      }
    }
  };

  walk(resource, resourceType);
  return issues;
}

export function validateOrphanPrimitiveSidecars(resource: any, resourceType: string): ValidationIssue[] {
  if (!resource || typeof resource !== 'object') return [];
  const issues: ValidationIssue[] = [];
  const dataAbsent = 'http://hl7.org/fhir/StructureDefinition/data-absent-reason';

  for (const key of Object.keys(resource)) {
    if (!key.startsWith('_') || key.length < 2) continue;
    const primitiveKey = key.slice(1);
    if (primitiveKey in resource) continue;

    const sidecar = resource[key];
    const extensions = Array.isArray(sidecar?.extension) ? sidecar.extension : [];
    const hasDataAbsent = extensions.some(
      (ext: any) => typeof ext?.url === 'string' && ext.url === dataAbsent,
    );
    if (hasDataAbsent) continue;

    issues.push(createValidationIssue({
      code: 'structural-orphan-primitive-extension',
      path: `${resourceType}.${primitiveKey}`,
      resourceType,
      customMessage:
        `The property '${primitiveKey}' is invalid: primitive-extension sidecar '${key}' is present without a matching '${primitiveKey}' value. ` +
        `Sidecar-only form is valid only when it carries a data-absent-reason extension.`,
      severityOverride: 'error',
      details: { orphanKey: key, expectedKey: primitiveKey },
    }));
  }

  return issues;
}

function findEmptyArrays(obj: any, path: string, issues: ValidationIssue[]): void {
  if (!obj || typeof obj !== 'object') return;

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const currentPath = `${path}.${key}`;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        issues.push(createValidationIssue({
          code: 'structural-empty-array',
          path: currentPath,
          resourceType: path.split('.')[0],
          customMessage: `Array cannot be empty - omit the property instead`,
          severityOverride: 'error',
        }));
      } else {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            if (Object.keys(item).length === 0) {
              issues.push(createValidationIssue({
                code: 'structural-empty-object',
                path: `${currentPath}[${i}]`,
                resourceType: path.split('.')[0],
                customMessage: 'Element must have some content',
                severityOverride: 'error',
              }));
            } else {
              findEmptyArrays(item, `${currentPath}[${i}]`, issues);
            }
          }
        }
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      findEmptyArrays(value, currentPath, issues);
    }
  }
}
