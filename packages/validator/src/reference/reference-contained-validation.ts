import type { ValidationIssue } from '../types';
import { extractReferences } from './reference-format-validator';
import { createReferenceValidationIssue } from './reference-utils';

export function validateContainedReferenceIssues(
  resource: any,
  resourceType: string = resource?.resourceType || 'Unknown'
): ValidationIssue[] {
  if (!resource) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const containedIds = new Set(
    (Array.isArray(resource.contained) ? resource.contained : [])
      .filter((contained: any) => contained.id)
      .map((contained: any) => contained.id)
  );

  const containedRefs = extractReferences(resource, resourceType).filter(
    ref =>
      ref.reference.startsWith('#')
      && !/(?:^|\.)contained\[/.test(ref.path)
      && !/(?:^|\.)entry\[\d+\]\.resource\./.test(ref.path)
      && !/(?:^|\.)parameter\[\d+\]\.resource\./.test(ref.path),
  );

  for (const { path, reference } of containedRefs) {
    const containedId = reference.substring(1);
    if (containedId === '') continue;
    if (containedIds.has(containedId)) continue;

    issues.push(createReferenceValidationIssue({
      code: 'reference-contained-unresolved',
      severity: 'error',
      message: `Unable to resolve resource with reference '${reference}'`,
      humanReadable: `The referenced contained resource '${containedId}' does not exist in the resource`,
      path,
      details: { reference, containedId, availableIds: Array.from(containedIds) },
      resourceType
    }));
    issues.push(createReferenceValidationIssue({
      code: 'reference-ref1-invariant',
      severity: 'error',
      message: `Constraint failed: ref-1: 'SHALL have a contained resource if a local reference is provided' (url: ${containedId})`,
      humanReadable: `ref-1: contained resource '${containedId}' not found`,
      path,
      details: { reference, containedId, constraint: 'ref-1' },
      resourceType
    }));
  }

  return issues;
}
