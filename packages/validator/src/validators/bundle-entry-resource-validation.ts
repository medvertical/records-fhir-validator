import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { createSafeValidationFailureMessage } from '../utils/validation-execution-failure.js';
import { getBundleEntries, toBundleRecord } from './bundle-validator-records.js';

export type EntryResourceValidator = (
  resource: Record<string, unknown>,
  entryIndex: number,
) => Promise<ValidationIssue[]>;

export async function validateBundleEntryResources(
  bundle: Record<string, unknown>,
  validator: EntryResourceValidator,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const [index, entry] of getBundleEntries(bundle).entries()) {
    const resource = toBundleRecord(toBundleRecord(entry)?.resource);
    if (typeof resource?.resourceType !== 'string') continue;
    try {
      const entryIssues = await validator(resource, index);
      if (!Array.isArray(entryIssues)) throw new Error('Entry validator returned a malformed issue list');
      issues.push(...entryIssues.map(issue => ({
        ...issue,
        path: issue.path
          ? `Bundle.entry[${index}].resource.${issue.path}`
          : `Bundle.entry[${index}].resource`,
      })));
    } catch {
      logger.warn('[BundleValidator] Bundle entry validation failed', {
        entryIndex: index,
        entryResourceType: resource.resourceType,
      });
      issues.push(createValidationIssue({
        code: 'bundle-entry-validation-error',
        path: `Bundle.entry[${index}].resource`,
        resourceType: 'Bundle',
        aspectOverride: 'profile',
        customMessage: createSafeValidationFailureMessage(`Bundle entry[${index}] validation`),
        severityOverride: 'error',
        details: { entryIndex: index, entryResourceType: resource.resourceType },
      }));
    }
  }
  return issues;
}
