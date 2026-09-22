/**
 * FHIR-version filtering for extension definitions.
 *
 * Pure helpers extracted from ExtensionValidator: they drop extension
 * definitions whose canonical/profile URL belongs to a different FHIR version
 * than the one being validated, so cross-version core extensions don't leak
 * into the wrong validation pass.
 */

import { urlMatchesRequestedFhirVersion, type FhirVersionFamily } from '../core/sd-loader-version-utils.js';
import { logger } from '../logger.js';
import type { ExtensionDefinition } from './extension-types.js';
import type { extractExtensionDefinitions } from './extension-definition-extractor.js';
import { profileCanonicalMetadata } from '../utils/sensitive-logging-metadata.js';

type ExtensionDefinitionContext = ReturnType<typeof extractExtensionDefinitions>;

export function filterDefinitionContextForFhirVersion(
  definitionContext: ExtensionDefinitionContext,
  fhirVersion: FhirVersionFamily,
): ExtensionDefinitionContext {
  const byUrl = filterDefinitionsForFhirVersion(definitionContext.byUrl, fhirVersion);
  const byPath = new Map<string, Map<string, ExtensionDefinition[]>>();

  for (const [path, definitions] of definitionContext.byPath.entries()) {
    const filtered = filterDefinitionListsForFhirVersion(definitions, fhirVersion);
    if (filtered.size > 0) {
      byPath.set(path, filtered);
    }
  }

  return { byUrl, byPath, elements: definitionContext.elements };
}

export function filterDefinitionsForFhirVersion(
  definitions: Map<string, ExtensionDefinition>,
  fhirVersion: FhirVersionFamily,
): Map<string, ExtensionDefinition> {
  const filtered = new Map<string, ExtensionDefinition>();

  for (const [url, definition] of definitions.entries()) {
    if (!isExtensionDefinitionCompatible(definition, fhirVersion)) {
      logger.debug('[ExtensionValidator] Skipping FHIR-version-incompatible extension definition', {
        ...profileCanonicalMetadata(definition.profileUrl ?? definition.url),
        fhirVersion,
      });
      continue;
    }
    filtered.set(url, definition);
  }

  return filtered;
}

function filterDefinitionListsForFhirVersion(
  definitions: Map<string, ExtensionDefinition[]>,
  fhirVersion: FhirVersionFamily,
): Map<string, ExtensionDefinition[]> {
  const filtered = new Map<string, ExtensionDefinition[]>();

  for (const [url, list] of definitions.entries()) {
    const compatible = list.filter(definition => {
      if (isExtensionDefinitionCompatible(definition, fhirVersion)) return true;
      logger.debug('[ExtensionValidator] Skipping FHIR-version-incompatible extension definition', {
        ...profileCanonicalMetadata(definition.profileUrl ?? definition.url),
        fhirVersion,
      });
      return false;
    });
    if (compatible.length > 0) filtered.set(url, compatible);
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
