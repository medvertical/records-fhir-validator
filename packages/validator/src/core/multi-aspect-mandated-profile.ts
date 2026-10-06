import type { ValidationIssue } from '@records-fhir/validation-types';
import { BatchValidationAbortedError } from './batch-validator.js';
import { imposedProfilesBeside, mandatedProfileAdditions, mandatedProfileBeside } from './mandated-profile-pass.js';
import type { AspectResult, ValidateOneFn } from './multi-aspect-types.js';
import type { StructureDefinition } from './structure-definition-types.js';
import { applyProfilePinToCanonical } from '../package/canonical-pin-context.js';
import { resolveValueSetPackageDirectories } from '../validators/valueset-package-resource-access.js';

/**
 * The multi-aspect side of the mandated-profile pass; see
 * `mandated-profile-pass.ts` for why a declared profile does not replace the
 * one the resource's code requires, nor the ones the applied profile imposes.
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
  appliedStructureDef?: Pick<StructureDefinition, 'url' | 'version' | 'extension'>,
): Promise<void> {
  // An imposed canonical resolves as the imposing IG was published against
  // it: CH Lab Report imposes EU Laboratory's result profile in 0.1.1, whose
  // component value slicing is open, not in the newest installed release.
  const imposed = await Promise.all(imposedProfilesBeside(appliedStructureDef, appliedProfileUrl).map(url =>
    applyProfilePinToCanonical(resolveValueSetPackageDirectories(), appliedStructureDef ?? {}, url, fhirVersion)));
  const besideProfiles = new Set([mandatedProfileBeside(resource, appliedProfileUrl), ...imposed]
    .filter((url): url is string => Boolean(url)));
  for (const profileUrl of besideProfiles) {
    await appendBesideProfileResults(profileUrl, resource, fhirVersion, recursionDepth, validateOne,
      collectedAspects, enclosingBundle, shouldStop, containingResource);
  }
}

async function appendBesideProfileResults(
  mandatedProfileUrl: string,
  resource: Record<string, unknown>,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  validateOne: ValidateOneFn,
  collectedAspects: AspectResult[],
  enclosingBundle: Record<string, unknown> | undefined,
  shouldStop: (() => boolean) | undefined,
  containingResource?: Record<string, unknown>,
): Promise<void> {
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
