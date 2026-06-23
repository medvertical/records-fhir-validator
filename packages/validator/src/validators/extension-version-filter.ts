/**
 * FHIR-version filtering for extension definitions.
 *
 * Pure helpers extracted from ExtensionValidator: they drop extension
 * definitions whose canonical/profile URL belongs to a different FHIR version
 * than the one being validated, so cross-version core extensions don't leak
 * into the wrong validation pass.
 */

import { urlMatchesRequestedFhirVersion, type FhirVersionFamily } from '../core/sd-loader-version-utils';
import { logger } from '../logger';
import type { ExtensionDefinition } from './extension-types';
import type { extractExtensionDefinitions } from './extension-definition-extractor';

type ExtensionDefinitionContext = ReturnType<typeof extractExtensionDefinitions>;

export function filterDefinitionContextForFhirVersion(
  definitionContext: ExtensionDefinitionContext,
  fhirVersion: FhirVersionFamily,
): ExtensionDefinitionContext {
  const byUrl = filterDefinitionsForFhirVersion(definitionContext.byUrl, fhirVersion);
  const byPath = new Map<string, Map<string, ExtensionDefinition>>();

  for (const [path, definitions] of definitionContext.byPath.entries()) {
    const filtered = filterDefinitionsForFhirVersion(definitions, fhirVersion);
    if (filtered.size > 0) {
      byPath.set(path, filtered);
    }
  }

  return { byUrl, byPath };
}

export function filterDefinitionsForFhirVersion(
  definitions: Map<string, ExtensionDefinition>,
  fhirVersion: FhirVersionFamily,
): Map<string, ExtensionDefinition> {
  const filtered = new Map<string, ExtensionDefinition>();

  for (const [url, definition] of definitions.entries()) {
    if (!isExtensionDefinitionCompatible(definition, fhirVersion)) {
      logger.debug(`[ExtensionValidator] Skipping FHIR-version-incompatible extension definition: ${definition.profileUrl ?? definition.url} (${fhirVersion})`);
      continue;
    }
    filtered.set(url, definition);
  }

  return filtered;
}

function isExtensionDefinitionCompatible(
  definition: ExtensionDefinition,
  fhirVersion: FhirVersionFamily,
): boolean {
  return [definition.url, definition.profileUrl]
    .filter((url): url is string => typeof url === 'string' && url.length > 0)
    .every(url => urlMatchesRequestedFhirVersion(url, fhirVersion));
}
