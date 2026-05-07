/* eslint-disable max-lines */
/**
 * Records Validator Engine
 *
 * Pure JavaScript/TypeScript FHIR Validation Engine
 * No Java dependency, optimized for speed and low memory usage
 *
 * Features:
 * - Profile validation against StructureDefinitions
 * - Structural validation (cardinality, types)
 * - Metadata validation
 * - FHIRPath constraint validation
 * - Extension and slicing support
 */

import type { ValidationIssue, ValidationSettings } from '../types';
import { StructureDefinitionLoader } from './structure-definition-loader';
import type { StructureDefinition } from './structure-definition-types';

import { ProfileCache } from '../cache/profile-cache';
import { TypeValidator } from '../validators/type-validator';
import { ExtensionValidator } from '../validators/extension-validator';
import { SlicingValidator } from '../validators/slicing-validator';
import { ConstraintValidator } from '../validators/constraint-validator';
import { ValueSetValidator } from '../validators/valueset-validator';
import { ElementRulesValidator } from '../validators/element-rules-validator';
import { SnapshotGenerator } from './snapshot-generator';
import { logger } from '../logger';
import {
  StructuralExecutor,
  ProfileExecutor,
  TerminologyExecutor,
  ReferenceExecutor,
  InvariantExecutor,
  CustomRuleExecutor,
  MetadataExecutor
} from './executors';
import { BestPracticeValidator } from '../validators/best-practice-validator';
import { getValueAtPath, createValidationErrorIssue, dedupeIssues, suppressRedundantBindingWarnings } from './validation-utils';
import { loadProfileWithSnapshot, loadProfileOrBase, createProfileFallbackIssue, type FhirClientLike } from './profile-loader-utils';
import { executeBatchValidation, type BatchValidationOptions } from './batch-validator';
import { runAllAspectValidations } from './validation-orchestrator';
import { buildMultiAspectValidateCallback } from './multi-aspect-validate-callback';
import { AnomalyDetector, type AnomalyFinding, type AnomalyDetectorConfig } from '../validators/anomaly-detector';

// ============================================================================
// Types
// ============================================================================

export interface RecordsValidatorConfig {
  packageCachePath?: string;
  /**
   * Directory holding bundled-profile FHIR packages. When omitted, the
   * SDLoader resolves the path relative to its own source location
   * (`<package-root>/storage/profiles/bundled`), which works both for
   * monorepo workspace dev (the path is a symlink to the in-tree copy)
   * and for an installed npm package (the bundled dir ships inside).
   * `RECORDS_BUNDLED_PROFILES_PATH` (env) overrides when set.
   */
  bundledProfilesPath?: string;
  enableCaching?: boolean;
  strictMode?: boolean;
  timeout?: number;
  autoDownload?: boolean;
  allowedPackages?: string[];
  packageVersionPins?: Record<string, string>;
}

export interface ValidationContext {
  resource: any;
  resourceType: string;
  profileUrl?: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  strictMode: boolean;
}

// ============================================================================
// Records Validator Engine
// ============================================================================

export class RecordsValidator {
  private config: RecordsValidatorConfig;
  private profileCache: ProfileCache;
  private sdLoader: StructureDefinitionLoader;
  private typeValidator: TypeValidator;
  private extensionValidator: ExtensionValidator;
  private slicingValidator: SlicingValidator;
  private constraintValidator: ConstraintValidator;
  private valuesetValidator: ValueSetValidator;
  private elementRulesValidator: ElementRulesValidator;
  private snapshotGenerator: SnapshotGenerator;
  private available: boolean = false;
  private initializationPromise: Promise<void>;

  // Executors for per-aspect validation
  private structuralExecutor: StructuralExecutor;
  private profileExecutor: ProfileExecutor;
  private terminologyExecutor: TerminologyExecutor;
  private referenceExecutor: ReferenceExecutor;
  private invariantExecutor: InvariantExecutor;
  private customRuleExecutor: CustomRuleExecutor;
  private metadataExecutor: MetadataExecutor;
  private bestPracticeValidator: BestPracticeValidator;
  private anomalyDetector: AnomalyDetector;

  /**
   * Registry of conformance resources pulled in via `loadSupportingFiles`
   * in the conformance runner (or callers that want to inject a
   * Questionnaire for a subsequent QR validation). Keyed by canonical URL.
   * Today this only holds Questionnaires; ValueSets / CodeSystems have
   * their own caches in the terminology executor.
   */
  private questionnaireRegistry: Map<string, any> = new Map();

  constructor(config: RecordsValidatorConfig = {}) {
    // Use same package cache as HAPI validator: ~/.fhir/packages
    const defaultCachePath = process.env.HOME
      ? `${process.env.HOME}/.fhir/packages`
      : '/tmp/fhir-packages';

    // Helper function to expand $HOME in paths
    const expandHomePath = (pathStr: string): string => {
      if (pathStr.startsWith('$HOME/') || pathStr.startsWith('$HOME\\')) {
        return pathStr.replace('$HOME', process.env.HOME || '/tmp');
      }
      if (pathStr.startsWith('~/')) {
        return pathStr.replace('~', process.env.HOME || '/tmp');
      }
      return pathStr;
    };

    this.config = {
      packageCachePath: expandHomePath(
        config.packageCachePath
        || process.env.FHIR_PACKAGE_CACHE_PATH
        || defaultCachePath
      ),
      enableCaching: config.enableCaching !== false, // default true
      strictMode: config.strictMode || false,
      timeout: config.timeout || 5000,
      autoDownload: config.autoDownload !== false, // default true
      allowedPackages: config.allowedPackages
    };

    this.profileCache = new ProfileCache(this.config.enableCaching);
    this.sdLoader = new StructureDefinitionLoader(
      this.config.packageCachePath || process.env.HOME + '/.fhir/packages',
      config.bundledProfilesPath,
      {
        autoDownload: this.config.autoDownload,
        allowedPackages: this.config.allowedPackages,
        packageVersionPins: config.packageVersionPins
      }
    );
    this.typeValidator = new TypeValidator();
    this.valuesetValidator = new ValueSetValidator();
    this.elementRulesValidator = new ElementRulesValidator();
    this.extensionValidator = new ExtensionValidator(
      this.sdLoader,
      this.typeValidator,
      this.valuesetValidator,
      this.elementRulesValidator
    );
    this.slicingValidator = new SlicingValidator();
    this.slicingValidator.setTypeProfileResolver(
      (url: string) => this.sdLoader.loadProfile(url)
    );
    this.constraintValidator = new ConstraintValidator();
    this.snapshotGenerator = new SnapshotGenerator(this.sdLoader);

    // Initialize executors
    this.structuralExecutor = new StructuralExecutor(this.sdLoader);
    this.profileExecutor = new ProfileExecutor(this.extensionValidator, this.slicingValidator, this.constraintValidator);
    this.terminologyExecutor = new TerminologyExecutor();
    this.referenceExecutor = new ReferenceExecutor();
    this.invariantExecutor = new InvariantExecutor();
    this.customRuleExecutor = new CustomRuleExecutor();
    this.metadataExecutor = new MetadataExecutor();
    this.bestPracticeValidator = new BestPracticeValidator();
    this.anomalyDetector = new AnomalyDetector();

    // Start initialization (async, but store promise for waiting)
    this.initializationPromise = this.initialize();
  }

  /**
   * Initialize validator and check availability
   * This waits for profiles to be scanned before checking availability
   */
  private async initialize(): Promise<void> {
    try {
      // Wait for profile scanning to complete
      await this.sdLoader.waitForInitialization();

      // Check if base packages are loaded
      const hasBaseProfiles = await this.sdLoader.hasBaseProfiles();
      this.available = hasBaseProfiles;

      if (this.available) {
        logger.info('[RecordsValidator] ✅ Validator is available and ready');
      } else {
        logger.info('[RecordsValidator] ⚠️  Validator not available - base profiles not loaded');
      }
    } catch (error) {
      logger.warn('[RecordsValidator] Error during initialization:', error);
      this.available = false;
    }
  }

  /**
   * Wait for initialization to complete
   * Call this before using the validator to ensure profiles are loaded
   */
  async waitForInitialization(): Promise<void> {
    await this.initializationPromise;
  }

  /**
   * Check if validator is available
   * Note: This returns the current state, but initialization may still be in progress
   * Use waitForInitialization() to ensure initialization is complete
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Validate multiple resources in batch (optimized)
   * This is 5-10x faster than calling validate() repeatedly
   * 
   * @param resources - Array of resources to validate
   * @param options - Batch validation options
   * @returns Map of resource to validation issues
   */
  async validateBatch(
    resources: any[],
    options: BatchValidationOptions = {}
  ): Promise<Map<any, ValidationIssue[]> | Map<any, any>> {
    // Ensure initialization is complete before batch validation
    await this.waitForInitialization();
    this.applyRuntimeSettings(options.settings as ValidationSettings | undefined);



    // Check if multi-aspect batch validation is requested
    if (options.aspects && options.aspects.length > 0 && options.settings) {
      logger.info(`[RecordsValidator] ⚡ Starting MULTI-ASPECT batch validation for ${resources.length} resources`);
      logger.info(`[RecordsValidator] 📋 Aspects: ${options.aspects.join(', ')}`);

      // Use the existing batch executor but with a multi-aspect validator callback
      // We explicitly type T as any because the return type is a complex object, distinct from ValidationIssue[]
      return await executeBatchValidation<any>(resources, options, {
        sdLoader: this.sdLoader,
        profileCache: this.profileCache,
        snapshotGenerator: this.snapshotGenerator,
        validateResource: buildMultiAspectValidateCallback(
          {
            sdLoader: this.sdLoader,
            snapshotGenerator: this.snapshotGenerator,
            structuralExecutor: this.structuralExecutor,
            profileExecutor: this.profileExecutor,
            terminologyExecutor: this.terminologyExecutor,
            referenceExecutor: this.referenceExecutor,
            invariantExecutor: this.invariantExecutor,
            customRuleExecutor: this.customRuleExecutor,
            metadataExecutor: this.metadataExecutor,
            bestPracticeValidator: this.bestPracticeValidator,
            strictMode: this.config.strictMode || false,
          },
          options.aspects!,
          options.settings
        )
      });
    }

    // Single-aspect batch validation
    return await executeBatchValidation(resources, options, {
      sdLoader: this.sdLoader,
      profileCache: this.profileCache,
      snapshotGenerator: this.snapshotGenerator,
      validateResource: (resource, profileUrl, fhirVersion) => this.validate(
        resource,
        profileUrl,
        fhirVersion,
        options.settings,
        options.fhirClient // Pass fhirClient from batch options
      )
    });
  }

  // Helper methods for batch validation (deduplication, grouping, preloading, chunking)
  // have been extracted to batch-utils.ts to keep this orchestrator focused and compliant
  // with global.mdc file size guidelines.

  /**
   * Validate resource against a profile
   */
  async validate(
    resource: any,
    profileUrl?: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
    settings?: ValidationSettings,
    fhirClient?: FhirClientLike
  ): Promise<ValidationIssue[]> {
    // Ensure initialization is complete before validating
    await this.waitForInitialization();

    const startTime = Date.now();
    const issues: ValidationIssue[] = [];

    try {
      const declaredProfileUrl =
        profileUrl ??
        resource.meta?.profile?.[0] ??
        `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;

      logger.info(`[RecordsValidator] Validating ${resource.resourceType} against ${declaredProfileUrl}`);
      this.applyRuntimeSettings(settings as ValidationSettings | undefined);

      // 1. Load StructureDefinition with snapshot generation if needed.
      // If the declared profile can't be resolved, fall back to the resource
      // type's base SD so structural/invariant/reference aspects still run
      // (matches HAPI behaviour; otherwise a typo in meta.profile silently
      // skips ALL validation).
      const loadResult = await loadProfileOrBase(
        this.sdLoader,
        this.snapshotGenerator,
        declaredProfileUrl,
        resource.resourceType,
        fhirVersion,
        this.profileCache,
        fhirClient
      );
      const structureDef = loadResult.structureDef;

      if (!structureDef) {
        return [createValidationErrorIssue(
          'profile',
          'profile-not-found',
          `Profile ${declaredProfileUrl} not found and base StructureDefinition for ${resource.resourceType} could not be loaded`,
          { profile: declaredProfileUrl },
          'meta.profile'
        )];
      }

      const profileFallbackIssue: ValidationIssue | null = loadResult.usedBaseFallback
        ? createProfileFallbackIssue(declaredProfileUrl, resource.resourceType)
        : null;

      // 2. Run all aspect validations
      const aspectIssues = await runAllAspectValidations(
        {
          resource,
          resourceType: resource.resourceType,
          profileUrl: declaredProfileUrl,
          fhirVersion,
          structureDef,
          strictMode: this.config.strictMode || false,
          settings
        },
        this.structuralExecutor,
        this.profileExecutor,
        this.terminologyExecutor,
        this.invariantExecutor,
        this.customRuleExecutor,
        this.metadataExecutor,
        this.referenceExecutor
      );

      // 2b. Best practice warnings (effectiveDateTime, performer for Observation)
      const bestPracticeIssues = this.bestPracticeValidator.validate({
        resource,
        resourceType: resource.resourceType,
        profileUrl: declaredProfileUrl
      });

      issues.push(...suppressRedundantBindingWarnings(dedupeIssues([
        ...(profileFallbackIssue ? [profileFallbackIssue] : []),
        ...aspectIssues,
        ...bestPracticeIssues,
        ...(await this.validateBundleEntriesIfNeeded(resource, fhirVersion)),
      ])));

      const validationTime = Date.now() - startTime;
      logger.info(
        `[RecordsValidator] Validated ${resource.resourceType} in ${validationTime}ms ` +
        `(${issues.length} issues - extensions, slicing, bindings, constraints checked)`
      );

      return issues;

    } catch (error) {
      logger.error('[RecordsValidator] Validation error:', error);
      return [createValidationErrorIssue(
        'profile',
        'validation-error',
        `Validation failed: ${error instanceof Error ? error.message : String(error)}`
      )];
    }
  }

  private async validateBundleEntriesIfNeeded(
    resource: any,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<ValidationIssue[]> {
    if (resource.resourceType !== 'Bundle' || !Array.isArray(resource.entry)) {
      return [];
    }
    return this.validateBundleEntries(resource, fhirVersion, 1);
  }

  /** Max depth for recursive Bundle.entry[].resource validation */
  private static readonly BUNDLE_ENTRY_MAX_DEPTH = 3;

  /**
   * Validate basic structure - validates against profiles declared in meta.profile
   * Falls back to base FHIR profile if no profiles are declared
   */
  async validateStructure(
    resource: any,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
    recursionDepth: number = 0
  ): Promise<ValidationIssue[]> {
    // Ensure initialization is complete before validating
    await this.waitForInitialization();

    const startTime = Date.now();
    const issues: ValidationIssue[] = [];

    try {
      // Basic structural checks
      if (!resource.resourceType) {
        issues.push({
          id: `records-missing-resourcetype-${Date.now()}`,
          aspect: 'structural',
          severity: 'error',
          code: 'missing-resourcetype',
          message: 'Resource is missing resourceType field',
          path: '',
          timestamp: new Date()
        });
        return issues;
      }

      const declaredProfiles = resource.meta?.profile || [];
      const baseUrl = `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;
      const profilesToValidate = declaredProfiles.length > 0 ? declaredProfiles : [baseUrl];

      logger.info(`[RecordsValidator] Validating ${resource.resourceType} structure against ${profilesToValidate.length} profile(s)`);

      // Validate against each declared profile
      for (const profileUrl of profilesToValidate) {
        logger.info(`[RecordsValidator]   - Checking profile: ${profileUrl}`);

        // Load profile with snapshot generation (with caching)
        const loadedStructureDef = await loadProfileWithSnapshot(
          this.sdLoader,
          this.profileCache,
          this.snapshotGenerator,
          profileUrl,
          fhirVersion
        );

        if (!loadedStructureDef) {
          logger.warn(`[RecordsValidator] Failed to load profile: ${profileUrl}`);
          continue;
        }

        if (loadedStructureDef.snapshot?.element) {
          // Use structural executor to validate required fields
          const requiredFieldIssues = await this.structuralExecutor.validateRequiredFields(
            resource,
            loadedStructureDef,
            profileUrl,
            getValueAtPath,
            fhirVersion
          );
          issues.push(...requiredFieldIssues);

          // Choice-type property shape: `value: true` (unsuffixed) or
          // `valueInteger` (wrong suffix) for a `value[x]` slot. Runs in
          // both validate() and validateStructure() paths so the `(default)`
          // and `xhtml` modules of fhir-test-cases catch these cases too.
          const { validateChoiceTypeProperties } = await import(
            '../validators/choice-type-property-validator.js'
          );
          issues.push(...validateChoiceTypeProperties(resource, loadedStructureDef));
        }
      }

      // Post-SD sanity checks: id format, empty arrays, attachment size,
      // questionnaire invariants (que-0 … que-12), SDC extension
      // evaluation for QRs — structural-executor dispatches to the
      // per-type validators internally.
      const contextQ = resource.resourceType === 'QuestionnaireResponse'
        ? this.resolveQuestionnaireForResponse(resource)
        : undefined;
      issues.push(...this.structuralExecutor.validateResourceIdAndArrays(resource, contextQ));
      // compliesWithProfile cross-profile check — async because the
      // claimed parent SD is loaded via the SDLoader. Runs in both
      // validate() and validateStructure() paths so the cw-* fixtures
      // (module: profile, lightweight routing) pick it up.
      issues.push(...(await this.structuralExecutor.validateCompliesWith(resource, fhirVersion)));

      // Bundle-specific rules (fullUrl format, duplicates, cross-entry refs).
      // These don't depend on a profile snapshot so they run even when the
      // resource is validated against just the base Bundle definition.
      if (resource.resourceType === 'Bundle') {
        const { bundleValidator } = await import('../validators/bundle-validator.js');
        issues.push(...await bundleValidator.validateBundle(resource));

        // Recursively validate each Bundle.entry[].resource independently
        // (Phase 5). The structural executor explicitly skips sub-elements
        // of Bundle.entry.resource via the Bundle SD (Phase 6 guard), so
        // without this pass entry resources are never checked at all.
        // A depth limit prevents runaway recursion on pathological
        // Bundle-in-Bundle-in-Bundle inputs.
        if (recursionDepth < RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH) {
          issues.push(...(await this.validateBundleEntries(resource, fhirVersion, recursionDepth + 1)));
        }
      }

      const validationTime = Date.now() - startTime;
      logger.info(`[RecordsValidator] Validated structure in ${validationTime}ms (${issues.length} issues)`);

      return issues;

    } catch (error) {
      logger.error('[RecordsValidator] Structure validation error:', error);
      return [createValidationErrorIssue(
        'structural',
        'validation-error',
        `Structure validation failed: ${error instanceof Error ? error.message : String(error)}`
      )];
    }
  }

  /**
   * Recursively validate each `Bundle.entry[].resource` against its own
   * profile(s). Phase 5 of the conformance execution plan.
   *
   * The Java reference validator runs a full validation pass on every
   * entry resource and emits issues whose `expression` is prefixed with
   * `Bundle.entry[i].resource/*ResourceType/id*\/.xyz`. Records matches
   * that shape by calling `validateStructure` on the entry resource and
   * rewriting the `path` of each returned issue.
   */
  private async validateBundleEntries(
    bundle: any,
    fhirVersion: 'R4' | 'R5' | 'R6',
    recursionDepth: number
  ): Promise<ValidationIssue[]> {
    const out: ValidationIssue[] = [];
    const entries: any[] = Array.isArray(bundle?.entry) ? bundle.entry : [];
    if (entries.length === 0) return out;

    for (let i = 0; i < entries.length; i++) {
      const entryResource = entries[i]?.resource;
      if (!entryResource || typeof entryResource !== 'object') continue;
      if (!entryResource.resourceType) continue;

      // Choose the profile URL: prefer meta.profile[0] if declared, else
      // the base StructureDefinition for the resource type.
      const declared: string[] = Array.isArray(entryResource.meta?.profile) ? entryResource.meta.profile : [];
      const profileUrl = declared[0] || `http://hl7.org/fhir/StructureDefinition/${entryResource.resourceType}`;

      let entryIssues: ValidationIssue[];
      try {
        // Full validation (structural + profile + terminology + invariants +
        // metadata). Previously limited to validateStructure() because the
        // full path produced too much mustSupport / slicing / reference noise
        // on clean bundles. Sub-Phases 2a, 2b, and 2c removed those noise
        // sources (best-practice warning downgrade, slice-scoped constraint
        // leaks, versioned-reference duplicate-fullUrl + _history parsing +
        // cross-entry resolution), so the full path is safe here now.
        entryIssues = await this.validate(entryResource, profileUrl, fhirVersion);
        // Plus the post-SD sanity / questionnaire / bundle-recursion checks
        // the top-level validate() path would normally run via
        // validateStructure.
        entryIssues.push(...this.structuralExecutor.validateResourceIdAndArrays(entryResource));
        if (entryResource.resourceType === 'Bundle' && recursionDepth < RecordsValidator.BUNDLE_ENTRY_MAX_DEPTH) {
          entryIssues.push(...(await this.validateBundleEntries(entryResource, fhirVersion, recursionDepth + 1)));
        }
      } catch (error) {
        logger.warn(
          `[RecordsValidator] Bundle entry[${i}] validation threw: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }

      const rtId = entryResource.id ? `${entryResource.resourceType}/${entryResource.id}` : entryResource.resourceType;
      const prefix = `Bundle.entry[${i}].resource/*${rtId}*/`;
      const rtLen = entryResource.resourceType.length;

      // The full validate() path already calls validateResourceIdAndArrays
      // internally (see structural-executor.validate). Combined with the
      // explicit call above, identical post-SD warnings (narrative-lang,
      // attachment-size, …) ship twice per entry. De-duplicate by
      // (code + path + message) before the prefix rewrite so the diff
      // against Java is not penalised by Records-internal duplication.
      const seen = new Set<string>();
      for (const issue of entryIssues) {
        const key = `${issue.code}|${issue.path}|${issue.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rewritten: ValidationIssue = {
          ...issue,
          path: this.rewriteEntryPath(issue.path, prefix, entryResource.resourceType, rtLen),
        };
        if (issue.expression) {
          rewritten.expression = this.rewriteEntryPath(issue.expression, prefix, entryResource.resourceType, rtLen);
        }
        out.push(rewritten);
      }
    }

    return out;
  }

  /**
   * Rewrite an issue path/expression that starts with a resource type
   * prefix (e.g. `Patient.name`) to the Bundle-entry-scoped form
   * (`Bundle.entry[i].resource/*Patient/1*\/.name`) so the diff tool
   * sees the same path Java emits.
   */
  private rewriteEntryPath(
    p: string | undefined,
    prefix: string,
    resourceType: string,
    rtLen: number
  ): string | undefined {
    if (!p) return p;
    // Strip the resource type + optional leading dot — Java emits the
    // entry prefix followed by the *sub-path* of the issue, not the
    // entry resource type again.
    if (p === resourceType) return prefix;
    if (p.startsWith(`${resourceType}.`)) return `${prefix}.${p.slice(rtLen + 1)}`;
    // Path already lacks the resource type prefix — attach directly
    return `${prefix}.${p}`;
  }

  /**
   * Validate metadata fields
   */
  async validateMetadata(
    resource: any
  ): Promise<ValidationIssue[]> {
    // Ensure initialization is complete before validating
    await this.waitForInitialization();

    try {
      // Delegate to metadata executor
      return await this.metadataExecutor.validate({ resource });
    } catch (error) {
      logger.error('[RecordsValidator] Metadata validation error:', error);
      return [createValidationErrorIssue(
        'metadata',
        'validation-error',
        `Metadata validation failed: ${error instanceof Error ? error.message : String(error)}`
      )];
    }
  }

  /**
   * Validate references in a FHIR resource
   * 
   * @param resource - FHIR resource to validate
   * @param fhirClient - Optional FHIR client for reference resolution
   * @param fhirVersion - FHIR version (R4, R5, R6)
   * @returns Array of validation issues
   */
  async validateReferences(
    resource: any,
    fhirClient?: FhirClientLike,
    fhirVersion?: 'R4' | 'R5' | 'R6'
  ): Promise<ValidationIssue[]> {
    try {
      // Delegate to reference executor
      return await this.referenceExecutor.validate({
        resource,
        fhirClient,
        fhirVersion
      });
    } catch (error) {
      logger.error('[RecordsValidator] Reference validation error:', error);
      return [createValidationErrorIssue(
        'reference',
        'validation-error',
        `Reference validation failed: ${error instanceof Error ? error.message : String(error)}`
      )];
    }
  }

  /**
   * Check if a profile is supported
   */
  isProfileSupported(profileUrl: string): boolean {
    // Check if profile is in cache or can be loaded
    return this.sdLoader.isProfileAvailable(profileUrl);
  }

  /**
   * Get list of all supported profiles
   */
  getSupportedProfiles(): string[] {
    return this.sdLoader.getAvailableProfiles();
  }

  /**
   * Get StructureDefinitionLoader instance (for status/configuration access)
   */
  getSdLoader(): StructureDefinitionLoader {
    return this.sdLoader;
  }

  /**
   * Resolve a profile URL to a StructureDefinition with a generated snapshot,
   * using the same cache + snapshot-generation path the validator takes at
   * run time. Returns null when the profile can't be loaded.
   */
  async loadProfileWithSnapshot(
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<StructureDefinition | null> {
    return loadProfileWithSnapshot(
      this.sdLoader,
      this.profileCache,
      this.snapshotGenerator,
      profileUrl,
      fhirVersion,
    );
  }

  /**
   * Register a Questionnaire resource so it can be consulted when
   * validating a QuestionnaireResponse that references it via
   * `QR.questionnaire`. Used by the conformance runner to preload
   * supporting Questionnaires and by callers that want to inject a
   * questionnaire at runtime.
   */
  registerQuestionnaire(questionnaire: any): boolean {
    if (!questionnaire || questionnaire.resourceType !== 'Questionnaire') {
      return false;
    }
    if (questionnaire.url) {
      this.questionnaireRegistry.set(questionnaire.url, questionnaire);
    }
    // Also key on local id / versionless url so local references can
    // resolve (e.g. `Questionnaire/foo` from a contained reference).
    if (questionnaire.id) {
      this.questionnaireRegistry.set(`Questionnaire/${questionnaire.id}`, questionnaire);
      this.questionnaireRegistry.set(`#${questionnaire.id}`, questionnaire);
    }
    return true;
  }

  /**
   * Look up a previously-registered Questionnaire by its canonical URL,
   * resource reference, or contained reference. Returns null when
   * nothing is registered under the given key.
   */
  getQuestionnaire(canonicalOrRef: string | undefined | null): any | null {
    if (!canonicalOrRef) return null;
    // Strip `|version` from canonical URLs — versioned lookup isn't
    // supported yet, but the version-stripped URL should still resolve.
    const base = canonicalOrRef.split('|')[0];
    return this.questionnaireRegistry.get(base) || this.questionnaireRegistry.get(canonicalOrRef) || null;
  }

  /**
   * Resolve the Questionnaire a QuestionnaireResponse points at. Looks
   * first inside `response.contained[]`, then in the main registry by
   * canonical URL or resource reference. Returns undefined when nothing
   * can be resolved (QR validation then falls back to type/cardinality
   * checks without SDC extension evaluation).
   */
  private resolveQuestionnaireForResponse(response: any): any | undefined {
    const ref: string | undefined = response?.questionnaire;
    if (!ref) return undefined;

    // Contained reference (e.g. `#inline-id`) — scan QR.contained[]
    if (ref.startsWith('#')) {
      const id = ref.slice(1);
      const contained = Array.isArray(response.contained) ? response.contained : [];
      const hit = contained.find((c: any) => c?.id === id && c?.resourceType === 'Questionnaire');
      return hit || this.getQuestionnaire(ref) || undefined;
    }

    return this.getQuestionnaire(ref) || undefined;
  }

  /**
   * Apply validation settings that affect profile loading at runtime.
   * This keeps the singleton validator aligned with per-request UI settings.
   */
  private applyRuntimeSettings(settings?: ValidationSettings): void {
    if (!settings) {
      return;
    }

    const autoDownload = settings.packageDownload?.autoDownload;
    if (typeof autoDownload === 'boolean' && this.sdLoader.isAutoDownloadEnabled() !== autoDownload) {
      this.sdLoader.setAutoDownload(autoDownload);
    }

    if (settings.profileSources) {
      this.sdLoader.setProfileSourcesConfig(settings.profileSources);
    }

    if (settings.packageDownload?.approvedPackages) {
      this.sdLoader.setAllowedPackages(settings.packageDownload.approvedPackages);
    }

    if (settings.packageDownload?.pinnedVersions) {
      this.sdLoader.setPackageVersionPins(settings.packageDownload.pinnedVersions);
    }
  }

  /**
   * Configure terminology resolution strategy
   * Call this when settings change to update how terminology validation resolves codes
   * 
   * @param config - Terminology resolution configuration
   * @param config.strategy - 'local-first' | 'server-first' | 'local-only'
   * @param config.serverUrl - URL of terminology server (for server-first)
   */
  configureTerminologyResolution(config: {
    strategy: 'local-first' | 'server-first' | 'local-only';
    serverUrl?: string;
    /**
     * Optional auth config propagated from the primary terminology
     * server. Enables Bearer / Basic / OAuth2 / mTLS calls to servers
     * that require authentication (e.g. NHS England, enterprise
     * Ontoserver deployments). Passthrough-only — the API client
     * handles header construction, OAuth2 token refresh, and TLS agent
     * setup.
     */
    auth?: {
      type: 'none' | 'basic' | 'bearer' | 'oauth2' | 'mtls';
      username?: string;
      password?: string;
      token?: string;
      clientId?: string;
      clientSecret?: string;
      scope?: string;
      tokenUrl?: string;
      clientCert?: string;
      clientCertPath?: string;
      clientKey?: string;
      clientKeyPath?: string;
      caCert?: string;
      caCertPath?: string;
      passphrase?: string;
      rejectUnauthorized?: boolean;
    };
    /**
     * Full server list from settings. When provided, enables scope-
     * based routing: lookups for code systems in a server's
     * `preferredSystems` are routed to THAT server before falling
     * back to the default serverUrl. Without it, all lookups go to
     * the configured default.
     */
    servers?: Array<{
      id: string;
      url: string;
      enabled: boolean;
      fhirVersions: ('R4' | 'R5' | 'R6')[];
      preferredSystems?: string[];
      circuitOpen?: boolean;
      authConfig?: {
        type: 'none' | 'basic' | 'bearer' | 'oauth2' | 'mtls';
        username?: string;
        password?: string;
        token?: string;
        clientId?: string;
        clientSecret?: string;
        scope?: string;
        tokenUrl?: string;
        clientCert?: string;
        clientCertPath?: string;
        clientKey?: string;
        clientKeyPath?: string;
        caCert?: string;
        caCertPath?: string;
        passphrase?: string;
        rejectUnauthorized?: boolean;
      };
    }>;
    serverDelegation?: {
      expandValueSets: boolean;
      validateCodes: boolean;
      cacheResults: boolean;
      cacheTTLSeconds: number;
    };
  }): void {
    this.terminologyExecutor.configureResolution(config);
    this.valuesetValidator.setResolutionConfig(config);
    const scopedCount = config.servers?.filter(s => s.preferredSystems && s.preferredSystems.length > 0).length || 0;
    logger.info(
      `[RecordsValidator] Terminology resolution configured: strategy=${config.strategy}, ` +
      `server=${config.serverUrl}, auth=${config.auth?.type || 'none'}, ` +
      `servers=${config.servers?.length || 0} (${scopedCount} with scope routing)`,
    );
  }

  /**
   * Clear terminology cache (call on settings change)
   */
  clearTerminologyCache(): void {
    this.terminologyExecutor.clearCache();
    this.valuesetValidator.clearCache();
    logger.info('[RecordsValidator] Terminology caches cleared');
  }

  /**
   * Clear the in-memory StructureDefinition cache. Call on profile-source
   * / package-pin changes so re-resolution picks up new definitions.
   */
  clearProfileCache(): void {
    this.profileCache.clear();
    logger.info('[RecordsValidator] Profile cache cleared');
  }

  /**
   * Evict a single profile URL from snapshot + L1 caches.
   * Used by the conformance runner when re-registering an external profile
   * with the same URL but different content between test cases.
   */
  evictProfile(profileUrl: string, fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'): void {
    this.snapshotGenerator.evict(profileUrl);
    this.profileCache.delete(`${profileUrl}:${fhirVersion}:snapshot`);
  }

  setPinnedCanonicals(pinned: Map<string, string>): void {
    this.sdLoader.setPinnedCanonicals(pinned);
  }

  getPinnedCanonicalCount(): number {
    return this.sdLoader.getPinnedCanonicalCount();
  }

  /**
   * Cross-Resource Anomaly Detection (Phase C differentiator).
   *
   * Analyses a batch of resources AFTER per-resource validation and
   * surfaces cohort-level data-quality issues that single-resource
   * validators cannot detect:
   *
   *   - Missing-field anomalies ("95% have effectiveDateTime, these 12 don't")
   *   - Duplicate resources (same subject + code + date)
   *   - Orphan references (target not in batch)
   *
   * HAPI cannot do this — it validates one resource at a time. This
   * is what justifies Records' existence beyond speed.
   *
   * @param resources — the full batch (same array you'd pass to validateBatch)
   * @param config — optional overrides for detection thresholds
   * @returns array of anomaly findings, sorted by confidence
   */
  detectAnomalies(
    resources: any[],
    config?: Partial<AnomalyDetectorConfig>,
  ): AnomalyFinding[] {
    if (config) {
      return new AnomalyDetector(config).detect(resources);
    }
    return this.anomalyDetector.detect(resources);
  }
}
