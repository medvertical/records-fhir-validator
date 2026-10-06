import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { extractReferencesWithPaths } from './bundle-reference-utils.js';
import { validateSearchsetBundle } from './bundle-searchset-rules.js';
import { displayValue, getBundleEntries, toBundleRecord } from './bundle-validator-records.js';

export function validateBundleTypeRules(
  bundle: Record<string, unknown>,
  bundleType: string,
): ValidationIssue[] {
  const entries = getBundleEntries(bundle);
  const firstResource = toBundleRecord(toBundleRecord(entries[0])?.resource);
  if (bundleType === 'searchset') return validateSearchsetBundle(bundle, entries);
  if (bundleType === 'history' && bundle.total === undefined) {
    return [issue('bundle-history-missing-total', 'Bundle', 'History Bundle should have total element', 'warning')];
  }
  if (bundleType === 'message' && firstResource?.resourceType !== 'MessageHeader') {
    return [issue(
      'bundle-message-first-entry-not-messageheader',
      'Bundle.entry[0].resource',
      `Message Bundle SHALL have a MessageHeader as the first entry (R4 bdl-12). Found ${displayValue(firstResource?.resourceType, '(no resource)')} instead.`,
    )];
  }
  if (bundleType !== 'document') return [];

  const issues: ValidationIssue[] = [];
  const identifier = toBundleRecord(bundle.identifier);
  if (!isNonEmptyString(identifier?.system) || !isNonEmptyString(identifier?.value)) {
    issues.push(issue(
      'bdl-9-violation',
      'Bundle.identifier',
      'bdl-9: Document Bundle SHALL have an identifier with both system and value',
    ));
  }
  if (!isNonEmptyString(bundle.timestamp)) {
    issues.push(issue('bdl-10-violation', 'Bundle.timestamp', 'bdl-10: Document Bundle SHALL have a timestamp'));
  }
  if (firstResource?.resourceType !== 'Composition') {
    issues.push(issue(
      'bundle-document-first-entry-not-composition',
      'Bundle.entry[0].resource',
      `Document Bundle SHALL have a Composition as the first entry (R4 bdl-11). Found ${displayValue(firstResource?.resourceType, '(no resource)')} instead.`,
    ));
  }
  return issues;
}

const RESPONSE_BUNDLE_TYPES = new Set(['batch-response', 'transaction-response']);
const QUERY_RESULT_BUNDLE_TYPES = new Set(['searchset', 'history']);

export function validateBundleFullUrlPresence(
  bundle: Record<string, unknown>,
  bundleType: string | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const isResponse = bundleType !== null && RESPONSE_BUNDLE_TYPES.has(bundleType);
  // "The fullUrl element SHALL have a value" in R4 and R5 alike. R5 exempts
  // the results of a search or history, so those only draw a warning; the
  // reference validator requires no fullUrl in a transaction or batch
  // response, whose entries report their outcome instead.
  const mandatory = bundleType !== null && !QUERY_RESULT_BUNDLE_TYPES.has(bundleType);
  // The reference validator resolves references against the entry's fullUrl
  // in every Bundle; only responses may carry unanchored relative references.
  const anchorsReferences = bundleType !== null && !isResponse;
  for (const [index, value] of getBundleEntries(bundle).entries()) {
    const entry = toBundleRecord(value);
    const resource = toBundleRecord(entry?.resource);
    if (!entry || !resource || (entry.fullUrl !== undefined && entry.fullUrl !== null)) continue;
    const resourceType = displayValue(resource.resourceType, 'unknown');
    // "The fullUrl element SHALL have a value except that: fullUrl can be
    // empty on a POST" — the entry creates the resource, so there is no URL
    // for it yet. A relative reference inside it is still unanchored, which is
    // reported below on its own.
    if (!isResponse && !createsTheResource(entry)) {
      issues.push(issue(
        'bundle-entry-missing-fullurl',
        `Bundle.entry[${index}].fullUrl`,
        mandatory
          ? `Entry[${index}] (${resourceType}) must have a fullUrl in a ${bundleType} Bundle`
          : `Entry[${index}] (${resourceType}) should have a fullUrl`,
        mandatory ? 'error' : 'warning',
      ));
    }
    if (anchorsReferences) issues.push(...relativeReferenceIssues(resource, index));
  }
  if (anchorsReferences) issues.push(...bundleLevelRelativeReferenceIssues(bundle));
  return issues;
}

/**
 * A reference on the Bundle itself (Bundle.identifier.assigner) sits in no
 * entry, so it has no fullUrl to resolve against either; the reference
 * validator reports it like one inside an entry without fullUrl. Signatures
 * are exempt there.
 */
function bundleLevelRelativeReferenceIssues(bundle: Record<string, unknown>): ValidationIssue[] {
  const { entry: _entries, signature: _signature, ...ownElements } = bundle;
  const references: Array<{ reference: string; path: string }> = [];
  extractReferencesWithPaths(ownElements, '', references);
  return references
    .filter(({ reference }) => isUnanchoredRelativeReference(reference))
    .map(({ path }) => issue(
      'bundle-entry-missing-fullurl-relative-ref',
      `Bundle.${path}`,
      'Relative Reference appears inside Bundle whose entry is missing a fullUrl',
    ));
}

function isUnanchoredRelativeReference(reference: string): boolean {
  return Boolean(reference)
    && !reference.startsWith('#')
    && !reference.startsWith('urn:')
    && !/^https?:\/\//.test(reference)
    && !reference.includes('?');
}

function createsTheResource(entry: Record<string, unknown>): boolean {
  const request = toBundleRecord(entry.request);
  return typeof request?.method === 'string' && request.method.toUpperCase() === 'POST';
}

function relativeReferenceIssues(resource: Record<string, unknown>, entryIndex: number): ValidationIssue[] {
  const references: Array<{ reference: string; path: string }> = [];
  extractReferencesWithPaths(resource, '', references);
  return references
    .filter(({ reference }) => isUnanchoredRelativeReference(reference))
    .map(({ path }) => issue(
      'bundle-entry-missing-fullurl-relative-ref',
      path ? `Bundle.entry[${entryIndex}].resource.${path}` : `Bundle.entry[${entryIndex}].resource`,
      'Relative Reference appears inside Bundle whose entry is missing a fullUrl',
    ));
}

function issue(
  code: string,
  path: string,
  message: string,
  severity: 'error' | 'warning' = 'error',
): ValidationIssue {
  return createValidationIssue({
    code,
    path,
    resourceType: 'Bundle',
    customMessage: message,
    severityOverride: severity,
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
