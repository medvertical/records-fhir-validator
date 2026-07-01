import type { ValidationIssue } from '../types';
import { validateNarrativeDiv } from './narrative-xhtml-rules';

export function isHtmlChecksExpression(expression: string | undefined): boolean {
  return /^\s*htmlChecks\(\)\s*$/.test(expression ?? '');
}

export function evaluateHtmlChecksConstraint(
  expression: string | undefined,
  context: unknown,
  path: string,
  resourceType: string,
  profileUrl?: string,
): ValidationIssue[] | null {
  if (!isHtmlChecksExpression(expression)) return null;

  const divValues = collectStringValues(context);
  if (divValues.length === 0) return [];

  const basePath = narrativeBasePath(path);
  return divValues.flatMap(div =>
    validateNarrativeDiv(div, basePath, resourceType)
      .map(issue => ({
        ...issue,
        profile: issue.profile ?? profileUrl,
      })),
  );
}

export function appendHtmlChecksConstraintIssues(
  issues: ValidationIssue[],
  expression: string | undefined,
  context: unknown,
  path: string,
  resourceType: string,
  profileUrl?: string,
): boolean {
  const htmlCheckIssues = evaluateHtmlChecksConstraint(expression, context, path, resourceType, profileUrl);
  if (htmlCheckIssues === null) return false;
  issues.push(...htmlCheckIssues);
  return true;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value && typeof value === 'object') {
    const div = (value as { div?: unknown }).div;
    return typeof div === 'string' ? [div] : [];
  }
  return [];
}

function narrativeBasePath(path: string): string {
  return path.replace(/\.div(?:\[\d+\])?$/i, '');
}
