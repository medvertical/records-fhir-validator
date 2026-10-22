import { ProfileReferenceUnavailableError, profileReferenceUnavailableIssue } from '../core/profile-reference-authority.js';
import type { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { isRecord, resourceTypeOf } from '../core/fhir-resource.js';
import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { checkExtensionPathCardinality } from './extension-cardinality-rules.js';
import {
  definitionReferencingProfile,
  normalizeExtensionUrlForMatching,
} from './extension-definition-extractor.js';
import {
  type ExtensionInstanceRuleDependencies,
  validateExtensionInstanceRules,
} from './extension-instance-rule-validation.js';
import { getSubExtensionDefinitions } from './extension-subdefinition-loader.js';
import { undefinedSubExtensionIssues } from './extension-subextension-url-rule.js';
import type { ExtensionDefinition, ExtensionValidationContext } from './extension-types.js';
import type { ProfileReferenceSource } from '../core/structure-definition-loader.js';
import { filterDefinitionsForFhirVersion } from './extension-version-filter.js';

export interface ExtensionInstanceValidationDependencies extends ExtensionInstanceRuleDependencies {
  maxNestedExtensionDepth: number;
  subExtensionDefinitionsCache: BoundedLruCache<string, Map<string, ExtensionDefinition>>;
}

interface ExtensionInstanceValidationInput {
  context: ExtensionValidationContext;
  definition: ExtensionDefinition | undefined;
  depth?: number;
  elementPath: string;
  extensionType: 'extension' | 'modifierExtension';
  extensionValue: unknown;
  skipUniversalChecks?: boolean;
}

export async function validateExtensionInstance(
  dependencies: ExtensionInstanceValidationDependencies,
  input: ExtensionInstanceValidationInput,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const resourceType = resourceTypeOf(input.context.resource, 'Unknown');
  const extension = isRecord(input.extensionValue) ? input.extensionValue : null;
  const url = typeof extension?.url === 'string' ? extension.url : undefined;
  const extensionPath = `${input.elementPath}[url='${url ?? 'unknown'}']`;
  if (!extension || !url) {
    if (!input.skipUniversalChecks) {
      issues.push(createValidationIssue({
        code: 'profile-extension-url-missing',
        path: input.elementPath,
        resourceType,
        messageParams: { extensionType: input.extensionType },
      }));
    }
    return issues;
  }
  issues.push(...await validateExtensionInstanceRules(
    dependencies,
    {
      context: input.context,
      definition: input.definition,
      extension,
      extensionPath,
      extensionType: input.extensionType,
      skipUniversalChecks: input.skipUniversalChecks ?? false,
      url,
    },
  ));
  issues.push(...await validateNestedExtensions(
    dependencies,
    extension,
    input.definition,
    extensionPath,
    input.context,
    input.depth ?? 0,
    input.skipUniversalChecks ?? false,
  ));
  return issues;
}

/**
 * Holds an extension the resource's profile does not slice to its own
 * definition below the top level, as the reference validator does whatever
 * profile the resource declares: each sub-extension against the slice of its
 * url, value type included, and the slices' cardinality. The universal rules
 * the resource walk already applied are not repeated.
 */
export function validateOwnSubExtensions(
  dependencies: ExtensionInstanceValidationDependencies,
  extension: Record<string, unknown>,
  profileUrl: string,
  extensionPath: string,
  context: ExtensionValidationContext,
  referencingProfile: ProfileReferenceSource | null = context.profileSD,
): Promise<ValidationIssue[]> {
  const definition: ExtensionDefinition = { url: profileUrl, path: 'Extension', min: 0, max: '*', profileUrl };
  return validateNestedExtensions(dependencies, extension, definition, extensionPath, context, 0, true, referencingProfile);
}

async function validateNestedExtensions(
  dependencies: ExtensionInstanceValidationDependencies,
  extension: Record<string, unknown>,
  definition: ExtensionDefinition | undefined,
  extensionPath: string,
  context: ExtensionValidationContext,
  depth: number,
  skipUniversalChecks = false,
  referencingProfile?: ProfileReferenceSource | null,
): Promise<ValidationIssue[]> {
  if (extension.extension !== undefined && !Array.isArray(extension.extension)) return [];
  const nestedExtensions = Array.isArray(extension.extension) ? extension.extension : [];
  const resourceType = resourceTypeOf(context.resource, 'Unknown');
  if (nestedExtensions.length > 0 && depth >= dependencies.maxNestedExtensionDepth) {
    return [createValidationIssue({
      code: 'profile-extension-max-depth',
      path: extensionPath,
      resourceType,
      messageParams: {
        url: extension.url,
        maxDepth: dependencies.maxNestedExtensionDepth,
      },
    })];
  }
  const issues: ValidationIssue[] = [];
  let definitions: Map<string, ExtensionDefinition> | undefined;
  try {
  definitions = definition?.profileUrl
    ? await getSubExtensionDefinitions(
      definition.profileUrl,
      context.fhirVersion,
      dependencies.sdLoader,
      dependencies.subExtensionDefinitionsCache,
      referencingProfile === undefined ? definitionReferencingProfile(definition, context.profileSD) : referencingProfile,
    )
    : undefined;
  } catch (error: unknown) {
    if (!(error instanceof ProfileReferenceUnavailableError)) throw error;
    issues.push(profileReferenceUnavailableIssue(error, extensionPath));
  }
  const compatible = filterDefinitionsForFhirVersion(
    definitions ?? new Map<string, ExtensionDefinition>(),
    context.fhirVersion,
  );
  const nestedCounts = new Map<string, number>();
  for (const nestedValue of nestedExtensions) {
    const nested = isRecord(nestedValue) ? nestedValue : null;
    const nestedUrl = typeof nested?.url === 'string' ? nested.url : undefined;
    const normalizedUrl = nestedUrl
      ? normalizeExtensionUrlForMatching(nestedUrl)
      : undefined;
    if (normalizedUrl) {
      nestedCounts.set(normalizedUrl, (nestedCounts.get(normalizedUrl) ?? 0) + 1);
    }
    issues.push(...await validateExtensionInstance(dependencies, {
      context,
      definition: normalizedUrl ? compatible.get(normalizedUrl) : undefined,
      depth: depth + 1,
      elementPath: `${extensionPath}.extension`,
      extensionType: 'extension',
      extensionValue: nestedValue,
      skipUniversalChecks,
    }));
  }
  if (definition?.profileUrl && definitions) {
    issues.push(...undefinedSubExtensionIssues(
      extension,
      new Set(compatible.keys()),
      definition.profileUrl,
      extensionPath,
      resourceType,
    ));
  }
  if (compatible.size > 0) {
    issues.push(...checkExtensionPathCardinality(
      `${extensionPath}.extension`,
      compatible,
      nestedCounts,
      definition?.profileUrl ?? context.profileUrl,
      resourceType,
    ));
  }
  return issues;
}
