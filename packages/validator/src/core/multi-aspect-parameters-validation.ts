import { computeValidationIssueId, type ValidationIssue } from '@records-fhir/validation-types';
import { BatchValidationAbortedError } from './batch-validator.js';
import type { AspectResult, ValidateOneFn } from './multi-aspect-types.js';
import { awaitAllDrained } from '../utils/await-all-drained.js';
import {
  collectParametersEmbeddedResources,
  rebaseParametersEmbeddedIssue,
} from './parameters-resource-validation.js';

/**
 * Multi-aspect twin of validateParametersResourceTree: validates every
 * resource embedded in Parameters.parameter[].resource (including nested
 * part[].resource) and folds the rebased issues into the parent's aspect
 * buckets, mirroring the contained-resource handling.
 */
export async function appendParametersResourceValidationResults(
  parentResource: Record<string, unknown>,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  validateOne: ValidateOneFn,
  parentAspects: AspectResult[],
  enclosingBundle: Record<string, unknown> | undefined,
  shouldStop: (() => boolean) | undefined,
): Promise<void> {
  const embeddedResources = collectParametersEmbeddedResources(parentResource);
  if (embeddedResources.length === 0) return;

  const results = await awaitAllDrained(embeddedResources.map(async embedded => {
    if (shouldStop?.()) throw new BatchValidationAbortedError();
    const result = await validateOne(
      embedded.resource,
      embedded.profileUrl,
      fhirVersion,
      recursionDepth + 1,
      enclosingBundle,
    );
    if (shouldStop?.()) throw new BatchValidationAbortedError();
    return { ...embedded, result };
  }));

  for (const embedded of results) {
    for (const childAspect of embedded.result.aspects) {
      if (childAspect.aspect === 'metadata') continue;
      const rebase = (issues: ValidationIssue[]) => issues.map(issue => {
        const rebased = rebaseParametersEmbeddedIssue(issue, embedded.pathPrefix, embedded.resource);
        return { ...rebased, id: computeValidationIssueId(rebased) };
      });
      const rebasedIssues = rebase(childAspect.issues);
      const rebasedEvidence = rebase(childAspect.evidenceIssues ?? childAspect.issues);
      if (rebasedIssues.length === 0 && rebasedEvidence.length === 0) continue;

      let parentAspect = parentAspects.find(aspect => aspect.aspect === childAspect.aspect);
      if (!parentAspect) {
        parentAspect = { aspect: childAspect.aspect, issues: [], evidenceIssues: [], validationTime: 0, isValid: true };
        parentAspects.push(parentAspect);
      }
      parentAspect.evidenceIssues ??= [...parentAspect.issues];
      parentAspect.issues.push(...rebasedIssues);
      parentAspect.evidenceIssues.push(...rebasedEvidence);
      parentAspect.validationTime += childAspect.validationTime;
      parentAspect.isValid = parentAspect.issues.every(issue =>
        issue.severity !== 'error' && issue.severity !== 'fatal'
      );
    }
  }
}
