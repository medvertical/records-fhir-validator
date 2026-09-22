import type { ValidationSettings, ValidationIssue } from '@records-fhir/validation-types';
import { logger } from '../logger.js';
import type { ExtractedReference } from './reference-extracted-validation.js';
import {
  buildRecursiveReferenceIssues,
  buildReferencePathsByValue,
} from './reference-recursive-issues.js';
import { createReferenceResourceFetcher } from './reference-resource-fetcher.js';
import type { ReferenceResourceFetcher } from './reference-fetch-deadline.js';
import { getRecursiveValidationConfig } from './reference-validation-args.js';
import type { ReferenceValidatorDependencies } from './reference-validator-dependencies.js';
import { createReferenceValidationIssue } from './reference-utils.js';

export type { ReferenceResourceFetcher } from './reference-fetch-deadline.js';

/** Owns optional recursive resolution and its operational failure mapping. */
export class ReferenceValidationRuntime {
  constructor(
    private readonly recursiveValidator: ReferenceValidatorDependencies['recursiveValidator'],
  ) {}

  async validateRecursiveReferences(
    resource: unknown,
    resourceType: string,
    settings: ValidationSettings | undefined,
    extractedReferences: ExtractedReference[],
    fhirClientOrVersion?: unknown,
    resourceFetcher?: ReferenceResourceFetcher,
  ): Promise<ValidationIssue[]> {
    const config = getRecursiveValidationConfig(settings);
    if (!config.enabled) return [];
    logger.debug(`[ReferenceValidator] Recursive validation enabled (maxDepth: ${config.maxDepth})`);

    try {
      const result = await this.recursiveValidator.validateRecursively(
        resource,
        config,
        resourceFetcher ?? createReferenceResourceFetcher(fhirClientOrVersion),
      );
      const issueResult = config.validateExternal
        ? result
        : { ...result, unresolvedReferences: [] };
      const issues = buildRecursiveReferenceIssues(
        issueResult,
        config.timeoutMs,
        resourceType,
        buildReferencePathsByValue(extractedReferences),
      );
      logger.debug(
        `[ReferenceValidator] Recursive validation: ${result.totalResourcesValidated} resources, `
        + `depth ${result.maxDepthReached}, ${result.referencesFollowed} refs followed`
        + (result.timedOut ? ' (TIMED OUT)' : ''),
      );
      return issues;
    } catch (error: unknown) {
      logger.error(
        '[ReferenceValidator] Recursive reference validation failed',
        referenceFailureMetadata(error),
      );
      return [createReferenceFailureIssue(resourceType, 'recursive')];
    }
  }
}

export function createReferenceFailureIssue(
  resourceType: string,
  stage: 'reference' | 'recursive',
): ValidationIssue {
  return createReferenceValidationIssue({
    code: 'reference-validation-error',
    severity: 'error',
    message: 'Reference validation could not be completed',
    humanReadable: 'Reference validation could not be completed',
    details: { resourceType, stage },
    resourceType,
  });
}

export function referenceFailureMetadata(error: unknown): {
  errorType: 'error' | 'non-error';
  errorCode?: string;
} {
  const rawCode = error && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : undefined;
  const errorCode = typeof rawCode === 'string' && /^[A-Z0-9_-]{1,64}$/.test(rawCode)
    ? rawCode
    : undefined;
  return {
    errorType: error instanceof Error ? 'error' : 'non-error',
    ...(errorCode ? { errorCode } : {}),
  };
}
