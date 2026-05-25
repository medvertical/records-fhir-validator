import type { ValidationIssue } from '../types';
import { createReferenceValidationIssue } from './reference-utils';

interface ExtractedReference {
  path: string;
  reference: string;
}

export function buildReferencePathsByValue(
  extractedRefs: ExtractedReference[],
): Map<string, string[]> {
  const referencePathsByValue = new Map<string, string[]>();
  for (const { path, reference } of extractedRefs) {
    const paths = referencePathsByValue.get(reference) ?? [];
    paths.push(path);
    referencePathsByValue.set(reference, paths);
  }
  return referencePathsByValue;
}

export function getReferenceFieldName(path: string): string {
  const pathParts = path.split('.');
  return pathParts.length > 1
    ? pathParts[pathParts.length - 1].replace(/\[\d+\]$/, '')
    : path;
}

export function buildRecursiveReferenceIssues(
  recursiveResult: any,
  timeoutMs: number | undefined,
  resourceType: string,
  referencePathsByValue: Map<string, string[]>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const chain of recursiveResult.circularReferences) {
    issues.push(createReferenceValidationIssue({
      code: 'reference-circular',
      severity: 'warning',
      message: `Circular reference chain detected: ${chain.join(' → ')}`,
      humanReadable: `Circular reference detected in chain: ${chain.join(' → ')}`,
      path: '',
      details: { chain, resourceType },
      resourceType,
    }));
  }

  for (const ref of recursiveResult.unresolvedReferences) {
    const referencePath = referencePathsByValue.get(ref)?.[0] ?? '';
    issues.push(createReferenceValidationIssue({
      code: 'reference-unresolved',
      severity: 'info',
      message: `Referenced resource could not be resolved: ${ref}`,
      humanReadable: `Could not resolve reference: ${ref}`,
      path: referencePath || resourceType,
      details: { reference: ref, referencePath, resourceType },
      resourceType,
    }));
  }

  if (recursiveResult.timedOut) {
    issues.push(createReferenceValidationIssue({
      code: 'reference-recursive-timeout',
      severity: 'warning',
      message: `Recursive reference validation timed out after ${recursiveResult.validationTimeMs}ms`,
      humanReadable: `Recursive validation timed out (limit: ${timeoutMs}ms)`,
      path: '',
      details: { timeoutMs, resourceType },
      resourceType,
    }));
  }

  return issues;
}
