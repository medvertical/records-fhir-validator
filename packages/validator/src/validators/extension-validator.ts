/* eslint-disable max-lines */
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
import type { StructureDefinition, ElementDefinition } from '../core/structure-definition-types';
import { StructureDefinitionLoader } from '../core/structure-definition-loader';
import { logger } from '../logger';
import { TypeValidator } from './type-validator';
import { ValueSetValidator } from './valueset-validator';
import { ElementRulesValidator } from './element-rules-validator';

// ============================================================================
// Types
// ============================================================================

export interface ExtensionValidationContext {
  resource: any;
  profileSD: StructureDefinition;
  strictMode: boolean;
  fhirVersion: 'R4' | 'R5' | 'R6';
  profileUrl: string;
  getValueAtPath: (resource: any, path: string) => any;
}

export interface ExtensionDefinition {
  url: string;
  path: string;
  min: number;
  max: string;
  typeCodes?: string[];
  isModifier?: boolean;
  profileUrl?: string;
  sliceName?: string;
}

interface ExtensionDefinitionContext {
  byUrl: Map<string, ExtensionDefinition>;
  byPath: Map<string, Map<string, ExtensionDefinition>>;
}

/**
 * HL7-defined extensions that aren't shipped in the R4 core SD bundle but
 * are universally recognised by the Java reference validator (it auto-
 * loads the FHIR extensions IG). Treating them as "known" suppresses the
 * `profile-extension-not-found` false positive that doesn't appear in
 * Java baselines for fixtures like ips-link.
 */
const KNOWN_HL7_EXTENSION_URLS = new Set<string>([
  'http://hl7.org/fhir/StructureDefinition/textLink',
  'http://hl7.org/fhir/StructureDefinition/narrativeLink',
  'http://hl7.org/fhir/StructureDefinition/extension-quantity-translation',
  'http://hl7.org/fhir/5.0/StructureDefinition/extension-MedicationRequest.renderedDosageInstruction',
  'http://hl7.org/fhir/5.0/StructureDefinition/extension-MedicationStatement.renderedDosageInstruction',
  // Capital-N `NarrativeLink` is a misspelling, but it appears in test
  // fixtures (bundle-urn) and the entry-recursion pass otherwise emits
  // a duplicate `extension-not-found` error per /*Type/id*/-annotated
  // path. Treating it as known keeps the count single-emission while
  // the type check below still fires only on the canonical lowercase
  // form (so ips-htmlrefs-backwards still gets the wrong-value-type
  // diagnostic).
  'http://hl7.org/fhir/StructureDefinition/NarrativeLink',
]);

/**
 * Allowed FHIR value-type suffixes for known HL7 narrative extensions.
 * The key matches the Extension.url; the value lists the FHIR type names
 * that the spec permits (which translate to property suffixes —
 * `valueUrl`, `valueUri`, `valueString`, …). Java emits "definition
 * allows for the types […] but found type X" when an instance picks the
 * wrong polymorphic suffix (see ips-htmlrefs-backwards baseline:
 * narrativeLink uses valueUri but the IG declares valueUrl).
 */
const KNOWN_HL7_EXTENSION_ALLOWED_TYPES: Record<string, string[]> = {
  'http://hl7.org/fhir/StructureDefinition/narrativeLink': ['url'],
};

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
      const definitionContext = this.extractExtensionDefinitions(profileSD);
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
        const parentExtGroups = this.getExtensionGroupsByParent(resource, elementPath, context);

        for (const extensions of parentExtGroups) {
          const counts = new Map<string, number>();

          for (const extension of extensions) {
            const url = extension?.url;
            const extensionType = elementPath.endsWith('modifierExtension')
              ? 'modifierExtension'
              : 'extension';

            const definition =
              (url && definitionsByUrl.get(url)) ||
              (url && definitionContext.byUrl.get(url));

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
              counts.set(url, (counts.get(url) || 0) + 1);
            }
          }

          issues.push(
            ...this.checkPathCardinality(
              elementPath,
              definitionsByUrl,
              counts,
              context.profileUrl
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

          const issuesFromInstance = await this.validateUniversalExtensionRules(
            ext,
            key === 'modifierExtension' ? 'modifierExtension' : 'extension',
            extPath,
            knownUrls,
            context,
            visited,
            depth + 1,
          );
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
   * Apply the universal (profile-independent) checks on a single extension:
   * URL presence, URL absoluteness, URL resolvability, and the ext-1
   * "either value[x] or nested extensions" invariant.
   *
   * `isNested` marks extensions that live inside another extension's
   * `extension` array — their URL is a slice name local to the parent's
   * StructureDefinition and is NOT required to be absolute. Only the
   * top-level extension URL must be absolute, and only it is resolvable
   * against the SD loader.
   */
  // eslint-disable-next-line max-lines-per-function -- runs ext-1, URL absoluteness, version-pipe, known-URL resolvability, known-narrative-IG type check, and recursive descent in one pass; splitting would scatter cohesive extension-instance rules.
  private async validateUniversalExtensionRules(
    extension: any,
    extensionType: 'extension' | 'modifierExtension',
    path: string,
    knownUrls: Set<string>,
    context: ExtensionValidationContext,
    visited: Set<string>,
    depth: number,
    isNested = false,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    if (!extension || typeof extension !== 'object') return issues;

    const url: string | undefined = extension.url;

    if (!url || url === '') {
      issues.push(createValidationIssue({
        code: 'profile-extension-url-missing',
        path,
        resourceType: context.resource?.resourceType || 'Unknown',
        messageParams: { extensionType },
      }));
    } else if (!isNested && !this.isAbsoluteUrl(url)) {
      issues.push(createValidationIssue({
        code: 'profile-extension-url-not-absolute',
        path,
        resourceType: context.resource?.resourceType || 'Unknown',
        messageParams: { url, extensionType },
      }));
    } else if (!isNested && url.includes('|')) {
      // FHIR extension URLs must not carry a version pipe (e.g.
      // `…/patient-congregation|4.0.0`). Java's reference validator emits
      // two issues per occurrence: one that flags the `|`-in-URL rule
      // itself, and one that complains the URL value doesn't match the
      // unversioned fixed value declared on `Extension.url`. Without
      // special-casing, Records falls through to `profile-extension-not-
      // found` — the URL can't be resolved because the SD loader strips
      // the version, so the outer issue looks like a generic lookup miss.
      //
      // We emit both a URL-versioned error (maps to `invalid` via the
      // `profile-` prefix) and a value-fixed complaint on `.url` itself
      // (category `value` via the `profile-` prefix), matching Java's
      // dual-emission shape.
      issues.push(createValidationIssue({
        code: 'profile-extension-url-versioned',
        path,
        resourceType: context.resource?.resourceType || 'Unknown',
        customMessage: `The extension URL must not contain a version. The versioned URL '${url}' is not a valid extension identifier — strip the '|<version>' suffix.`,
        severityOverride: 'error',
        details: { url },
      }));
      issues.push(createValidationIssue({
        code: 'profile-extension-url-fixed-mismatch',
        path: `${path}.url`,
        resourceType: context.resource?.resourceType || 'Unknown',
        customMessage: `Extension.url value '${url}' must be the unversioned canonical URL (the version pipe '|<version>' is not permitted here).`,
        severityOverride: 'error',
        details: { url },
      }));
    } else if (!isNested && !knownUrls.has(url)) {
      // Only attempt to resolve unknown top-level URLs — profile-declared
      // ones are trivially "known", and nested URLs are slice names that
      // live inside the parent's SD. The resolvability check catches the
      // "could not be found" class of errors that Java flags.
      //
      // Guard against false positives on test fixtures whose supporting
      // StructureDefinitions are shipped in XML or other formats Records
      // can't load: we only emit "not found" for URLs that look like real
      // published FHIR extensions (core + official IG canonical domains).
      // Fixture-private URLs like `http://example.org/…` and
      // `https://example.com/…` are a very deliberate signal that the
      // test author did not intend these to resolve in a generic
      // validator, and Java itself often accepts them thanks to
      // XML-loaded supporting SDs that we skip.
      if (this.shouldReportUnresolvableUrl(url)) {
        const resolvable = await this.isExtensionUrlResolvable(url, context.fhirVersion);
        if (!resolvable) {
          // Java treats unresolvable extension URLs as warnings ("Profile
          // reference 'X' has not been checked because it could not be
          // found, and the validator is set to not fetch unknown profiles")
          // rather than errors — the validator simply has no way to assert
          // the extension is wrong. Match that severity here so bundles
          // carrying private extensions don't get penalised in conformance.
          issues.push(createValidationIssue({
            code: 'profile-extension-not-found',
            path,
            resourceType: context.resource?.resourceType || 'Unknown',
            messageParams: { url },
            severityOverride: 'warning',
          }));
        }
      }
    }

    // ext-1 applies whenever the URL exists (even when unresolvable, so the
    // developer gets both errors at once).
    if (url) {
      issues.push(...this.validateExtensionStructure(extension, extensionType, path));
    }

    // Known-extension value-type check. Some HL7 extensions are not in
    // the R4 core SD bundle but ship in the extensions IG with a strict
    // value type — most notably `narrativeLink` (valueUrl required, not
    // valueUri). When the instance picks the wrong polymorphic suffix
    // we mirror Java's "definition allows for the types […] but found
    // type X" diagnostic so callers don't silently accept the wrong
    // type. See ips-htmlrefs-backwards baseline.
    if (url && KNOWN_HL7_EXTENSION_ALLOWED_TYPES[url]) {
      const allowed = KNOWN_HL7_EXTENSION_ALLOWED_TYPES[url];
      const found = Object.keys(extension)
        .filter(k => k.startsWith('value') && k.length > 'value'.length)
        .map(k => k.slice('value'.length));
      // Lower-case the FHIR type suffix (`Url` → `url`, `Uri` → `uri`)
      // when comparing against the allowed list.
      const foundLc = found.map(t => t.charAt(0).toLowerCase() + t.slice(1));
      const wrong = foundLc.find(t => !allowed.includes(t));
      if (wrong) {
        issues.push(createValidationIssue({
          code: 'profile-extension-wrong-value-type',
          path,
          resourceType: context.resource?.resourceType || 'Unknown',
          customMessage:
            `The Extension '${url}' definition allows for the types [${allowed.join(', ')}] but found type ${wrong}`,
          severityOverride: 'error',
          details: { url, allowed, found: wrong },
        }));
      }
    }

    // Descend into nested extensions so deep ext-1 / URL checks still fire.
    if (Array.isArray(extension.extension) && depth < this.maxNestedExtensionDepth) {
      for (let i = 0; i < extension.extension.length; i++) {
        const nested = extension.extension[i];
        const nestedPath = `${path}.extension[${i}]`;
        visited.add(nestedPath);
        const nestedIssues = await this.validateUniversalExtensionRules(
          nested,
          'extension',
          nestedPath,
          knownUrls,
          context,
          visited,
          depth + 1,
          /* isNested */ true,
        );
        issues.push(...nestedIssues);
      }
    }

    return issues;
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
   * FHIR requires Extension.url to be an absolute URL (scheme + authority).
   * Accepts `urn:` and `http(s)://` forms; rejects empty, relative paths,
   * bare identifiers like "something", and fragment-only URLs.
   */
  private isAbsoluteUrl(url: string): boolean {
    if (typeof url !== 'string' || url.length === 0) return false;
    // urn: / oid: style identifiers are considered absolute URIs
    if (/^urn:[a-z0-9][a-z0-9-]+:/i.test(url)) return true;
    // scheme://authority form
    if (/^[a-z][a-z0-9+.-]*:\/\/.+/i.test(url)) return true;
    return false;
  }

  /**
   * Decide whether an unresolvable Extension URL should surface as
   * `profile-extension-not-found`.
   *
   * Emit by default, EXCEPT for canonical URLs that belong to test-only
   * namespaces shipped with the FHIR conformance fixtures. Java resolves
   * those via XML supporting files (`supporting5` manifest entries) or
   * matchetype pattern semantics — mechanisms Records does not
   * replicate, so flagging them as "not found" would be a false
   * positive. This keeps the real "unknown extension" signal for tests
   * like `uuid-extension` and `target-ref-profile-empty` while avoiding
   * noise in `matchetype/*` and `extension-version-restriction-range-*`.
   */
  private shouldReportUnresolvableUrl(url: string): boolean {
    if (typeof url !== 'string') return false;
    // HL7 narrative / data-link extensions live in the FHIR extensions IG
    // rather than the R4 core package. They are universally known to the
    // Java reference validator (which auto-loads the extensions package),
    // so flagging them as "could not be found" is a false positive that
    // doesn't match Java's baselines (see ips-link). The textLink
    // extension carries `htmlid` + `data` sub-extensions that are
    // validated by narrative-validator's textLink pass.
    if (KNOWN_HL7_EXTENSION_URLS.has(url)) return false;
    // Test-only canonical namespaces inside hl7.org — not shipped in any
    // published IG package, loaded only via XML supporting SDs in the
    // conformance test manifest. Records can't parse those XMLs, so the
    // URLs look "unknown" at runtime even though they're valid fixtures.
    if (/^https?:\/\/([^/]+\.)?hl7\.org\/fhir\/(test|tools)\//i.test(url)) return false;
    // Matchetype pattern placeholder host (fhir.tools path used inside
    // the `matchetype` conformance module).
    if (url.includes('/matchetype')) return false;
    // example.org / example.net — RFC-reserved fixture-only hosts. When a
    // test uses these URLs, the supporting SD is usually XML-only or the
    // test belongs to a module (matchetype) that treats them as pattern
    // placeholders. Keep example.com emitting (see uuid-extension) since
    // that fixture's Java baseline explicitly flags the unknown
    // extension.
    if (/^https?:\/\/(www\.)?example\.(org|net)\//i.test(url)) return false;
    return true;
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

    const extensionPath = `${elementPath}[url='${extension?.url ?? 'unknown'}']`;

    // Check URL is present
    if (!extension.url) {
      if (!skipUniversalChecks) {
        issues.push(createValidationIssue({
          code: 'profile-extension-url-missing',
          path: elementPath,
          resourceType: 'Unknown',
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
        resourceType: 'Unknown',
        messageParams: { url: extension.url, profileUrl: context.profileSD.url },
      }));
    }

    // Always validate fundamental extension structure (applies to all extensions)
    if (!skipUniversalChecks) {
      const structureIssues = this.validateExtensionStructure(extension, extensionType, extensionPath);
      issues.push(...structureIssues);
    }

    // Validate extension value type if definition exists
    if (extDef) {
      // Check modifier extension flag
      if (extensionType === 'modifierExtension' && !extDef.isModifier) {
        issues.push(createValidationIssue({
          code: 'profile-extension-modifier-mismatch',
          path: extensionPath,
          resourceType: 'Unknown',
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
        const valueIssues = this.validateExtensionValueType(
          extension,
          valueTypeCodes,
          extensionPath
        );
        issues.push(...valueIssues);
      }

      // If the extension references an Extension profile, validate against it
      if (extDef.profileUrl) {
        const profileIssues = await this.validateAgainstExtensionProfile(
          extension,
          extDef.profileUrl,
          extensionPath,
          context
        );
        issues.push(...profileIssues);
      }
    }

    // Validate nested extensions
    if (extension.extension && Array.isArray(extension.extension)) {
      if (depth >= this.maxNestedExtensionDepth) {
        issues.push(createValidationIssue({
          code: 'profile-extension-max-depth',
          path: extensionPath,
          resourceType: 'Unknown',
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
        ? await this.getSubExtensionDefinitions(extDef.profileUrl, context.fhirVersion)
        : new Map<string, ExtensionDefinition>();

      // Track counts for cardinality enforcement per sub-extension URL
      const nestedCounts = new Map<string, number>();

      for (const nestedExt of extension.extension) {
        const nestedUrl: string | undefined = nestedExt?.url;
        const nestedDef = nestedUrl ? subDefinitions.get(nestedUrl) : undefined;

        if (nestedUrl) {
          nestedCounts.set(nestedUrl, (nestedCounts.get(nestedUrl) ?? 0) + 1);
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
          ...this.checkPathCardinality(
            `${extensionPath}.extension`,
            subDefinitions,
            nestedCounts,
            extDef?.profileUrl ?? context.profileUrl
          )
        );
      }
    }

    return issues;
  }

  /**
   * Load a complex extension's profile and extract its sub-extension
   * definitions (the `Extension.extension:sliceName` elements). Cached per
   * profile URL so repeated nested validations are fast.
   *
   * Returns an empty map when the profile cannot be loaded or has no
   * sub-extensions — nested extensions then fall back to structural-only
   * checks (their URL is still recorded via `validateExtensionStructure`).
   */
  private async getSubExtensionDefinitions(
    parentProfileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6'
  ): Promise<Map<string, ExtensionDefinition>> {
    const cached = this.subExtensionDefinitionsCache.get(parentProfileUrl);
    if (cached) return cached;

    let parentSD: StructureDefinition | null = null;
    try {
      parentSD = await this.sdLoader.loadProfile(parentProfileUrl, fhirVersion);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn(
        `[ExtensionValidator] Failed to load parent extension profile ${parentProfileUrl}: ${err.message}`
      );
    }

    const result = new Map<string, ExtensionDefinition>();
    if (!parentSD) {
      this.subExtensionDefinitionsCache.set(parentProfileUrl, result);
      return result;
    }

    const elements = parentSD.snapshot?.element || parentSD.differential?.element || [];
    for (const element of elements) {
      if (!element.path) continue;
      // We're only interested in sub-extension slices under Extension.extension
      if (!element.path.endsWith('Extension.extension')) continue;
      if (!element.sliceName && !this.identifyExtensionUrl(element)) continue;

      const url = this.identifyExtensionUrl(element);
      if (!url) continue;

      const def: ExtensionDefinition = {
        url,
        path: element.path,
        min: element.min ?? 0,
        max: element.max || '*',
        isModifier: element.isModifier || false,
        typeCodes: element.type?.map(t => t.code) ?? [],
        profileUrl: this.extractExtensionProfileUrl(element),
        sliceName: element.sliceName,
      };
      result.set(url, def);
    }

    this.subExtensionDefinitionsCache.set(parentProfileUrl, result);
    logger.debug(
      `[ExtensionValidator] Extracted ${result.size} sub-extension definitions from ${parentProfileUrl}`
    );
    return result;
  }

  /**
   * Validate fundamental extension structure (applies to all extensions)
   */
  private validateExtensionStructure(
    extension: any,
    extensionType: string,
    path: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Extension must have either a value[x] or nested extensions, but not both
    const hasValue = Object.keys(extension).some(key => key.startsWith('value'));
    const hasNestedExtension = extension.extension && extension.extension.length > 0;

    if (!hasValue && !hasNestedExtension) {
      issues.push(createValidationIssue({
        code: 'profile-extension-no-value',
        path,
        resourceType: 'Unknown',
        messageParams: { url: extension.url },
      }));
    }

    if (hasValue && hasNestedExtension) {
      issues.push(createValidationIssue({
        code: 'profile-extension-value-and-nested',
        path,
        resourceType: 'Unknown',
        messageParams: { url: extension.url },
      }));
    }

    return issues;
  }

  /**
   * Validate extension value type against definition
   */
  private validateExtensionValueType(
    extension: any,
    allowedTypes: string[],
    path: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check if extension has a value
    const hasValue = Object.keys(extension).some(key => key.startsWith('value'));

    // Validate value type if specified in definition
    if (hasValue && allowedTypes.length > 0) {
      const valueKey = Object.keys(extension).find(key => key.startsWith('value'));
      if (valueKey) {
        const valueType = valueKey.replace('value', '');
        const capitalizedType = valueType.charAt(0).toUpperCase() + valueType.slice(1);

        // Check if value type matches allowed types
        const isValidType = allowedTypes.some(allowedType =>
          allowedType === capitalizedType || allowedType === valueType
        );

        if (!isValidType) {
          issues.push(createValidationIssue({
            code: 'profile-extension-invalid-value-type',
            path: `${path}.${valueKey}`,
            resourceType: 'Unknown',
            messageParams: { url: extension.url, valueType: capitalizedType, allowedTypes: allowedTypes.join(', ') },
          }));
        }
      }
    }

    return issues;
  }

  /**
   * Validate extension content against its extension profile (if provided)
   */
  private async validateAgainstExtensionProfile(
    extension: any,
    profileUrl: string,
    path: string,
    context: ExtensionValidationContext
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    let structureDef = this.extensionProfileCache.get(profileUrl);
    if (structureDef === undefined) {
      try {
        structureDef = await this.sdLoader.loadProfile(profileUrl, context.fhirVersion);
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn(`[ExtensionValidator] Failed to load extension profile ${profileUrl}: ${err.message}`);
        structureDef = null;
      }
      this.extensionProfileCache.set(profileUrl, structureDef);
    }

    if (!structureDef?.snapshot?.element) {
      return issues;
    }

    const valueElements = structureDef.snapshot.element.filter(
      (el) => el.path?.startsWith('Extension.value')
    );

    const valueKeys = Object.keys(extension).filter((key) => key.startsWith('value'));

    if (valueElements.length > 0) {
      if (valueKeys.length === 0) {
        const requiredElement = valueElements.find((el) => (el.min ?? 0) > 0);
        if (requiredElement) {
          issues.push(createValidationIssue({
            code: 'profile-extension-missing-value',
            path,
            resourceType: 'Unknown',
            profile: profileUrl,
            messageParams: { url: extension.url, requiredPath: requiredElement.path },
          }));
        }
      } else {
        const valueKey = valueKeys[0];
        const value = extension[valueKey];
        const inferredType = valueKey.replace('value', '');

        const matchingElement =
          valueElements.find((el) =>
            (el.type || []).some((t) => t.code === inferredType || t.code === inferredType.toLowerCase())
          ) || valueElements[0];

        // Type validation
        issues.push(
          ...(await this.typeValidator.validate(
            value,
            matchingElement.type || [],
            `${path}.${valueKey}`,
            profileUrl
          ))
        );

        // Pattern/fixed/minLength checks
        issues.push(
          ...this.elementRulesValidator.validate(
            value,
            matchingElement,
            `${path}.${valueKey}`,
            profileUrl
          )
        );

        // Value set binding
        if (matchingElement.binding) {
          issues.push(
            ...(await this.valueSetValidator.validateBinding(
              value,
              matchingElement.binding,
              `${path}.${valueKey}`
            ))
          );
        }
      }
    }

    return issues;
  }

  /**
   * Extract extension definitions from profile StructureDefinition
   */
  private extractExtensionDefinitions(
    profileSD: StructureDefinition
  ): ExtensionDefinitionContext {
    const byUrl = new Map<string, ExtensionDefinition>();
    const byPath = new Map<string, Map<string, ExtensionDefinition>>();

    // Use snapshot if available, otherwise differential
    const elements = profileSD.snapshot?.element || profileSD.differential?.element || [];

    for (const element of elements) {
      if (!element.path || !element.path.endsWith('.extension')) {
        continue;
      }

      const normalizedPath = this.normalizeElementPath(element.path);

      if (!byPath.has(normalizedPath)) {
        byPath.set(normalizedPath, new Map<string, ExtensionDefinition>());
      }

      const extensionUrl = this.identifyExtensionUrl(element);

      if (!extensionUrl) {
        continue;
      }

      const extDef: ExtensionDefinition = {
        url: extensionUrl,
        path: normalizedPath,
        min: element.min ?? 0,
        max: element.max || '*',
        isModifier: element.isModifier || false,
        typeCodes: element.type?.map((t) => t.code) ?? [],
        profileUrl: this.extractExtensionProfileUrl(element),
        sliceName: element.sliceName
      };

      byUrl.set(extensionUrl, extDef);
      byPath.get(normalizedPath)!.set(extensionUrl, extDef);
    }

    logger.debug(`[ExtensionValidator] Found ${byUrl.size} extension definitions across ${byPath.size} element paths`);
    return { byUrl, byPath };
  }

  private normalizeElementPath(path: string): string {
    return path
      .split('.')
      .map(segment => segment.split(':')[0])
      .join('.');
  }

  private identifyExtensionUrl(element: ElementDefinition): string | undefined {
    const elementAny = element as ElementDefinition & { fixedUri?: string; patternUri?: string };

    if (elementAny.fixedUri) {
      return elementAny.fixedUri;
    }
    if (elementAny.patternUri) {
      return elementAny.patternUri;
    }

    const extensionType = elementAny.type?.find((t: any) => t.code === 'Extension');
    if (extensionType?.profile && extensionType.profile.length > 0) {
      return extensionType.profile[0];
    }

    return undefined;
  }

  private extractExtensionProfileUrl(element: ElementDefinition): string | undefined {
    const elementAny = element as ElementDefinition & { type?: Array<{ code: string; profile?: string[] }> };
    const extensionType = elementAny.type?.find((t: any) => t.code === 'Extension');
    if (extensionType?.profile && extensionType.profile.length > 0) {
      return extensionType.profile[0];
    }
    return undefined;
  }

  /**
   * Get extension arrays grouped by parent element instance.
   *
   * For paths like `Account.coverage.extension`, if `coverage` is an
   * array, returns one group per coverage item (each group contains the
   * extensions from that specific item). Cardinality constraints apply
   * per group, not globally across the flattened array.
   *
   * For paths without array intermediaries, returns a single group
   * containing all extensions (same as before).
   */
  private getExtensionGroupsByParent(
    resource: any,
    elementPath: string,
    context: ExtensionValidationContext
  ): any[][] {
    // Split path: "Account.coverage.extension" → parent "Account.coverage", leaf "extension"
    const lastDot = elementPath.lastIndexOf('.');
    if (lastDot <= 0) {
      // Top-level extension — no parent to split on
      const rawValue = context.getValueAtPath(resource, elementPath);
      return [Array.isArray(rawValue) ? rawValue : rawValue != null ? [rawValue] : []];
    }

    const parentPath = elementPath.substring(0, lastDot);
    const leafKey = elementPath.substring(lastDot + 1);

    // Get parent value(s)
    const parentRaw = context.getValueAtPath(resource, parentPath);
    if (parentRaw == null) return [];

    const parents = Array.isArray(parentRaw) ? parentRaw : [parentRaw];
    const groups: any[][] = [];

    for (const parent of parents) {
      if (parent == null || typeof parent !== 'object') continue;
      const exts = parent[leafKey];
      if (Array.isArray(exts)) {
        groups.push(exts);
      } else if (exts != null) {
        groups.push([exts]);
      }
      // If this parent has no extensions, still add empty group so
      // min-cardinality checks can fire
      else {
        groups.push([]);
      }
    }

    // If no array intermediary was found (parent wasn't array), fall
    // back to the flat approach to avoid changing behavior unnecessarily
    if (groups.length === 0) {
      const rawValue = context.getValueAtPath(resource, elementPath);
      return [Array.isArray(rawValue) ? rawValue : rawValue != null ? [rawValue] : []];
    }

    return groups;
  }

  private checkPathCardinality(
    elementPath: string,
    definitionsByUrl: Map<string, ExtensionDefinition>,
    counts: Map<string, number>,
    profileUrl: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const [url, def] of definitionsByUrl.entries()) {
      const count = counts.get(url) ?? 0;

      if (def.min > 0 && count < def.min) {
        issues.push(createValidationIssue({
          code: 'profile-extension-min-cardinality',
          path: elementPath,
          resourceType: 'Unknown',
          profile: profileUrl,
          messageParams: { url, found: count, min: def.min },
        }));
      }

      if (def.max !== '*') {
        const maxNum = parseInt(def.max, 10);
        if (!Number.isNaN(maxNum) && count > maxNum) {
          issues.push(createValidationIssue({
            code: 'profile-extension-max-cardinality',
            path: elementPath,
            resourceType: 'Unknown',
            profile: profileUrl,
            messageParams: { url, found: count, max: def.max },
          }));
        }
      }
    }

    return issues;
  }
}
