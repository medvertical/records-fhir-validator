import { logger } from '../logger.js';
import { validationFailureMetadata } from '../utils/validation-execution-failure.js';
import { recordTerminologyReason } from './valueset-diagnostics.js';
import type { CodeBindingOutcome, TerminologyDiagnostics } from './valueset-types.js';

export async function resolveCodeBindingSafely(
  resolve: () => Promise<CodeBindingOutcome>,
  terminologyDiagnostics: TerminologyDiagnostics,
  onValidationError?: () => void,
): Promise<CodeBindingOutcome> {
  try {
    return await resolve();
  } catch (error: unknown) {
    logger.warn(
      '[ValueSetValidator] Binding validation failed, treating as unverified',
      validationFailureMetadata(error),
    );
    recordTerminologyReason(terminologyDiagnostics.unverifiedBindings, 'validation-error');
    onValidationError?.();
    return 'unverified';
  }
}
