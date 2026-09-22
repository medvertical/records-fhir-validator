import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { resourceTypeOf } from '../core/fhir-resource.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import {
  extractExtensionDefinitions,
} from './extension-definition-extractor.js';
import {
  type ExtensionInstanceValidationDependencies,
  validateExtensionInstance,
} from './extension-instance-validation.js';
import { validateProfileScopedExtensionInstances } from './extension-profile-scope-validation.js';
import { walkResourceExtensions } from './extension-resource-walk.js';
import type { ExtensionDefinition, ExtensionValidationContext } from './extension-types.js';
import { ExtensionUrlResolver } from './extension-url-resolver.js';
import {
  filterDefinitionContextForFhirVersion,
} from './extension-version-filter.js';

const MAX_NESTED_EXTENSION_DEPTH = 5;
const EXTENSION_PROFILE_CACHE_SIZE = 512;
const SUB_EXTENSION_DEFINITIONS_CACHE_SIZE = 512;

export type ExtensionValidationRuntimeDependencies = Pick<
  ExtensionInstanceValidationDependencies,
  | 'elementRulesValidator'
  | 'sdFHIRPathExecutor'
  | 'sdLoader'
  | 'typeValidator'
  | 'valueSetValidator'
>;

export type ExtensionValidationRunResult =
  | { status: 'completed'; issues: ValidationIssue[] }
  | { status: 'failed'; issues: ValidationIssue[]; error: unknown };

/** Owns the caches and two-pass pipeline for one long-lived validator. */
export class ExtensionValidationRuntime {
  private readonly instanceValidationDependencies: ExtensionInstanceValidationDependencies;
  private readonly urlResolver: ExtensionUrlResolver;

  constructor(dependencies: ExtensionValidationRuntimeDependencies) {
    this.urlResolver = new ExtensionUrlResolver(dependencies.sdLoader);
    this.instanceValidationDependencies = {
      ...dependencies,
      extensionProfileCache: new BoundedLruCache<string, StructureDefinition>(
        EXTENSION_PROFILE_CACHE_SIZE,
      ),
      maxNestedExtensionDepth: MAX_NESTED_EXTENSION_DEPTH,
      subExtensionDefinitionsCache: new BoundedLruCache<string, Map<string, ExtensionDefinition>>(
        SUB_EXTENSION_DEFINITIONS_CACHE_SIZE,
      ),
    };
  }

  async validate(
    resource: unknown,
    profileSD: StructureDefinition,
    context: ExtensionValidationContext,
  ): Promise<ExtensionValidationRunResult> {
    const issues: ValidationIssue[] = [];

    try {
      const definitionContext = filterDefinitionContextForFhirVersion(
        extractExtensionDefinitions(profileSD),
        context.fhirVersion,
      );
      const knownUrls = new Set<string>(definitionContext.byUrl.keys());
      const visited = new Set<string>();

      // Pass 1 validates universal rules and tracks paths to prevent duplicates.
      await walkResourceExtensions(
        resource,
        resourceTypeOf(resource, 'Resource'),
        context,
        knownUrls,
        visited,
        issues,
        {
          maxNestedExtensionDepth: MAX_NESTED_EXTENSION_DEPTH,
          resolveExtensionUrl: this.urlResolver.resolveKnown.bind(this.urlResolver),
          getDeclaredContexts: this.urlResolver.getDeclaredContexts.bind(this.urlResolver),
        },
      );

      issues.push(...await validateProfileScopedExtensionInstances({
        resource,
        definitionContext,
        context,
        validateInstance: (extension, definition, extensionType, elementPath) =>
          validateExtensionInstance(this.instanceValidationDependencies, {
            extensionValue: extension,
            definition,
            extensionType,
            elementPath,
            context,
            skipUniversalChecks: true,
          }),
      }));
      return { status: 'completed', issues };
    } catch (error: unknown) {
      return { status: 'failed', issues, error };
    }
  }
}
