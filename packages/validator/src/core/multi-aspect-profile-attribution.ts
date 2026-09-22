import type { ProfileApplicationSource, ValidationIssue } from '@records-fhir/validation-types';
import type { MultiAspectResourceContext } from './multi-aspect-resource-preparation.js';
import { applyDeclaredProfileAttribution, resolveDeclaredProfileSubstitution } from './declared-profile-attribution.js';
import {
  applyCodeInferredProfileAttribution,
  createCodeInferredProfileSignpostIssue,
  resolveCodeInferredProfileMatch,
} from './code-inferred-profile-attribution.js';

/** Resolve attribution before severity caps and aspect-scoped advisor rules. */
export function createAspectIssueAttribution(
  context: MultiAspectResourceContext,
  profileFallbackIssue: ValidationIssue | null,
  profileSource?: ProfileApplicationSource,
): (issues: ValidationIssue[], executor: string) => ValidationIssue[] {
  if (profileFallbackIssue) return issues => issues;
  const inferred = resolveCodeInferredProfileMatch(context.resource, context.profileUrl, profileSource);
  if (inferred) return (issues, executor) => [
    ...applyCodeInferredProfileAttribution(issues, inferred),
    ...(executor === 'profile' ? [createCodeInferredProfileSignpostIssue(inferred)] : []),
  ];
  if (resolveDeclaredProfileSubstitution(context.resource, context.profileUrl)) {
    return issues => applyDeclaredProfileAttribution(issues, context.profileUrl, context.structureDef);
  }
  return issues => issues;
}
