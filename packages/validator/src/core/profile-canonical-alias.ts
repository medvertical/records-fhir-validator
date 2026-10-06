import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { normalizeKnownStructureDefinitionCanonicalUrl } from './sd-loader-version-utils.js';
import type { StructureDefinition } from './structure-definition-types.js';

/**
 * A misspelt canonical that Records resolves through a known alias (US Core's
 * `us-core-Coverage`) is validated against the profile it means, but no
 * published profile carries that url, so any other consumer fails to find it.
 */
export function profileCanonicalAliasIssue(
  resource: unknown,
  resourceType: string,
  profileUrl: string,
  structureDef: StructureDefinition,
): ValidationIssue | null {
  const declaredCanonical = profileUrl.split('|')[0];
  if (!structureDef.url || declaredCanonical === structureDef.url) return null;
  if (normalizeKnownStructureDefinitionCanonicalUrl(declaredCanonical) !== structureDef.url) return null;
  const index = declaredProfiles(resource).indexOf(profileUrl);
  return createValidationIssue({
    code: 'profile-canonical-alias',
    path: `${resourceType}.meta.profile${index >= 0 ? `[${index}]` : ''}`,
    resourceType,
    profile: profileUrl,
    customMessage:
      `Profile reference '${profileUrl}' does not match a published canonical; validated against ${structureDef.url}`,
    details: { profile: profileUrl, resolvedProfile: structureDef.url },
  });
}

function declaredProfiles(resource: unknown): unknown[] {
  if (typeof resource !== 'object' || resource === null) return [];
  const meta = (resource as { meta?: unknown }).meta;
  const profiles = typeof meta === 'object' && meta !== null ? (meta as { profile?: unknown }).profile : undefined;
  return Array.isArray(profiles) ? profiles : [];
}
