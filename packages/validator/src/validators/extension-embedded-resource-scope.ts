import type { ValidationIssue } from '@records-fhir/validation-types';
import { getDeclaredProfiles } from '../core/declared-profile-utils.js';
import { ProfileReferenceUnavailableError, profileReferenceUnavailableIssue } from '../core/profile-reference-authority.js';
import { profileMatchesCanonical } from '../core/sd-loader-profile-identity.js';
import { profileResourceTypeApplicability } from '../core/profile-resource-type.js';
import type { StructureDefinition, StructureDefinitionLoader } from '../core/structure-definition-loader.js';
import { extractExtensionDefinitions } from './extension-definition-extractor.js';
import { filterDefinitionContextForFhirVersion } from './extension-version-filter.js';
import type { ExtensionValidationContext } from './extension-types.js';

export interface EmbeddedExtensionResourceScope {
  context: ExtensionValidationContext;
  knownUrls: Set<string>;
  profiles: StructureDefinition[];
  incomplete: boolean;
  issues: ValidationIssue[];
}

/** An instance's declared profiles never inherit the container's package authority. */
export async function loadEmbeddedExtensionResourceScope(
  resource: Record<string, unknown> & { resourceType: string },
  path: string,
  parent: ExtensionValidationContext,
  loader: Pick<StructureDefinitionLoader, 'loadProfile'>,
): Promise<EmbeddedExtensionResourceScope> {
  const profiles: StructureDefinition[] = [];
  const issues: ValidationIssue[] = [];
  const knownUrls = new Set<string>();
  for (const canonical of new Set(getDeclaredProfiles(resource))) {
    try {
      const profile = await loader.loadProfile(canonical, parent.fhirVersion);
      if (!profile || profile.kind !== 'resource' || profile.abstract !== false
        || !profileMatchesCanonical(profile, canonical, parent.fhirVersion)
        || profileResourceTypeApplicability(profile, resource.resourceType, parent.fhirVersion) !== true) {
        throw new ProfileReferenceUnavailableError({ canonical, cause: 'embedded-resource-profile-unverified' });
      }
      profiles.push(profile);
      const definitions = filterDefinitionContextForFhirVersion(extractExtensionDefinitions(profile), parent.fhirVersion);
      for (const url of definitions.byUrl.keys()) knownUrls.add(url);
    } catch (error: unknown) {
      issues.push(profileReferenceUnavailableIssue(error instanceof ProfileReferenceUnavailableError ? error
        : new ProfileReferenceUnavailableError({ canonical, cause: 'embedded-resource-profile-load-error' }), `${path}.meta.profile`));
    }
  }
  const primary = profiles[0] ?? unprofiledResourceDefinition(resource.resourceType);
  return { profiles, knownUrls, issues, incomplete: issues.length > 0,
    context: { ...parent, resource, rootResource: parent.rootResource ?? parent.resource, profileSD: primary, profileUrl: primary.url } };
}

export function unprofiledResourceDefinition(resourceType: string): StructureDefinition {
  return { resourceType: 'StructureDefinition', url: `http://hl7.org/fhir/StructureDefinition/${resourceType}`,
    name: resourceType, type: resourceType, status: 'active', kind: 'resource', abstract: false };
}
