import type { ValidationIssue } from '../../types';
import { createValidationIssue } from '../../issues';
import { ucumCodeHasAnnotation, validateUcumCode } from '../../validators/ucum-validator';
import {
  buildInvalidUcumIssueDetails,
  buildInvalidUcumMessage,
} from './terminology-ucum-rules';

function isCodingHygienePath(path: string): boolean {
  return (
    /\.coding\[\d+\]$/.test(path) ||
    /\.(?:value|answer|pattern|fixed)Coding$/.test(path)
  );
}

export function validateCodingHygiene(resource: any, existingIssues: ValidationIssue[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set(existingIssues.map(issue => `${issue.code}|${issue.path}`));
  const root = resource?.resourceType || 'Resource';

  const pushOnce = (issue: {
    severity: 'error' | 'warning' | 'information';
    code: string;
    message: string;
    path: string;
    details?: Record<string, unknown>;
  }): void => {
    const key = `${issue.code}|${issue.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(createValidationIssue({
      code: issue.code,
      path: issue.path,
      resourceType: root,
      aspectOverride: 'terminology',
      severityOverride: issue.severity,
      customMessage: issue.message,
      details: issue.details,
    }));
  };

  const visit = (value: any, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (!value || typeof value !== 'object') return;

    if (typeof value.code === 'string' && !value.system && isCodingHygienePath(path)) {
      pushOnce({
        severity: 'warning',
        code: 'terminology-coding-missing-system',
        message: 'Coding has no system. A code with no system has no defined meaning, and it cannot be validated. A system should be provided',
        path,
      });
    }

    if (value.system === 'http://unitsofmeasure.org' && typeof value.code === 'string') {
      const result = validateUcumCode(value.code);
      if (result.valid && ucumCodeHasAnnotation(value.code)) {
        pushOnce({
          severity: 'information',
          code: 'terminology-ucum-annotation',
          message: `UCUM code '${value.code}' at ${path}.code contains a human-readable annotation. UCUM annotations are ignored semantically, so validation should not depend on them`,
          path: `${path}.code`,
        });
      } else if (!result.valid) {
        pushOnce({
          severity: 'error',
          code: 'terminology-code-invalid',
          message: buildInvalidUcumMessage(value.code, `${path}.code`, result.message),
          path: `${path}.code`,
          details: buildInvalidUcumIssueDetails(value.code, `${path}.code`, result.message),
        });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (root === 'Bundle' && key === 'resource' && /^Bundle\.entry\[\d+\]$/.test(path)) {
        continue;
      }
      visit(child, `${path}.${key}`);
    }
  };

  visit(resource, root);
  return issues;
}
