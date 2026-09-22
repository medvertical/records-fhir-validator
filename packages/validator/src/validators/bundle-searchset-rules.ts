import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';

const RESOURCE_TYPE_PATTERN = /^[A-Z][A-Za-z]+$/;

export function validateSearchsetBundle(bundle: unknown, entries: unknown[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bundleRecord = asRecord(bundle) ?? {};

  if (bundleRecord.total === undefined) {
    issues.push(createValidationIssue({
      code: 'bundle-searchset-missing-total',
      path: 'Bundle',
      resourceType: 'Bundle',
      customMessage: 'Searchset Bundle should have total element',
      severityOverride: 'warning',
    }));
  }

  const links = Array.isArray(bundleRecord.link) ? bundleRecord.link : [];
  const selfLink = links.map(asRecord).find(link => link?.relation === 'self');
  if (!selfLink) {
    issues.push(createValidationIssue({
      code: 'bundle-searchset-missing-self-link',
      path: 'Bundle',
      resourceType: 'Bundle',
      customMessage: 'SearchSet Bundles should have a self link that specifies what the search was',
      severityOverride: 'warning',
    }));

    if (entries.some(entry => !asRecord(asRecord(entry)?.search)?.mode)) {
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
    const entry = asRecord(entries[i]);
    const mode = asRecord(entry?.search)?.mode;
    const res = asRecord(entry?.resource);
    if (!res) continue;
    const resourceType = typeof res.resourceType === 'string' ? res.resourceType : undefined;

    if ((mode === 'match' || mode === 'include') && !res.id) {
      issues.push(createValidationIssue({
        code: 'bundle-searchset-entry-missing-id',
        path: `Bundle.entry[${i}].resource`,
        resourceType: 'Bundle',
        customMessage: 'Search results must have ids',
        severityOverride: 'error',
      }));
    }

    if (mode === 'outcome' && resourceType && resourceType !== 'OperationOutcome') {
      issues.push(createValidationIssue({
        code: 'bundle-searchset-outcome-wrong-type',
        path: `Bundle.entry[${i}].resource`,
        resourceType: 'Bundle',
        customMessage: `This is not an OperationOutcome (${resourceType})`,
        severityOverride: 'error',
      }));
    }

    issues.push(...checkEntryTypeMatchesSearch(expectedTypes, resourceType, mode, i));
  }

  return issues;
}

/**
 * Per FHIR search semantics only `mode=match` entries must be of the searched
 * type — `_include`/`_revinclude` entries (mode=include) may be any resource
 * type. An absent mode leaves the entry's role unknown, so the mismatch is
 * only a warning (HL7 validator parity: BUNDLE_SEARCH_ENTRY_WRONG_RESOURCE_TYPE_NO_MODE).
 */
function checkEntryTypeMatchesSearch(
  expectedTypes: string[],
  resourceType: string | undefined,
  mode: unknown,
  entryIndex: number,
): ValidationIssue[] {
  if (expectedTypes.length === 0 || !resourceType || expectedTypes.includes(resourceType)) {
    return [];
  }
  if (mode !== 'match' && mode !== undefined) return [];

  const modeHint = mode === undefined ? '(is a search mode needed?) ' : '';
  return [createValidationIssue({
    code: 'bundle-searchset-entry-wrong-type',
    path: `Bundle.entry[${entryIndex}].resource`,
    resourceType: 'Bundle',
    customMessage:
      `This is not a matching resource type for the specified search ` +
      `${modeHint}(${resourceType} expecting [${expectedTypes.join(', ')}])`,
    severityOverride: mode === 'match' ? 'error' : 'warning',
  })];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
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
