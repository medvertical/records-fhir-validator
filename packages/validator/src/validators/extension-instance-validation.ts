import type { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { isRecord, resourceTypeOf } from '../core/fhir-resource.js';
import { createValidationIssue } from '../issues/index.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { checkExtensionPathCardinality } from './extension-cardinality-rules.js';
import { normalizeExtensionUrlForMatching } from './extension-definition-extractor.js';
import {
  type ExtensionInstanceRuleDependencies,
  validateExtensionInstanceRules,
} from './extension-instance-rule-validation.js';
import { getSubExtensionDefinitions } from './extension-subdefinition-loader.js';
import type { ExtensionDefinition, ExtensionValidationContext } from './extension-types.js';
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
  ));
  return issues;
}

async function validateNestedExtensions(
  dependencies: ExtensionInstanceValidationDependencies,
  extension: Record<string, unknown>,
  definition: ExtensionDefinition | undefined,
  extensionPath: string,
  context: ExtensionValidationContext,
  depth: number,
): Promise<ValidationIssue[]> {
  if (!Array.isArray(extension.extension)) return [];
  const resourceType = resourceTypeOf(context.resource, 'Unknown');
  if (depth >= dependencies.maxNestedExtensionDepth) {
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
  const definitions = definition?.profileUrl
    ? await getSubExtensionDefinitions(
      definition.profileUrl,
      context.fhirVersion,
      dependencies.sdLoader,
      dependencies.subExtensionDefinitionsCache,
    )
    : new Map<string, ExtensionDefinition>();
  const compatible = filterDefinitionsForFhirVersion(definitions, context.fhirVersion);
  const nestedCounts = new Map<string, number>();
  const issues: ValidationIssue[] = [];
  for (const nestedValue of extension.extension) {
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
    }));
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
