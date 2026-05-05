/**
 * Validation Types - Backward Compatibility Facade
 * 
 * @deprecated This file re-exports from @records-fhir/validation-types for backward compatibility.
 * For new code, import directly from @records-fhir/validation-types:
 * 
 * ```typescript
 * import {
 *   MessageSignatureComponents,
 *   ValidationResultPerAspectDTO,
 *   computeValidationScore
 * } from '@records-fhir/validation-types';
 * ```
 */

// Re-export all types from the new canonical location
export type {
  ValidationIssue,
  ValidationAspect,
  ValidationSeverity
} from './validation';

export type {
  MessageSignatureComponents,
  MessageSignatureResult,
  RawValidationMessage,
  NormalizedValidationMessage,
  ValidationResultPerAspectDTO,
  AggregatedValidationResult,
  ValidationMessageGroupDTO,
  ValidationGroupMemberDTO,
  ResourceMessagesDTO,
  ValidationSettingsSnapshot
} from './validation';

export {
  computeValidationScore,
  aggregateAspectScores,
  normalizeCanonicalPath,
  normalizeMessageText
} from './validation';
