import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  normalizeRequiredElementPath,
} from './validation-issue-dedupe-utils.js';

export function isRedundantNarrativeRequiredElementIssue(
  issue: ValidationIssue,
  narrativeMissingDivPaths: Set<string>,
): boolean {
  if (narrativeMissingDivPaths.size === 0) return false;
  if (issue.code !== 'structural-required-element-missing') return false;
  return narrativeMissingDivPaths.has(normalizeRequiredElementPath(issue));
}

export function isRedundantDom6Issue(
  issue: ValidationIssue,
  redundantGeneratedNarrativeAdvice: Set<ValidationIssue>,
): boolean {
  return redundantGeneratedNarrativeAdvice.has(issue);
}
