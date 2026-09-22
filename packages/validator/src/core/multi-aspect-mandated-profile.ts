import type { ValidationIssue } from '@records-fhir/validation-types';
import { BatchValidationAbortedError } from './batch-validator.js';
import { mandatedProfileAdditions, mandatedProfileBeside } from './mandated-profile-pass.js';
import type { AspectResult, ValidateOneFn } from './multi-aspect-types.js';

/**
 * The multi-aspect side of the mandated-profile pass; see
 * `mandated-profile-pass.ts` for why a declared profile does not replace the
 * one the resource's code requires.
 */
export async function appendMandatedProfileValidationResults(
  resource: Record<string, unknown>,
  appliedProfileUrl: string | undefined,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  validateOne: ValidateOneFn,
  collectedAspects: AspectResult[],
  enclosingBundle: Record<string, unknown> | undefined,
  shouldStop: (() => boolean) | undefined,
  containingResource?: Record<string, unknown>,
): Promise<void> {
  const mandatedProfileUrl = mandatedProfileBeside(resource, appliedProfileUrl);
  if (!mandatedProfileUrl) return;

  if (shouldStop?.()) throw new BatchValidationAbortedError();
  const mandated = await validateOne(
    resource,
    mandatedProfileUrl,
    fhirVersion,
    recursionDepth + 1,
    enclosingBundle,
    true,
    containingResource,
  );
  if (shouldStop?.()) throw new BatchValidationAbortedError();

  const alreadyReported = collectedAspects.flatMap(aspect => aspect.issues);
  const alreadyRecorded = collectedAspects.flatMap(aspect => aspect.evidenceIssues ?? aspect.issues);
  for (const aspect of mandated.aspects) {
    const additions = mandatedProfileAdditions(alreadyReported, aspect.issues, mandatedProfileUrl);
    const evidence = mandatedProfileAdditions(alreadyRecorded, aspect.evidenceIssues ?? aspect.issues, mandatedProfileUrl);
    if (additions.length === 0 && evidence.length === 0) continue;
    alreadyReported.push(...additions);
    alreadyRecorded.push(...evidence);
    mergeIntoAspect(collectedAspects, aspect, additions, evidence);
  }
}

function mergeIntoAspect(
  collectedAspects: AspectResult[],
  aspect: AspectResult,
  additions: ValidationIssue[],
  evidence: ValidationIssue[],
): void {
  const breaks = additions.some(issue => issue.severity === 'error' || issue.severity === 'fatal');
  const existing = collectedAspects.find(candidate => candidate.aspect === aspect.aspect);
  if (existing) {
    existing.evidenceIssues ??= [...existing.issues];
    existing.issues.push(...additions);
    existing.evidenceIssues.push(...evidence);
    existing.validationTime += aspect.validationTime;
    if (breaks) existing.isValid = false;
    return;
  }
  collectedAspects.push({ ...aspect, issues: additions, evidenceIssues: evidence, isValid: !breaks });
}
