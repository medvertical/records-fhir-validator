import type { ValidationIssue } from '@records-fhir/validation-types';
import { logger } from '../logger.js';
import { createSafeValidationFailureMessage } from '../utils/validation-execution-failure.js';
import type { FhirClientLike } from './profile-loader-utils.js';
import { createValidationErrorIssue } from './validation-utils.js';
import type { MetadataExecutor, ReferenceExecutor } from './executors/index.js';

export class ValidatorDirectAspectValidation {
  constructor(
    private readonly metadataExecutor: MetadataExecutor,
    private readonly referenceExecutor: ReferenceExecutor,
  ) {}

  async validateMetadata(resource: unknown): Promise<ValidationIssue[]> {
    try {
      return await this.metadataExecutor.validate({ resource });
    } catch (error: unknown) {
      logger.error('[RecordsValidator] Metadata validation failed');
      throw error;
    }
  }

  async validateReferences(
    resource: unknown,
    fhirClient?: FhirClientLike,
    fhirVersion?: 'R4' | 'R5' | 'R6',
  ): Promise<ValidationIssue[]> {
    try {
      return await this.referenceExecutor.validate({ resource, fhirClient, fhirVersion });
    } catch {
      logger.error('[RecordsValidator] Reference validation failed');
      return [createValidationErrorIssue(
        'reference',
        'validation-error',
        createSafeValidationFailureMessage('Reference validation'),
      )];
    }
  }
}
