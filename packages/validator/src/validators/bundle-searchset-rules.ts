import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';

const RESOURCE_TYPE_PATTERN = /^[A-Z][A-Za-z]+$/;

export function validateSearchsetBundle(bundle: any, entries: any[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (bundle.total === undefined) {
    issues.push(createValidationIssue({
      code: 'bundle-searchset-missing-total',
      path: 'Bundle',
      resourceType: 'Bundle',
      customMessage: 'Searchset Bundle should have total element',
      severityOverride: 'warning',
    }));
  }

  const links: any[] = Array.isArray(bundle.link) ? bundle.link : [];
  const selfLink = links.find(l => l?.relation === 'self');
  if (!selfLink) {
    issues.push(createValidationIssue({
      code: 'bundle-searchset-missing-self-link',
      path: 'Bundle',
      resourceType: 'Bundle',
      customMessage: 'SearchSet Bundles should have a self link that specifies what the search was',
      severityOverride: 'warning',
    }));

    if (entries.some((e: any) => !e?.search?.mode)) {
      issues.push(createValidationIssue({
        code: 'bundle-searchset-missing-search-mode',
        path: 'Bundle',
        resourceType: 'Bundle',
        customMessage: 'SearchSet bundles should have search modes on the entries',
        severityOverride: 'warning',
      }));
    }
  }

  const expectedTypes = parseSearchSelfLinkTypes(typeof selfLink?.url === 'string' ? selfLink.url : '');

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const mode = entry?.search?.mode;
    const res = entry?.resource;
    if (!res) continue;

    if ((mode === 'match' || mode === 'include') && !res.id) {
      issues.push(createValidationIssue({
        code: 'bundle-searchset-entry-missing-id',
        path: `Bundle.entry[${i}].resource`,
        resourceType: 'Bundle',
        customMessage: 'Search results must have ids',
        severityOverride: 'error',
      }));
    }

    if (mode === 'outcome' && res.resourceType && res.resourceType !== 'OperationOutcome') {
      issues.push(createValidationIssue({
        code: 'bundle-searchset-outcome-wrong-type',
        path: `Bundle.entry[${i}].resource`,
        resourceType: 'Bundle',
        customMessage: `This is not an OperationOutcome (${res.resourceType})`,
        severityOverride: 'error',
      }));
    }

    if (
      expectedTypes.length > 0 &&
      res.resourceType &&
      mode !== 'outcome' &&
      !expectedTypes.includes(res.resourceType)
    ) {
      issues.push(createValidationIssue({
        code: 'bundle-searchset-entry-wrong-type',
        path: `Bundle.entry[${i}].resource`,
        resourceType: 'Bundle',
        customMessage:
          `This is not a matching resource type for the specified search ` +
          `(${res.resourceType} expecting [${expectedTypes.join(', ')}])`,
        severityOverride: 'error',
      }));
    }
  }

  return issues;
}

function parseSearchSelfLinkTypes(url: string): string[] {
  if (!url) return [];
  const queryIdx = url.indexOf('?');
  const path = queryIdx >= 0 ? url.slice(0, queryIdx) : url;
  const query = queryIdx >= 0 ? url.slice(queryIdx + 1) : '';

  const types: string[] = [];
  const pathSegments = path.split('/').filter(Boolean);
  const last = pathSegments[pathSegments.length - 1];
  if (last && RESOURCE_TYPE_PATTERN.test(last)) {
    types.push(last);
  }

  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    if (key !== '_type') continue;
    const value = decodeURIComponent(part.slice(eq + 1));
    for (const t of value.split(',')) {
      const trimmed = t.trim();
      if (RESOURCE_TYPE_PATTERN.test(trimmed) && !types.includes(trimmed)) {
        types.push(trimmed);
      }
    }
  }

  return types;
}
