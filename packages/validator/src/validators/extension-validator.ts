/**
 * Extension Validator
 *
 * Validates FHIR extensions against their StructureDefinitions:
 * - Extension URL validation
 * - Extension cardinality (min/max)
 * - Extension value type validation
 * - Required extension checking
 * - Nested extension validation (modifierExtension)
 * - Complex extensions with sub-extensions, including **deep sub-extension
 *   definition lookup** via the parent extension's profile
 */

import type { ValidationIssue } from '../types';
import { createValidationIssue } from '../issues';
import type { StructureDefinition } from '../core/structure-definition-types';
import { StructureDefinitionLoader } from '../core/structure-definition-loader';
import { logger } from '../logger';
import { TypeValidator } from './type-validator';
import { ValueSetValidator } from './valueset-validator';
import { ElementRulesValidator } from './element-rules-validator';
import { checkExtensionPathCardinality } from './extension-cardinality-rules';
import {
  extractExtensionDefinitions,
  normalizeExtensionUrlForMatching,
} from './extension-definition-extractor';
import { getExtensionGroupsByParent } from './extension-group-resolver';
import {
  getSubExtensionDefinitions,
  validateAgainstExtensionProfile,
} from './extension-profile-validation';
import {
  validateExtensionStructure,
  validateExtensionValueType,
} from './extension-structure-rules';
import type { ExtensionDefinition, ExtensionValidationContext } from './extension-types';
import { validateUniversalExtensionRules } from './extension-universal-rules';

export type { ExtensionDefinition, ExtensionValidationContext } from './extension-types';

// ============================================================================
// Extension Validator
// ============================================================================

export class ExtensionValidator {
  private extensionProfileCache: Map<string, StructureDefinition | null> = new Map();
  /**
   * Cache of sub-extension definitions keyed by parent extension profile URL.
   * Sub-extension definitions are parsed from `Extension.extension:sliceName`
   * elements inside the parent extension's profile snapshot and drive
   * cardinality/value-type checks on nested extensions.
   *
   * Without this cache each nested extension in a complex profile would
   * re-parse the parent profile on every validation.
   */
  private subExtensionDefinitionsCache: Map<string, Map<string, ExtensionDefinition>> = new Map();
  /**
   * URL-resolvability cache: `true` means an Extension SD was found for this
   * URL (via sdLoader), `false` means it was not. Cached per validator
   * instance so repeated resource validations don't re-fetch the same URLs.
   */
  private urlResolvabilityCache: Map<string, boolean> = new Map();
  /**
   * Maximum depth for nested extension traversal. FHIR does not prescribe a
   * hard limit but real profiles rarely go beyond 3 levels; anything deeper
   * usually indicates a cycle or runaway data.
   */
  private readonly maxNestedExtensionDepth = 5;

  constructor(
    private readonly sdLoader: StructureDefinitionLoader,
    private readonly typeValidator: TypeValidator,
    private readonly valueSetValidator: ValueSetValidator,
    private readonly elementRulesValidator: ElementRulesValidator
  ) { }

  /**
   * Validate all extensions in a resource against profile definition.
   *
   * Two complementary passes run here:
   *
   * 1. **Resource walk** — every `extension` / `modifierExtension` array
   *    physically present in the resource is visited. Each instance is
   *    checked for the universal rules that apply regardless of profile:
   *    URL present, URL absolute, URL resolvable to a StructureDefinition,
   *    and the ext-1 "either value[x] or nested extensions" invariant.
   *    This is what Java does and is what surfaces the
   *    "The extension X could not be found" error for unknown URLs.
   *
   * 2. **Profile walk** — the profile's extension slice definitions are
   *    consulted to enforce per-slice cardinality and profile-scoped
   *    value-type / nested-slice constraints. Extensions that happen to
   *    match a definition also get the richer validation.
   */
  async validateExtensions(
    resource: any,
    profileSD: StructureDefinition,
    context: ExtensionValidationContext
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      const definitionContext = extractExtensionDefinitions(profileSD);
      const knownUrls = new Set<string>(definitionContext.byUrl.keys());
      const visited = new Set<string>();

      // Pass 1: walk every extension / modifierExtension occurrence in the
      // resource and validate the universal rules. Tracks visited paths so
      // Pass 2 doesn't re-emit the same ext-1 / url / resolvability issues.
      await this.walkResourceExtensions(
        resource,
        resource?.resourceType || 'Resource',
        context,
        knownUrls,
        visited,
        issues
      );

      // Pass 2: profile-driven cardinality + value/slice checks for slices
      // that are declared in the profile.
      for (const [elementPath, definitionsByUrl] of definitionContext.byPath.entries()) {
        const parentExtGroups = getExtensionGroupsByParent(resource, elementPath, context.getValueAtPath);

        for (const extensions of parentExtGroups) {
          const counts = new Map<string, number>();

          for (const extension of extensions) {
            const url = extension?.url;
            const normalizedUrl = typeof url === 'string'
              ? normalizeExtensionUrlForMatching(url)
              : undefined;
            const extensionType = elementPath.endsWith('modifierExtension')
              ? 'modifierExtension'
              : 'extension';

            const definition = normalizedUrl
              ? definitionsByUrl.get(normalizedUrl) ?? definitionContext.byUrl.get(normalizedUrl)
              : undefined;

            const extIssues = await this.validateExtensionInstance(
              extension,
              definition,
              extensionType,
              elementPath,
              context,
              0,
              /* skipUniversalChecks */ true
            );
            issues.push(...extIssues);

            if (url) {
              const countKey = normalizeExtensionUrlForMatching(url);
              counts.set(countKey, (counts.get(countKey) || 0) + 1);
            }
          }

          issues.push(
            ...checkExtensionPathCardinality(
              elementPath,
              definitionsByUrl,
              counts,
              context.profileUrl,
              context.resource?.resourceType || 'Unknown',
            )
          );
        }
      }

    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('[ExtensionValidator] Error validating extensions:', error);
      issues.push(createValidationIssue({
        code: 'profile-extension-validation-error',
        path: 'extension',
        resourceType: resource?.resourceType || 'Unknown',
        customMessage: `Extension validation failed: ${err.message}`,
      }));
    }

    return issues;
  }

  /**
   * Depth-first walk over every `extension` / `modifierExtension` array in
   * the resource. For each extension instance, emit the universal checks:
   * URL presence, URL absoluteness, URL resolvability, and ext-1.
   *
   * `visited` records the emitted path so the profile-driven Pass 2 can
   * skip re-checking the same instance. Traversal bottoms out when we hit
   * a non-object, a primitive, or the recursion depth cap.
   */
  private async walkResourceExtensions(
    value: any,
    basePath: string,
    context: ExtensionValidationContext,
    knownUrls: Set<string>,
    visited: Set<string>,
    issues: ValidationIssue[],
    depth = 0
  ): Promise<void> {
    if (value == null || typeof value !== 'object') return;
    if (depth > 20) return; // pathological nesting guard

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        await this.walkResourceExtensions(
          value[i], `${basePath}[${i}]`, context, knownUrls, visited, issues, depth + 1
        );
      }
      return;
    }

    for (const key of Object.keys(value)) {
      // Skip primitives' `_value` sidecar; underscore-prefixed keys carry
      // primitive extensions which are a separate concern.
      if (key === 'resourceType') continue;

      const child = value[key];
      const isExtensionArray = (key === 'extension' || key === 'modifierExtension') && Array.isArray(child);

      if (isExtensionArray) {
        for (let i = 0; i < child.length; i++) {
          const ext = child[i];
          const extPath = `${basePath}.${key}[${i}]`;
          visited.add(extPath);

          const issuesFromInstance = await validateUniversalExtensionRules({
            extension: ext,
            extensionType: key === 'modifierExtension' ? 'modifierExtension' : 'extension',
            path: extPath,
            knownUrls,
            context,
            visited,
            depth: depth + 1,
            maxNestedExtensionDepth: this.maxNestedExtensionDepth,
            isExtensionUrlResolvable: this.isExtensionUrlResolvable.bind(this),
          });
          issues.push(...issuesFromInstance);
        }
        continue;
      }

      // Recurse into non-extension children so we also catch
      // `Resource.foo.extension[…]`, `Resource.foo.bar[].extension[…]`, etc.
      await this.walkResourceExtensions(
        child, `${basePath}.${key}`, context, knownUrls, visited, issues, depth + 1
      );
    }
  }

  /**
   * Check whether an extension URL resolves to a loadable StructureDefinition.
   * Results are cached per-validator to avoid hitting the SD loader (and
   * its DB cache / auto-download) for the same URL repeatedly.
   */
  private async isExtensionUrlResolvable(
    url: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<boolean> {
    const cached = this.urlResolvabilityCache.get(url);
    if (cached !== undefined) return cached;

    let resolvable = false;
    try {
      const sd = await this.sdLoader.loadProfile(url, fhirVersion);
      resolvable = !!sd;
    } catch {
      resolvable = false;
    }

    // Cross-version fallback: core HL7 FHIR extension SDs (e.g.
    // structuredefinition-standards-status) ship in R4 core but not in the
    // R5 core package. When validating R5 resources that use these
    // well-known extensions, try the R4 loader as a fallback so we don't
    // emit false-positive "could not be found" errors.
    if (!resolvable && fhirVersion !== 'R4'
      && url.startsWith('http://hl7.org/fhir/StructureDefinition/')) {
      try {
        const sd = await this.sdLoader.loadProfile(url, 'R4');
        resolvable = !!sd;
      } catch {
        // R4 fallback also failed — genuinely unresolvable
      }
    }

    this.urlResolvabilityCache.set(url, resolvable);
    return resolvable;
  }

  /**
   * Validate a single extension instance.
   *
   * The optional `depth` argument guards against runaway recursion on
   * pathological input (e.g. an extension array that mutates to reference
   * itself). Each level of nesting increments the counter; once we exceed
   * `maxNestedExtensionDepth` the method returns early with a dedicated
   * diagnostic so callers can see why traversal stopped.
   */
  // eslint-disable-next-line max-lines-per-function
  private async validateExtensionInstance(
    extension: any,
    extDef: ExtensionDefinition | undefined,
    extensionType: 'extension' | 'modifierExtension',
    elementPath: string,
    context: ExtensionValidationContext,
    depth = 0,
    /**
     * When true, the caller has already run the universal (URL / ext-1)
     * checks via `walkResourceExtensions`, so we only run the
     * profile-scoped validations here.
     */
    skipUniversalChecks = false
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const resourceType = context.resource?.resourceType || 'Unknown';

    const extensionPath = `${elementPath}[url='${extension?.url ?? 'unknown'}']`;

    // Check URL is present
    if (!extension.url) {
      if (!skipUniversalChecks) {
        issues.push(createValidationIssue({
          code: 'profile-extension-url-missing',
          path: elementPath,
          resourceType,
          messageParams: { extensionType },
        }));
      }
      return issues;
    }

    // Check if extension is allowed by profile
    if (!extDef && context.strictMode) {
      issues.push(createValidationIssue({
        code: 'profile-extension-not-in-profile',
        path: extensionPath,
        resourceType,
        messageParams: { url: extension.url, profileUrl: context.profileSD.url },
      }));
    }

    // Always validate fundamental extension structure (applies to all extensions)
    if (!skipUniversalChecks) {
      const structureIssues = validateExtensionStructure(extension, extensionType, extensionPath, resourceType);
      issues.push(...structureIssues);
    }

    // Validate extension value type if definition exists
    if (extDef) {
      // Check modifier extension flag
      if (extensionType === 'modifierExtension' && !extDef.isModifier) {
        issues.push(createValidationIssue({
          code: 'profile-extension-modifier-mismatch',
          path: extensionPath,
          resourceType,
          messageParams: { url: extension.url },
        }));
      }

      // Validate value type declarations on the element definition (if any).
      // When typeCodes is just ['Extension'], it means "this element holds an
      // Extension" — not a constraint on value[x] types. The actual value type
      // constraint lives in the extension's own SD and is checked by
      // validateAgainstExtensionProfile below.
      const valueTypeCodes = extDef.typeCodes?.filter(t => t !== 'Extension') ?? [];
      if (valueTypeCodes.length > 0) {
        const valueIssues = validateExtensionValueType(
          extension,
          valueTypeCodes,
          extensionPath,
          resourceType,
        );
        issues.push(...valueIssues);
      }

      // If the extension references an Extension profile, validate against it
      if (extDef.profileUrl) {
        const profileIssues = await validateAgainstExtensionProfile({
          extension,
          profileUrl: extDef.profileUrl,
          path: extensionPath,
          context,
          sdLoader: this.sdLoader,
          typeValidator: this.typeValidator,
          valueSetValidator: this.valueSetValidator,
          elementRulesValidator: this.elementRulesValidator,
          profileCache: this.extensionProfileCache,
        });
        issues.push(...profileIssues);
      }
    }

    // Validate nested extensions
    if (extension.extension && Array.isArray(extension.extension)) {
      if (depth >= this.maxNestedExtensionDepth) {
        issues.push(createValidationIssue({
          code: 'profile-extension-max-depth',
          path: extensionPath,
          resourceType,
          messageParams: {
            url: extension.url,
            maxDepth: this.maxNestedExtensionDepth,
          },
        }));
        return issues;
      }

      // Resolve sub-extension definitions from the parent extension's
      // profile (if any). This is what enables true deep validation:
      // without it, nested extensions were traversed but not checked
      // against their own cardinality / value type rules.
      const subDefinitions = extDef?.profileUrl
        ? await getSubExtensionDefinitions(
          extDef.profileUrl,
          context.fhirVersion,
          this.sdLoader,
          this.subExtensionDefinitionsCache,
        )
        : new Map<string, ExtensionDefinition>();

      // Track counts for cardinality enforcement per sub-extension URL
      const nestedCounts = new Map<string, number>();

      for (const nestedExt of extension.extension) {
        const nestedUrl: string | undefined = nestedExt?.url;
        const normalizedNestedUrl = typeof nestedUrl === 'string'
          ? normalizeExtensionUrlForMatching(nestedUrl)
          : undefined;
        const nestedDef = normalizedNestedUrl ? subDefinitions.get(normalizedNestedUrl) : undefined;

        if (nestedUrl) {
          const countKey = normalizeExtensionUrlForMatching(nestedUrl);
          nestedCounts.set(countKey, (nestedCounts.get(countKey) ?? 0) + 1);
        }

        const nestedIssues = await this.validateExtensionInstance(
          nestedExt,
          nestedDef,
          'extension',
          `${extensionPath}.extension`,
          context,
          depth + 1
        );
        issues.push(...nestedIssues);
      }

      // Enforce min/max cardinality on the sub-extension slices.
      if (subDefinitions.size > 0) {
        issues.push(
          ...checkExtensionPathCardinality(
            `${extensionPath}.extension`,
            subDefinitions,
            nestedCounts,
            extDef?.profileUrl ?? context.profileUrl,
            resourceType,
          )
        );
      }
    }

    return issues;
  }

}
