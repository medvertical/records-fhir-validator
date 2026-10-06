import type { CodeSystemValidationResult } from './terminology-api-types.js';

// Compatibility acceptance may mean a skipped check. Completion comes from
// the actual response parser, without changing the public result shape.
const verifiedResults = new WeakSet<CodeSystemValidationResult>();
// A typed OperationOutcome can reject a display without establishing code membership.
const rejectedDisplays = new WeakSet<CodeSystemValidationResult>();

export function rejectedCodeSystemDisplayResult<T extends CodeSystemValidationResult>(result: T): T {
  rejectedDisplays.add(result);
  return result;
}

export function isRejectedCodeSystemDisplayResult(result: CodeSystemValidationResult): boolean {
  return rejectedDisplays.has(result);
}

export function verifiedCodeSystemResult<T extends CodeSystemValidationResult>(result: T): T {
  verifiedResults.add(result);
  return result;
}

export function isVerifiedCodeSystemResult(result: CodeSystemValidationResult): boolean {
  return verifiedResults.has(result);
}

export function inheritCodeSystemVerification<T extends CodeSystemValidationResult>(
  result: T,
  source: CodeSystemValidationResult,
): T {
  if (isRejectedCodeSystemDisplayResult(source)) rejectedCodeSystemDisplayResult(result);
  return isVerifiedCodeSystemResult(source) ? verifiedCodeSystemResult(result) : result;
}
