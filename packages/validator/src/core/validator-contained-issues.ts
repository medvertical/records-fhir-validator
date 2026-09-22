import type { ValidationIssue } from '@records-fhir/validation-types';
import type { FhirResourceRecord } from '../reference/bundle-reference-types.js';
import { getPrimaryDeclaredProfile } from './declared-profile-utils.js';
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

export function isResolvedContainedReferenceIssue(
  issue: ValidationIssue,
  containingResource: unknown,
): boolean {
  if (issue.code !== 'reference-contained-unresolved' && issue.code !== 'reference-ref1-invariant') return false;
  const containedId = issue.details && typeof issue.details === 'object'
    ? issue.details.containedId
    : undefined;
  if (typeof containedId !== 'string' || !isRecord(containingResource)) return false;
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

    const profileUrl = getPrimaryDeclaredProfile(candidate)
      ?? `http://hl7.org/fhir/StructureDefinition/${candidate.resourceType}`;
    const issues = await options.validate(candidate, profileUrl, options.recursionDepth + 1);
    return issues
      .filter(issue =>
        issue.aspect !== 'metadata' &&
        !isResolvedContainedReferenceIssue(issue, resource)
      )
      .map(issue => rebaseContainedIssue(issue, parentResourceType, candidate, index));
  }));

  return nested.flat();
}

function isRecord(value: unknown): value is FhirResourceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
