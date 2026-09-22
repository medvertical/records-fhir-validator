import type { ValidationSettings, ValidationIssue } from '@records-fhir/validation-types';
import { logger } from '../logger.js';
import { addR6WarningIfNeeded } from '../utils/r6-support-warnings.js';
import { extractReferences } from './reference-format-validator.js';
import { validateContainedReferenceIssues } from './reference-contained-validation.js';
import { validateExtractedReferences } from './reference-extracted-validation.js';
import {
  normalizeReferenceValidationArgs,
} from './reference-validation-args.js';
import type { ReferenceValidatorDependencies } from './reference-validator-dependencies.js';
import type { ReferenceResourceFetcher } from './reference-fetch-deadline.js';
import {
  createReferenceFailureIssue,
  referenceFailureMetadata,
  ReferenceValidationRuntime,
} from './reference-validation-runtime.js';

export type { ReferenceResourceFetcher } from './reference-validation-runtime.js';

export class ReferenceValidationWorkflow {
  private readonly runtime: ReferenceValidationRuntime;

  constructor(
    private readonly constraintValidator: ReferenceValidatorDependencies['constraintValidator'],
    recursiveValidator: ReferenceValidatorDependencies['recursiveValidator'],
  ) {
    this.runtime = new ReferenceValidationRuntime(recursiveValidator);
  }

  async validate(
    resource: unknown,
    resourceType: string,
    fhirClientOrVersion?: unknown,
    fhirVersionOrSettings?: 'R4' | 'R5' | 'R6' | ValidationSettings,
    settings?: ValidationSettings,
    resourceFetcher?: ReferenceResourceFetcher,
  ): Promise<ValidationIssue[]> {
    let issues: ValidationIssue[] = [];
    const startedAt = Date.now();
    if (!resource) {
      logger.warn('[ReferenceValidator] Null resource provided');
      return issues;
    }

    const { fhirVersion, actualSettings } = normalizeReferenceValidationArgs(
      fhirClientOrVersion,
      fhirVersionOrSettings,
      settings,
    );
    const effectiveResourceType = resourceType
      || getResourceString(resource, 'resourceType')
      || 'Unknown';
    logger.debug(`[ReferenceValidator] Validating ${effectiveResourceType} references...`);

    try {
      if (fhirVersion === 'R6') {
        issues = addR6WarningIfNeeded(issues, fhirVersion, 'reference');
      }
      const extractedReferences = extractReferences(resource, effectiveResourceType);
      if (extractedReferences.length === 0) {
        logger.debug(`[ReferenceValidator] No references found in ${effectiveResourceType}`);
        return issues;
      }

      logger.debug(
        `[ReferenceValidator] Found ${extractedReferences.length} references to validate`,
      );
      issues.push(...validateExtractedReferences(
        extractedReferences,
        effectiveResourceType,
        this.constraintValidator,
      ));
      issues.push(...await validateContainedReferenceIssues(resource, effectiveResourceType));
      issues.push(...await this.runtime.validateRecursiveReferences(
        resource,
        effectiveResourceType,
        actualSettings,
        extractedReferences,
        fhirClientOrVersion,
        resourceFetcher,
      ));

      logValidationResult(effectiveResourceType, issues.length, Date.now() - startedAt);
      return issues;
    } catch (error: unknown) {
      logger.error(
        '[ReferenceValidator] Reference validation failed',
        referenceFailureMetadata(error),
      );
      issues.push(createReferenceFailureIssue(effectiveResourceType, 'reference'));
      return issues;
    }
  }
}

function logValidationResult(resourceType: string, issueCount: number, elapsedMs: number): void {
  const log = elapsedMs > 100 ? logger.info.bind(logger) : logger.debug.bind(logger);
  log(
    `[ReferenceValidator] Validated ${resourceType} references in ${elapsedMs}ms `
    + `(${issueCount} issues)`,
  );
}

function getResourceString(resource: unknown, key: string): string | undefined {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return undefined;
  const value = (resource as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}
