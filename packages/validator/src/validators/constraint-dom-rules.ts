import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import type { Constraint } from '../core/structure-definition-types.js';
import { resourceTypeOf } from '../core/fhir-resource.js';

export function validateDom3Constraint(
  resource: unknown,
  elementPath: string,
  constraint: Constraint,
  profileUrl: string,
): ValidationIssue[] {
  const resourceRecord = asRecord(resource);
  if (!resourceRecord || !Array.isArray(resourceRecord.contained) || resourceRecord.contained.length === 0) {
    return [];
  }

  const referencedIds = new Set<string>();
  collectContainedReferenceIds(resource, referencedIds);
  for (const containedValue of resourceRecord.contained) {
    const contained = asRecord(containedValue);
    const id = typeof contained?.id === 'string' ? contained.id : '';
    if (id && hasBareReferenceToContainer(contained)) referencedIds.add(id);
  }

  const issues: ValidationIssue[] = [];
  for (const containedValue of resourceRecord.contained) {
    const contained = asRecord(containedValue);
    const id = typeof contained?.id === 'string' ? contained.id : '';
    if (!id || referencedIds.has(id)) continue;

    issues.push(createValidationIssue({
      code: 'profile-constraint-violation',
      path: elementPath,
      resourceType: resourceTypeOf(resource),
      profile: profileUrl,
      customMessage: `Constraint '${constraint.key}' failed: ${constraint.human}`,
      ruleId: constraint.key,
      details: {
        expression: constraint.expression,
        constraintKey: constraint.key,
        containedId: id,
        originalSeverity: constraint.severity,
      },
      severityOverride: constraint.severity === 'warning' ? 'warning' : undefined,
    }));
  }

  return issues;
}

function hasBareReferenceToContainer(value: unknown): boolean {
  return hasBareReferenceToContainerInternal(value, new WeakSet<object>());
}

function hasBareReferenceToContainerInternal(
  value: unknown,
  visited: WeakSet<object>,
): boolean {
  if (!value || typeof value !== 'object' || visited.has(value)) return false;
  visited.add(value);
  if (Array.isArray(value)) {
    return value.some(child => hasBareReferenceToContainerInternal(child, visited));
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'reference' && child === '#') return true;
    if (hasBareReferenceToContainerInternal(child, visited)) return true;
  }
  return false;
}

function collectContainedReferenceIds(value: unknown, referencedIds: Set<string>): void {
  collectContainedReferenceIdsInternal(value, referencedIds, new WeakSet<object>());
}

function collectContainedReferenceIdsInternal(
  value: unknown,
  referencedIds: Set<string>,
  visited: WeakSet<object>,
): void {
  if (typeof value === 'string') {
    if (value.startsWith('#') && value.length > 1) {
      referencedIds.add(value.slice(1));
    }
    return;
  }

  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectContainedReferenceIdsInternal(item, referencedIds, visited);
    }
    return;
  }

  for (const child of Object.values(value)) {
    collectContainedReferenceIdsInternal(child, referencedIds, visited);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
