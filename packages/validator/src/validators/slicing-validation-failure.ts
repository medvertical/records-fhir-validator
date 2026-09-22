import { createValidationIssue } from '../issues/index.js';
import { logger } from '../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  createSafeValidationFailureMessage,
  validationFailureMetadata,
} from '../utils/validation-execution-failure.js';
import { resourceTypeFromPath } from './slicing-content-rules.js';

/** Log bounded diagnostics and create the safe public Slicing failure issue. */
export function handleSlicingValidationFailure(
  error: unknown,
  elementPath: string,
): ValidationIssue {
  logger.error(
    '[SlicingValidator] Slicing validation failed',
    validationFailureMetadata(error),
  );
  return createValidationIssue({
    code: 'profile-slice-validation-error',
    path: elementPath,
    resourceType: resourceTypeFromPath(elementPath),
    customMessage: createSafeValidationFailureMessage('Slicing validation'),
  });
}
