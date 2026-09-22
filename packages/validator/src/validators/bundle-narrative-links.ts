import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';

const NARRATIVE_LINK_URL = 'http://hl7.org/fhir/StructureDefinition/narrativeLink';

/** Validate resource-to-narrative fragment links across Bundle entries. */
export function validateBundleNarrativeLinks(bundle: unknown): ValidationIssue[] {
  if (!isRecord(bundle) || !Array.isArray(bundle.entry)) return [];
  const entries = bundle.entry;
  const resourcesByFullUrl = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.fullUrl !== 'string' || !isRecord(entry.resource)) continue;
    resourcesByFullUrl.set(entry.fullUrl, entry.resource);
  }

  const issues: ValidationIssue[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || !isRecord(entry.resource) || !Array.isArray(entry.resource.extension)) continue;
    for (const extension of entry.resource.extension) {
      if (!isRecord(extension) || extension.url !== NARRATIVE_LINK_URL) continue;
      const link = typeof extension.valueUrl === 'string'
        ? extension.valueUrl
        : typeof extension.valueUri === 'string'
          ? extension.valueUri
          : undefined;
      if (!link) continue;
      const separator = link.lastIndexOf('#');
      if (separator <= 0 || separator === link.length - 1) continue;
      const targetUrl = link.slice(0, separator);
      const fragment = link.slice(separator + 1);
      const targetResource = resourcesByFullUrl.get(targetUrl);
      const matches = targetResource ? countNarrativeIdMatches(targetResource, fragment) : 0;

      if (matches === 0) {
        issues.push(createValidationIssue({
          code: 'bundle-narrative-link-target-not-found',
          path: 'Bundle',
          resourceType: 'Bundle',
          customMessage: `Can't find narrative fragment '${fragment}' in bundle resource '${targetUrl}'`,
          severityOverride: 'error',
          details: { link, targetUrl, fragment },
        }));
      } else if (matches > 1) {
        issues.push(createValidationIssue({
          code: 'bundle-narrative-link-target-ambiguous',
          path: 'Bundle',
          resourceType: 'Bundle',
          customMessage: `Found ${matches} matches for narrative fragment '${fragment}' in bundle resource '${targetUrl}'`,
          severityOverride: 'error',
          details: { link, targetUrl, fragment, matchCount: matches },
        }));
      }
    }
  }
  return issues;
}

function countNarrativeIdMatches(resource: Record<string, unknown>, targetId: string): number {
  let matches = 0;
  const visited = new WeakSet<object>();
  const stack: unknown[] = [resource];
  while (stack.length > 0 && matches <= 1) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'div' && typeof child === 'string') {
        matches += countIdAttributes(child, targetId);
      } else if (child && typeof child === 'object') {
        stack.push(child);
      }
    }
  }
  return matches;
}

function countIdAttributes(div: string, targetId: string): number {
  let matches = 0;
  const scannable = div
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const tagPattern = /<(?!\/|!|\?)[A-Za-z][A-Za-z0-9:.-]*\b[^>]*>/g;
  for (const tag of scannable.match(tagPattern) ?? []) {
    const id = tag.match(/\bid\s*=\s*(["'])([^"']+)\1/i)?.[2];
    if (id === targetId) matches++;
  }
  return matches;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
