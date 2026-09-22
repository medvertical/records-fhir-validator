import { withProfileProvenanceDetails } from './profile-attribution-relabel.js';
import { computeValidationIssueId } from '@records-fhir/validation-types';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { BatchValidationAbortedError } from './batch-validator.js';
import type { AspectResult, ValidateOneFn } from './multi-aspect-types.js';
import { getPrimaryDeclaredProfile } from './declared-profile-utils.js';
import { awaitAllDrained } from '../utils/await-all-drained.js';

export function attachAppliedProfile(issue: ValidationIssue, appliedProfile: string): ValidationIssue {
  if (issue.profile || !appliedProfile) return issue;
  return {
    ...issue,
    profile: appliedProfile,
    details: withProfileProvenanceDetails(issue.details, { profileAttribution: 'validation-context' }),
    id: computeValidationIssueId({
      aspect: issue.aspect,
      severity: issue.severity,
      code: issue.code,
      path: issue.path,
      resourceType: issue.resourceType,
      message: issue.message,
      profile: appliedProfile,
      ruleId: issue.ruleId,
      details: issue.details,
    }),
  };
}

export async function appendContainedResourceValidationResults(
  parentResource: Record<string, unknown>,
  fhirVersion: 'R4' | 'R5' | 'R6',
  recursionDepth: number,
  validateOne: ValidateOneFn,
  parentAspects: AspectResult[],
  enclosingBundle: Record<string, unknown> | undefined,
  shouldStop: (() => boolean) | undefined,
): Promise<void> {
  const containedResources = Array.isArray(parentResource.contained) ? parentResource.contained : [];
  const targets = containedResources
    .map((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') return null;
      const resource = candidate as Record<string, unknown>;
      if (typeof resource.resourceType !== 'string') return null;
      return {
        index,
        resource,
        resourceType: resource.resourceType,
        profileUrl: getPrimaryDeclaredProfile(resource)
          ?? `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`,
      };
    })
    .filter((target): target is {
      index: number;
      resource: Record<string, unknown>;
      resourceType: string;
      profileUrl: string;
    } => target !== null);

  const results = await awaitAllDrained(targets.map(async target => {
    if (shouldStop?.()) throw new BatchValidationAbortedError();
    const result = await validateOne(
      target.resource,
      target.profileUrl,
      fhirVersion,
      recursionDepth + 1,
      enclosingBundle,
      false,
      parentResource,
    );
    if (shouldStop?.()) throw new BatchValidationAbortedError();
    return { ...target, result };
  }));

  const parentResourceType = typeof parentResource.resourceType === 'string'
    ? parentResource.resourceType
    : 'Resource';
  for (const target of results) {
    const prefix = `${parentResourceType}.contained[${target.index}]`;
    for (const childAspect of target.result.aspects) {
      mergeContainedAspect(parentAspects, childAspect, parentResource, {
        prefix, parentResourceType, resourceType: target.resourceType, resource: target.resource,
      });
    }
  }
}

function mergeContainedAspect(
  parentAspects: AspectResult[],
  childAspect: AspectResult,
  parentResource: Record<string, unknown>,
  target: { prefix: string; parentResourceType: string; resourceType: string; resource: Record<string, unknown> },
): void {
  if (childAspect.aspect === 'metadata') return;
  const rewrite = (issues: ValidationIssue[]) => issues
    .filter(issue => !isResolvedContainedReferenceIssue(issue, parentResource))
    .map(issue => rewriteContainedIssue(
      issue, target.prefix, target.parentResourceType, target.resourceType, target.resource,
    ));
  const rewrittenIssues = rewrite(childAspect.issues);
  const rewrittenEvidence = rewrite(childAspect.evidenceIssues ?? childAspect.issues);
  if (rewrittenIssues.length === 0 && rewrittenEvidence.length === 0) return;

  let parentAspect = parentAspects.find(aspect => aspect.aspect === childAspect.aspect);
  if (!parentAspect) {
    parentAspect = { aspect: childAspect.aspect, issues: [], evidenceIssues: [], validationTime: 0, isValid: true };
    parentAspects.push(parentAspect);
  }
  parentAspect.evidenceIssues ??= [...parentAspect.issues];
  parentAspect.issues.push(...rewrittenIssues);
  parentAspect.evidenceIssues.push(...rewrittenEvidence);
  parentAspect.validationTime += childAspect.validationTime;
  parentAspect.isValid = parentAspect.issues.every(issue =>
    issue.severity !== 'error' && issue.severity !== 'fatal'
  );
}

function rewriteContainedIssue(
  issue: ValidationIssue,
  prefix: string,
  parentResourceType: string,
  containedResourceType: string,
  containedResource: Record<string, unknown>,
): ValidationIssue {
  const originalPath = issue.path || '';
  const path = originalPath === containedResourceType
    ? prefix
    : originalPath.startsWith(`${containedResourceType}.`)
      ? `${prefix}.${originalPath.slice(containedResourceType.length + 1)}`
      : originalPath ? `${prefix}.${originalPath}` : prefix;
  const existingDetails = issue.details && typeof issue.details === 'object' ? issue.details : {};
  const rewritten: ValidationIssue = {
    ...issue,
    path,
    resourceType: parentResourceType,
    details: {
      ...existingDetails,
      containedResourceType,
      ...(typeof containedResource.id === 'string' ? { containedResourceId: containedResource.id } : {}),
      originalPath,
    },
  };
  if (issue.expression) {
    rewritten.expression = issue.expression === containedResourceType
      ? prefix
      : issue.expression.startsWith(`${containedResourceType}.`)
        ? `${prefix}.${issue.expression.slice(containedResourceType.length + 1)}`
        : `${prefix}.${issue.expression}`;
  }
  rewritten.id = computeValidationIssueId(rewritten);
  return rewritten;
}

function isResolvedContainedReferenceIssue(
  issue: ValidationIssue,
  containingResource: Record<string, unknown>,
): boolean {
  if (issue.code !== 'reference-contained-unresolved' && issue.code !== 'reference-ref1-invariant') return false;
  const containedId = issue.details && typeof issue.details === 'object'
    ? issue.details.containedId
    : undefined;
  const containedResources = Array.isArray(containingResource.contained) ? containingResource.contained : [];
  return typeof containedId === 'string' && containedResources.some(
    candidate => !!candidate && typeof candidate === 'object'
      && (candidate as Record<string, unknown>).id === containedId,
  );
}
