import type { ValidationIssue } from '@records-fhir/validation-types';
import { normalizeChoiceTypePath } from './choice-type-path.js';
import {
  isIndexedBundleEntryResourcePath,
  normalizeIndexedBundleEntryResourcePath,
} from './validation-issue-dedupe-bundle-path-utils.js';

export function isBundleDuplicateFullUrlIssue(issue: ValidationIssue): boolean {
  return issue.code === 'reference-bundle-duplicate-fullurl' ||
    issue.code === 'structural-bundle-fullurl-duplicate';
}

export function normalizeIssuePathForDedupe(issue: ValidationIssue): string {
  const rawPath = normalizeIndexedBundleEntryResourcePath(issue.path || '');
  // Recursive validation annotates contained-resource navigation with a
  // `/*Type/id*/` segment. Strip contained annotations only on contained
  // paths; indexed Bundle entries can also drop theirs because the entry
  // index keeps separate resources scoped.
  const path = rawPath.includes('.contained[')
    ? rawPath.replace(/\/\*[^*]*\*\//g, '').replace(/\.{2,}/g, '.')
    : rawPath;
  if (isIndexedBundleEntryResourcePath(path)) {
    return normalizeChoiceTypePath(path.slice('Bundle.'.length), {
      stripIndices: false,
    });
  }
  const details = issue.details;
  const detailsResourceType = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).resourceType
    : undefined;
  const resourceType = typeof issue.resourceType === 'string'
    ? issue.resourceType
    : typeof detailsResourceType === 'string'
      ? detailsResourceType
      : undefined;

  if (!resourceType) return normalizeChoiceTypePath(path, { stripIndices: false });

  const prefix = `${resourceType}.`.toLowerCase();
  const lowerPath = path.toLowerCase();
  if (lowerPath === resourceType.toLowerCase()) return '';
  const relativePath = lowerPath.startsWith(prefix) ? path.slice(prefix.length) : path;
  return normalizeChoiceTypePath(relativePath, { stripIndices: false });
}

export function getConstraintDedupeKeys(issue: ValidationIssue, constraintKey: string): string[] {
  return getConstraintPathHierarchy(normalizeIssuePathForDedupe(issue))
    .map(path => `${path}:${constraintKey.toLowerCase()}`);
}

function getConstraintPathHierarchy(path: string): string[] {
  const lowerPath = path
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  const bundleEntryIndex = lowerPath.match(/^entry\[(\d+)\]\.resource(?:\.|$)/)?.[1];
  const indexlessPath = lowerPath.replace(/\[\d+\]/g, '');
  const normalized = bundleEntryIndex === undefined
    ? indexlessPath
    : indexlessPath.replace(
      /^entry\.resource/,
      `entry[${bundleEntryIndex}].resource`,
    );
  const paths = [normalized];

  let current = normalized;
  while (current.includes('.')) {
    current = current.slice(0, current.lastIndexOf('.')).replace(/\.$/, '');
    paths.push(current);
    if (isBundleEntryResourceRoot(current)) {
      return paths;
    }
  }

  if (!isBundleEntryResourcePath(normalized) && !paths.includes('')) {
    paths.push('');
  }

  return paths;
}

function isBundleEntryResourcePath(path: string): boolean {
  return /^entry(?:\[\d+\])?\.resource(?:\/\*[^*]*\*\/)?(?:\.|$)/.test(path);
}

function isBundleEntryResourceRoot(path: string): boolean {
  return /^entry(?:\[\d+\])?\.resource(?:\/\*[^*]*\*\/)?\/?$/.test(path);
}
