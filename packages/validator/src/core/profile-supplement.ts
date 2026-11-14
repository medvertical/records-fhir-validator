import type { ValidationIssue } from '@records-fhir/validation-types';

/** Trusted host-supplied rules; module selection is not executable user input. */
export interface ProfileSupplement {
  id: string;
  validate(resource: unknown, profileUrl: string): ValidationIssue[];
}
