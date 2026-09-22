import type { ValidationIssue } from '@records-fhir/validation-types';
import type { FhirResourceRecord } from '../reference/bundle-reference-types.js';
import { getPrimaryDeclaredProfile } from './declared-profile-utils.js';
import { awaitAllDrained } from '../utils/await-all-drained.js';

export interface ParametersEmbeddedResource {
  resource: FhirResourceRecord;
  /** Instance path of the embedded resource, e.g. "Parameters.parameter[0].resource". */
  pathPrefix: string;
  profileUrl: string;
}

/**
 * Parameters carries whole resources in parameter[].resource (and nested
 * part[].resource). The Parameters snapshot walk deliberately skips
 * "Parameters.parameter…resource." internals, so — like Bundle entries and
 * contained resources — each embedded resource must be validated as its own
 * resource tree or its primitives get no validation at all.
 */
export function collectParametersEmbeddedResources(
  resource: unknown,
): ParametersEmbeddedResource[] {
  if (
    !isRecord(resource)
    || resource.resourceType !== 'Parameters'
    || !Array.isArray(resource.parameter)
  ) {
    return [];
  }
  const collected: ParametersEmbeddedResource[] = [];
  collectFromParameterList(resource.parameter, 'Parameters.parameter', collected);
  return collected;
}

function collectFromParameterList(
  parameters: unknown[],
  pathPrefix: string,
  collected: ParametersEmbeddedResource[],
): void {
  parameters.forEach((parameter, index) => {
    if (!isRecord(parameter)) return;
    const embedded = parameter.resource;
    if (isRecord(embedded) && typeof embedded.resourceType === 'string') {
      collected.push({
        resource: embedded,
        pathPrefix: `${pathPrefix}[${index}].resource`,
        profileUrl: getPrimaryDeclaredProfile(embedded)
          ?? `http://hl7.org/fhir/StructureDefinition/${embedded.resourceType}`,
      });
    }
    if (Array.isArray(parameter.part)) {
      collectFromParameterList(parameter.part, `${pathPrefix}[${index}].part`, collected);
    }
  });
}

export function rebaseParametersEmbeddedIssue(
  issue: ValidationIssue,
  pathPrefix: string,
  embeddedResource: FhirResourceRecord,
): ValidationIssue {
  const embeddedResourceType = embeddedResource.resourceType as string;
  const originalPath = issue.path || '';
  const rebasedPath = originalPath === embeddedResourceType
    ? pathPrefix
    : originalPath.startsWith(`${embeddedResourceType}.`)
      ? `${pathPrefix}.${originalPath.slice(embeddedResourceType.length + 1)}`
      : originalPath ? `${pathPrefix}.${originalPath}` : pathPrefix;
  const existingDetails = issue.details && typeof issue.details === 'object' ? issue.details : {};

  return {
    ...issue,
    path: rebasedPath,
    resourceType: 'Parameters',
    details: {
      ...existingDetails,
      embeddedResourceType,
      ...(typeof embeddedResource.id === 'string' ? { embeddedResourceId: embeddedResource.id } : {}),
      originalPath,
    },
  };
}

interface ParametersValidationOptions {
  recursionDepth: number;
  maxDepth: number;
  validate(
    resource: FhirResourceRecord,
    profileUrl: string,
    recursionDepth: number,
  ): Promise<ValidationIssue[]>;
}

export async function validateParametersResourceTree(
  resource: unknown,
  options: ParametersValidationOptions,
): Promise<ValidationIssue[]> {
  if (options.recursionDepth >= options.maxDepth) return [];
  const embeddedResources = collectParametersEmbeddedResources(resource);
  if (embeddedResources.length === 0) return [];

  const nested = await awaitAllDrained(embeddedResources.map(async embedded => {
    const issues = await options.validate(
      embedded.resource,
      embedded.profileUrl,
      options.recursionDepth + 1,
    );
    // Metadata expectations (missing-meta etc.) apply to the exchanged
    // Parameters envelope, not to each embedded payload resource.
    return issues
      .filter(issue => issue.aspect !== 'metadata')
      .map(issue => rebaseParametersEmbeddedIssue(issue, embedded.pathPrefix, embedded.resource));
  }));

  return nested.flat();
}

function isRecord(value: unknown): value is FhirResourceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
