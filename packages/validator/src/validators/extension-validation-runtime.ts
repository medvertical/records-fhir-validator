import { BoundedLruCache } from '../cache/bounded-lru-cache.js';
import { resourceTypeOf } from '../core/fhir-resource.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateAgainstExtensionProfile } from './extension-profile-validation.js';
import {
  extractExtensionDefinitions,
} from './extension-definition-extractor.js';
import {
  type ExtensionInstanceValidationDependencies,
  validateExtensionInstance,
  validateOwnSubExtensions,
} from './extension-instance-validation.js';
import { validateProfileScopedExtensionInstances } from './extension-profile-scope-validation.js';
import { walkResourceExtensions, type ExtensionResourceWalkOptions } from './extension-resource-walk.js';
import { loadEmbeddedExtensionResourceScope, type EmbeddedExtensionResourceScope } from './extension-embedded-resource-scope.js';
import type { ExtensionDefinition, ExtensionValidationContext } from './extension-types.js';
import { ExtensionLogicalPathCache } from './extension-logical-paths.js';
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
  private readonly logicalPaths: ExtensionLogicalPathCache;

  constructor(dependencies: ExtensionValidationRuntimeDependencies) {
    this.urlResolver = new ExtensionUrlResolver(dependencies.sdLoader);
    this.logicalPaths = new ExtensionLogicalPathCache(dependencies.sdLoader);
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
        this.resourceWalkOptions({ context, knownUrls, profiles: [profileSD], incomplete: false }, issues),
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

  private resourceWalkOptions(
    scope: Pick<EmbeddedExtensionResourceScope, 'context' | 'knownUrls' | 'profiles' | 'incomplete'>,
    issues: ValidationIssue[],
  ): ExtensionResourceWalkOptions {
    const sources = scope.profiles.length ? scope.profiles : scope.incomplete ? [] : [undefined];
    const owners = new Map<string, StructureDefinition | undefined>();
    return {
      maxNestedExtensionDepth: MAX_NESTED_EXTENSION_DEPTH,
      resolveResourceScope: async (resource, path) => {
        const embedded = await loadEmbeddedExtensionResourceScope(resource, path, scope.context, this.instanceValidationDependencies.sdLoader);
        issues.push(...embedded.issues);
        return { context: embedded.context, knownUrls: embedded.knownUrls,
          options: this.resourceWalkOptions(embedded, issues) };
      },
      resolveExtensionUrl: async (url, family) => {
        let undetermined = scope.incomplete;
        for (const source of sources) {
          const resolution = await this.urlResolver.resolveKnown(url, family, source);
          if (resolution === 'resolvable') { owners.set(url, source); return resolution; }
          undetermined ||= resolution === 'undetermined';
        }
        return undetermined ? 'undetermined' : 'unresolvable';
      },
      getDeclaredContexts: async (url, family) => {
        if (owners.has(url)) return this.urlResolver.getDeclaredContexts(url, family, owners.get(url));
        for (const source of sources) {
          if (await this.urlResolver.resolveKnown(url, family, source) !== 'resolvable') continue;
          owners.set(url, source);
          return this.urlResolver.getDeclaredContexts(url, family, source);
        }
        return null;
      },
      resolveLogicalPaths: site => this.logicalPaths.resolve(site, scope.context.fhirVersion),
      validateAgainstDefinition: async (extension, url, path) => {
        if (!sources.length) return [];
        const context = owners.has(url) ? { ...scope.context, profileSD: owners.get(url) ?? scope.context.profileSD } : scope.context;
        return [
          ...await validateAgainstExtensionProfile({ extension, profileUrl: url, path, context,
            sdLoader: this.instanceValidationDependencies.sdLoader,
            typeValidator: this.instanceValidationDependencies.typeValidator,
            valueSetValidator: this.instanceValidationDependencies.valueSetValidator,
            elementRulesValidator: this.instanceValidationDependencies.elementRulesValidator,
            profileCache: this.instanceValidationDependencies.extensionProfileCache,
            sdFHIRPathExecutor: this.instanceValidationDependencies.sdFHIRPathExecutor,
          }),
          ...await validateOwnSubExtensions(this.instanceValidationDependencies, extension, url, path, context),
        ];
      },
    };
  }
}
