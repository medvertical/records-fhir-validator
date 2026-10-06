/**
 * The CapabilityStatement check the HL7 reference validator makes against
 * definitions: a search parameter that names its SearchParameter declares
 * that parameter's type. A definition no local package holds decides
 * nothing, as it decides nothing there.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { resolveValueSetPackageDirectories } from './valueset-package-resource-access.js';
import { findResourceInPackages } from './valueset-package-search.js';

type FhirRecord = Record<string, unknown>;
type SearchParameterDefinition = FhirRecord & { url?: string; version?: string };
export type SearchParameterLookup = (canonical: string) => Promise<SearchParameterDefinition | null>;

/** The id names a file, so it must be a FHIR id and nothing that leaves the package. */
const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

export async function validateCapabilityStatementSearchParams(
  statement: FhirRecord,
  fhirVersion: 'R4' | 'R5' | 'R6',
  lookup: SearchParameterLookup = packagedSearchParameter(fhirVersion),
): Promise<ValidationIssue[]> {
  if (statement.resourceType !== 'CapabilityStatement') return [];
  const definitions = new Map<string, Promise<SearchParameterDefinition | null>>();
  const issues: ValidationIssue[] = [];
  for (const [restIndex, rest] of records(statement.rest).entries()) {
    for (const [resourceIndex, resource] of records(rest.resource).entries()) {
      for (const [index, searchParam] of records(resource.searchParam).entries()) {
        const { definition, type } = searchParam;
        if (typeof definition !== 'string' || definition.length === 0) continue;
        if (!definitions.has(definition)) definitions.set(definition, lookup(definition).catch(() => null));
        const parameter = await definitions.get(definition);
        if (!parameter || typeof parameter.type !== 'string' || parameter.type === type) continue;
        const versionedUrl = parameter.version ? `${parameter.url}|${parameter.version}` : String(parameter.url);
        issues.push(createValidationIssue({
          code: 'capabilitystatement-searchparam-type-mismatch',
          path: `CapabilityStatement.rest[${restIndex}].resource[${resourceIndex}].searchParam[${index}]`,
          resourceType: 'CapabilityStatement',
          customMessage: `Type mismatch - SearchParameter '${versionedUrl}' type is ${parameter.type}, `
            + `but type here is ${typeof type === 'string' ? type : 'missing'}`,
          severityOverride: 'error',
          details: { definition, expectedType: parameter.type, ...(typeof type === 'string' ? { actualType: type } : {}) },
        }));
      }
    }
  }
  return issues;
}

/** Packages name a SearchParameter's file after its id, as the core specification does. */
function packagedSearchParameter(fhirVersion: 'R4' | 'R5' | 'R6'): SearchParameterLookup {
  const directories = resolveValueSetPackageDirectories();
  return async canonical => {
    const [url, version] = canonical.split('|');
    const id = url.slice(url.lastIndexOf('/') + 1);
    if (!FHIR_ID.test(id)) return null;
    return findResourceInPackages<SearchParameterDefinition>(
      directories, url, [`SearchParameter-${id}.json`], fhirVersion.slice(1), version || undefined,
    );
  };
}

function records(value: unknown): FhirRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is FhirRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
