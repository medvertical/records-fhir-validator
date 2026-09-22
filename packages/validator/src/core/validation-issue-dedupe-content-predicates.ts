import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  normalizeNarrativeTextPath,
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
  narrativeMissingDivTextPaths: Set<string>,
): boolean {
  if (narrativeMissingDivTextPaths.size === 0) return false;
  if (issue.code !== 'dom-6') return false;
  return narrativeMissingDivTextPaths.has(normalizeNarrativeTextPath(issue));
}
