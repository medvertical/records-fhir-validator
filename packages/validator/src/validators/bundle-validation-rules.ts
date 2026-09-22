import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateBundleCrossEntryReferences } from './bundle-cross-entry-references.js';
import {
  bundleHasDuplicateEntryIds,
  detectDuplicateBundleEntries,
  validateBundleEntryIdConsistency,
  validateBundleFullUrls,
  validateBundleLinkRelations,
} from './bundle-entry-rules.js';
import {
  validateBundleEntryResources,
  type EntryResourceValidator,
} from './bundle-entry-resource-validation.js';
import { validateBundleNarrativeLinks } from './bundle-narrative-links.js';
import { validateBundleReachability } from './bundle-reachability.js';
import { validateBundleFullUrlPresence, validateBundleTypeRules } from './bundle-type-rules.js';

interface BundleStructureIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  path?: string;
  entryIndex?: number;
}

export interface BundleValidationResolver {
  getBundleType(bundle: unknown): string | null;
  validateBundleStructure(bundle: unknown): BundleStructureIssue[];
}

export async function validateBundleRules(
  bundle: Record<string, unknown>,
  resolver: BundleValidationResolver,
  entryValidator?: EntryResourceValidator,
): Promise<ValidationIssue[]> {
  const issues = structureIssues(bundle, resolver);
  const bundleType = resolver.getBundleType(bundle);
  if (bundleType) issues.push(...validateBundleTypeRules(bundle, bundleType));
  const strictReferences = bundleHasDuplicateEntryIds(bundle);
  if (bundleType === 'document' || bundleType === 'message') {
    issues.push(...validateBundleReachability(bundle, bundleType, strictReferences));
  }
  issues.push(
    ...validateBundleCrossEntryReferences(bundle, bundleType, strictReferences),
    ...detectDuplicateBundleEntries(bundle),
    ...validateBundleFullUrlPresence(bundle, bundleType),
    ...validateBundleFullUrls(bundle, bundleType),
    ...validateBundleEntryIdConsistency(bundle),
    ...validateBundleLinkRelations(bundle),
    ...validateBundleNarrativeLinks(bundle),
  );
  if (entryValidator) issues.push(...await validateBundleEntryResources(bundle, entryValidator));
  return issues;
}

function structureIssues(
  bundle: Record<string, unknown>,
  resolver: BundleValidationResolver,
): ValidationIssue[] {
  return resolver.validateBundleStructure(bundle).map(issue => createValidationIssue({
    code: issue.code,
    path: issue.path ?? (issue.entryIndex !== undefined ? `Bundle.entry[${issue.entryIndex}]` : 'Bundle'),
    resourceType: 'Bundle',
    customMessage: issue.message,
    severityOverride: issue.severity,
  }));
}
