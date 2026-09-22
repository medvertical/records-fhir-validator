import { logger } from '../logger.js';
import { BundleReferenceResolver } from '../reference/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { EntryResourceValidator } from './bundle-entry-resource-validation.js';
import { handleBundleValidationFailure } from './bundle-validation-failure.js';
import {
  validateBundleRules,
  type BundleValidationResolver,
} from './bundle-validation-rules.js';
import { toBundleRecord } from './bundle-validator-records.js';

export type { EntryResourceValidator } from './bundle-entry-resource-validation.js';

export class BundleValidator {
  constructor(
    private readonly bundleResolver: BundleValidationResolver = new BundleReferenceResolver(),
  ) {}

  async validateBundle(
    resource: unknown,
    entryValidator?: EntryResourceValidator,
  ): Promise<ValidationIssue[]> {
    const bundle = toBundleRecord(resource);
    if (bundle?.resourceType !== 'Bundle') return [];
    const issues: ValidationIssue[] = [];
    logger.debug('[BundleValidator] Validating Bundle structure and references');
    try {
      issues.push(...await validateBundleRules(bundle, this.bundleResolver, entryValidator));
      logger.debug(`[BundleValidator] Found ${issues.length} issues in Bundle`);
    } catch {
      issues.push(handleBundleValidationFailure());
    }
    return issues;
  }
}
