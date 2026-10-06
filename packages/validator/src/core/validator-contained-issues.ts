import type { ValidationIssue } from '@records-fhir/validation-types';
import type { FhirResourceRecord } from '../reference/bundle-reference-types.js';
import { getDeclaredProfiles } from './declared-profile-utils.js';
import { awaitAllDrained } from '../utils/await-all-drained.js';

export function rebaseContainedIssue(
  issue: ValidationIssue,
  parentResourceType: string,
  containedResource: FhirResourceRecord,
  containedIndex: number,
): ValidationIssue {
  const containedResourceType = containedResource.resourceType as string;
  const originalPath = issue.path || '';
  const containedPrefix = `${parentResourceType}.contained[${containedIndex}]`;
  const rebasedPath = originalPath === containedResourceType
    ? containedPrefix
    : originalPath.startsWith(`${containedResourceType}.`)
      ? `${containedPrefix}.${originalPath.slice(containedResourceType.length + 1)}`
      : originalPath ? `${containedPrefix}.${originalPath}` : containedPrefix;
  const existingDetails = issue.details && typeof issue.details === 'object' ? issue.details : {};

  return {
    ...issue,
    path: rebasedPath,
    resourceType: parentResourceType,
    details: {
      ...existingDetails,
      containedResourceType,
      ...(containedResource.id ? { containedResourceId: containedResource.id } : {}),
      originalPath,
    },
  };
}

/**
 * dom-6 asks the resource validated for narrative; the reference validator
 * exempts a contained one (`(%rootResource != $this) or text.div.exists()`).
 */
export function isContainedNarrativeAdvice(issue: ValidationIssue): boolean {
  return issue.code === 'dom-6';
}

export function isResolvedContainedReferenceIssue(
  issue: ValidationIssue,
  containingResource: unknown,
): boolean {
  const details = issue.details && typeof issue.details === 'object' ? issue.details : undefined;
  // A contained resource names its siblings with #id; only the container
  // lists them.
  const containedId = issue.code === 'contained-unresolved-canonical'
    ? String(details?.reference ?? '').replace(/^#/, '')
    : issue.code === 'reference-contained-unresolved' || issue.code === 'reference-ref1-invariant'
      ? details?.containedId
      : undefined;
  if (typeof containedId !== 'string' || !containedId || !isRecord(containingResource)) return false;
  return Array.isArray(containingResource.contained) &&
    containingResource.contained.some(candidate =>
      isRecord(candidate) && candidate.id === containedId
    );
}

interface ContainedValidationOptions {
  recursionDepth: number;
  maxDepth: number;
  validate(
    resource: FhirResourceRecord,
    profileUrl: string,
    recursionDepth: number,
  ): Promise<ValidationIssue[]>;
}

export async function validateContainedResourceTree(
  resource: unknown,
  options: ContainedValidationOptions,
): Promise<ValidationIssue[]> {
  if (
    !isRecord(resource) ||
    !Array.isArray(resource.contained) ||
    options.recursionDepth >= options.maxDepth
  ) {
    return [];
  }

  const parentResourceType = typeof resource.resourceType === 'string'
    ? resource.resourceType
    : 'Resource';
  const nested = await awaitAllDrained(resource.contained.map(async (candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.resourceType !== 'string') return [];

    const declared = getDeclaredProfiles(candidate);
    const profiles = declared.length ? declared : [`http://hl7.org/fhir/StructureDefinition/${candidate.resourceType}`];
    const issues: ValidationIssue[] = [];
    for (const profile of profiles) {
      issues.push(...await options.validate(candidate, profile, options.recursionDepth + 1));
    }
    return issues
      .filter(issue =>
        issue.aspect !== 'metadata' &&
        !isContainedNarrativeAdvice(issue) &&
        !isResolvedContainedReferenceIssue(issue, resource)
      )
      .map(issue => rebaseContainedIssue(issue, parentResourceType, candidate, index));
  }));

  return nested.flat();
}

function isRecord(value: unknown): value is FhirResourceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
