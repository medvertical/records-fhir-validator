import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateNarrativeDiv, validateXhtmlFragment } from './narrative-xhtml-rules.js';

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

  // Narrative.div carries the full narrative contract (root div, txt-2);
  // htmlChecks() on any other string element — e.g. the rendering-xhtml
  // extension's valueString — validates an xhtml fragment instead.
  const narrativeContext = pathTargetsNarrativeDiv(path) || contextCarriesNarrativeDiv(context);
  const basePath = narrativeBasePath(path);
  return divValues.flatMap(div =>
    (narrativeContext
      ? validateNarrativeDiv(div, basePath, resourceType)
      : validateXhtmlFragment(div, path, resourceType))
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

function pathTargetsNarrativeDiv(path: string): boolean {
  return /\.div(?:\[\d+\])?$/i.test(path);
}

function contextCarriesNarrativeDiv(context: unknown): boolean {
  if (Array.isArray(context)) return context.some(contextCarriesNarrativeDiv);
  return typeof context === 'object' && context !== null
    && typeof (context as { div?: unknown }).div === 'string';
}
