import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { Constraint } from '../core/structure-definition-types';

export function validateDom3Constraint(
  resource: any,
  elementPath: string,
  constraint: Constraint,
  profileUrl: string,
): ValidationIssue[] {
  if (!Array.isArray(resource.contained) || resource.contained.length === 0) {
    return [];
  }

  const referencedIds = new Set<string>();
  collectContainedReferenceIds(resource, referencedIds);

  const issues: ValidationIssue[] = [];
  for (const contained of resource.contained) {
    const id = contained?.id === undefined || contained?.id === null ? '' : String(contained.id);
    if (!id || referencedIds.has(id)) continue;

    issues.push(createValidationIssue({
      code: 'profile-constraint-violation',
      path: elementPath,
      resourceType: resource.resourceType,
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

function collectContainedReferenceIds(value: unknown, referencedIds: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith('#') && value.length > 1) {
      referencedIds.add(value.slice(1));
    }
    return;
  }

  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectContainedReferenceIds(item, referencedIds);
    }
    return;
  }

  for (const child of Object.values(value)) {
    collectContainedReferenceIds(child, referencedIds);
  }
}
