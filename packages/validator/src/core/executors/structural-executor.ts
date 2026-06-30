import type { ValidationIssue } from '../../types';
import type { StructureDefinition } from '../structure-definition-types';
import type { StructureDefinitionLoader } from '../structure-definition-loader';
import { CardinalityValidator } from '../../validators/cardinality-validator';
import { TypeValidator } from '../../validators/type-validator';
import { ElementRulesValidator } from '../../validators/element-rules-validator';
import { ComplexTypeValidator } from '../../validators/complex-type-validator';
import { MustSupportValidator } from '../../validators/must-support-validator';
import { ReferenceFormatValidator } from '../../validators/reference-format-validator';
import { ReferenceTargetValidator } from '../../validators/reference-target-validator';
import { NarrativeValidator } from '../../validators/narrative-validator';
import { BundleValidator } from '../../validators/bundle-validator';
import { AttachmentValidator } from '../../validators/attachment-validator';
import { QuestionnaireValidator } from '../../validators/questionnaire-validator';
import { CanonicalResourceInvariantValidator } from '../../validators/canonical-resource-invariant-validator';
import { StructureDefinitionValidator } from '../../validators/structure-definition-validator';
import { CompliesWithValidator } from '../../validators/complies-with-validator';
import { StringSecurityValidator } from '../../validators/string-security-validator';
import type { TerminologyResolutionConfig } from '../../validators/valueset-validator';
import { validateChoiceTypeProperties } from '../../validators/choice-type-property-validator';
import { getValueAtPath as getValueAtPathUtil } from '../validation-utils';
import { logger } from '../../logger';
import { buildSnapshotIndex, detectUnknownProperties, makeWalkerDeps, type SnapshotIndex } from './unknown-property-walker';
import { validateRequiredSnapshotFields } from './structural-required-fields';
import { validateResourceSanity } from './structural-resource-sanity';
import { validateStructuralSnapshot } from './structural-snapshot-validation';

export interface StructuralValidationContext {
  resource: any;
  resourceType: string;
  profileUrl?: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  structureDef: StructureDefinition;
  getValueAtPath: (resource: any, path: string) => any;
  contextQuestionnaire?: any;
  settings?: any; // ValidationSettings - using any to avoid circular deps or heavy imports
}

export class StructuralExecutor {
  private cardinalityValidator: CardinalityValidator;
  private typeValidator: TypeValidator;
  private elementRulesValidator: ElementRulesValidator;
  private complexTypeValidator: ComplexTypeValidator;
  private mustSupportValidator: MustSupportValidator;
  private referenceFormatValidator: ReferenceFormatValidator;
  private referenceTargetValidator: ReferenceTargetValidator;
  private narrativeValidator: NarrativeValidator;
  private bundleValidator: BundleValidator;
  private attachmentValidator: AttachmentValidator;
  private questionnaireValidator: QuestionnaireValidator;
  private canonicalResourceInvariantValidator: CanonicalResourceInvariantValidator;
  private structureDefinitionValidator: StructureDefinitionValidator;
  private compliesWithValidator: CompliesWithValidator;
  private stringSecurityValidator: StringSecurityValidator;
  private sdLoader: StructureDefinitionLoader;
  private walkerTypeIndexCaches = new Map<'R4' | 'R5' | 'R6', Map<string, SnapshotIndex | null>>();

  constructor(sdLoader: StructureDefinitionLoader) {
    this.cardinalityValidator = new CardinalityValidator();
    this.typeValidator = new TypeValidator();
    this.elementRulesValidator = new ElementRulesValidator();
    // Initialize new validators
    this.complexTypeValidator = new ComplexTypeValidator(sdLoader, this.typeValidator);
    this.mustSupportValidator = new MustSupportValidator();
    this.referenceFormatValidator = new ReferenceFormatValidator();
    this.referenceTargetValidator = new ReferenceTargetValidator();
    this.referenceTargetValidator.setProfileTypeResolver(url => sdLoader.getBaseResourceType(url));
    this.narrativeValidator = new NarrativeValidator();
    this.bundleValidator = new BundleValidator();
    this.attachmentValidator = new AttachmentValidator();
    this.questionnaireValidator = new QuestionnaireValidator();
    this.canonicalResourceInvariantValidator = new CanonicalResourceInvariantValidator();
    this.structureDefinitionValidator = new StructureDefinitionValidator();
    this.compliesWithValidator = new CompliesWithValidator(sdLoader);
    this.stringSecurityValidator = new StringSecurityValidator();
    this.sdLoader = sdLoader;
  }

  configureTerminologyResolution(config: Partial<TerminologyResolutionConfig>): void {
    this.complexTypeValidator.configureTerminologyResolution(config);
  }

  /**
   * Validate structural aspects of a resource
   */
  async validate(
    resourceOrContext: any,
    context?: StructuralValidationContext | any
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      const { resource, ctx } = this.normalizeValidationInput(resourceOrContext, context);
      let { structureDef, profiles, getValueAtPath, settings, fhirVersion } = ctx;
      const profileUrl = profiles?.[0];

      this.configureMustSupportSeverity(settings);
      if (!resource || !resource.resourceType) {
        throw new Error(`Invalid resource in validation context. Context keys: ${Object.keys(ctx).join(', ')}`);
      }

      if (!structureDef) {
        structureDef = await this.loadStructureDefinition(resource, profileUrl, fhirVersion || 'R4');
      }

      if (!getValueAtPath) {
        getValueAtPath = getValueAtPathUtil;
      }

      const effectiveProfileUrl = profileUrl || structureDef?.url;

      if (structureDef?.snapshot?.element) {
        issues.push(...await validateStructuralSnapshot({
          structureDef,
          resource,
          effectiveProfileUrl,
          getValueAtPath,
          fhirVersion: fhirVersion || 'R4',
          deps: this.createSnapshotValidationDeps(),
          resolveReference: ctx.referenceResolver ?? undefined,
        }));
      }

      // Seventh pass: Resource id format + empty array checks + attachment
      // size/data consistency (post-SD sanity checks that don't depend on the
      // profile snapshot)
      issues.push(...this.validateResourceIdAndArrays(resource, ctx.contextQuestionnaire));

      // Eighth pass: choice-type property shape. Catches `value: true` where
      // the SD declares `value[x]` and `valueInteger` where integer is not
      // in the allowed-type list. Requires the SD snapshot.
      if (structureDef) {
        issues.push(...validateChoiceTypeProperties(resource, structureDef));
      }

      // Ninth pass: structuredefinition-compliesWithProfile cross-profile
      // check (cardinality / constraint / binding-strength weakening).
      issues.push(...await this.validateCompliesWith(resource, fhirVersion || 'R4'));

      return issues;

    } catch (error) {
      logger.error('[StructuralExecutor] Validation error:', error);
      return [{
        id: `structural-executor-error-${Date.now()}`,
        aspect: 'structural',
        severity: 'error',
        code: 'validation-error',
        message: `Structural validation failed: ${error instanceof Error ? error.message : String(error)}`,
        path: '',
        timestamp: new Date()
      }];
    }
  }

  private normalizeValidationInput(
    resourceOrContext: any,
    context?: StructuralValidationContext | any,
  ): { resource: any; ctx: any } {
    let resource = resourceOrContext;
    let ctx = context;

    if (resourceOrContext?.resource && resourceOrContext.resourceType && !ctx) {
      ctx = resourceOrContext;
      resource = ctx.resource;
    }

    if (!resource) throw new Error('Resource not provided');
    if (!ctx) throw new Error('Validation context not provided');

    return { resource, ctx };
  }

  private configureMustSupportSeverity(settings: any): void {
    const severity = settings?.validationStrictness === 'strict' ? 'warning' : 'information';
    this.cardinalityValidator.setMustSupportSeverity(severity);
    this.mustSupportValidator.setMustSupportSeverity(severity);
  }

  private async loadStructureDefinition(
    resource: any,
    profileUrl: string | undefined,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<StructureDefinition | null> {
    const profileUrlToUse = profileUrl || `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;
    try {
      return await this.sdLoader.loadProfile(profileUrlToUse, fhirVersion);
    } catch {
      return null;
    }
  }

  private createSnapshotValidationDeps() {
    return {
      cardinalityValidator: this.cardinalityValidator,
      typeValidator: this.typeValidator,
      elementRulesValidator: this.elementRulesValidator,
      complexTypeValidator: this.complexTypeValidator,
      mustSupportValidator: this.mustSupportValidator,
      referenceFormatValidator: this.referenceFormatValidator,
      referenceTargetValidator: this.referenceTargetValidator,
      bundleValidator: this.bundleValidator,
      questionnaireValidator: this.questionnaireValidator,
      detectUnknownElements: (target: any, definition: StructureDefinition, resourceType: string, version: 'R4' | 'R5' | 'R6') =>
        this.detectUnknownElements(target, definition, resourceType, version),
    };
  }

  /**
   * Validate required fields only (for validateStructure method)
   */
  async validateRequiredFields(
    resource: any,
    structureDef: StructureDefinition,
    profileUrl: string,
    getValueAtPath: (resource: any, path: string) => any,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): Promise<ValidationIssue[]> {
    return validateRequiredSnapshotFields({
      resource,
      structureDef,
      profileUrl,
      getValueAtPath,
      fhirVersion,
      complexTypeValidator: this.complexTypeValidator,
    });
  }

  /**
   * Detect unknown elements (properties not defined in StructureDefinition).
   *
   * Walks the resource against the snapshot's full path index, descending
   * through BackboneElement children AND through complex datatypes
   * (HumanName, Address, CodeableConcept, …) by loading each type's SD
   * lazily via the SDLoader. Nested resources (Bundle.entry.resource,
   * contained[]) are still validated separately by engine recursion.
   */
  private async detectUnknownElements(
    resource: any,
    structureDef: StructureDefinition,
    resourceType: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<ValidationIssue[]> {
    const index = buildSnapshotIndex(structureDef);
    let typeIndexCache = this.walkerTypeIndexCaches.get(fhirVersion);
    if (!typeIndexCache) {
      typeIndexCache = new Map();
      this.walkerTypeIndexCaches.set(fhirVersion, typeIndexCache);
    }
    const deps = makeWalkerDeps(this.sdLoader, fhirVersion, typeIndexCache);
    return detectUnknownProperties(resource, index, resourceType, structureDef?.url, deps);
  }

  /**
   * Public entry point for id format + empty array checks.
   * Called from both validate() and validateStructure() paths.
   *
   * @param resource       Resource under validation
   * @param contextQuestionnaire Optional supporting Questionnaire that a
   *   QuestionnaireResponse references via `QR.questionnaire`. Passed
   *   through to the questionnaire-validator so SDC extensions
   *   (minValue/maxValue/…) can be evaluated against the answer items.
   */
  validateResourceIdAndArrays(
    resource: any,
    contextQuestionnaire?: any
  ): ValidationIssue[] {
    return validateResourceSanity(
      resource,
      {
        attachment: this.attachmentValidator,
        canonicalResourceInvariant: this.canonicalResourceInvariantValidator,
        structureDefinition: this.structureDefinitionValidator,
        stringSecurity: this.stringSecurityValidator,
        narrative: this.narrativeValidator,
        questionnaire: this.questionnaireValidator,
      },
      contextQuestionnaire
    );
  }

  /**
   * Public entry point for the compliesWithProfile cross-profile check.
   * Called from both validate() and validateStructure() so cw-* fixtures
   * pick up the same diagnostics regardless of routing.
   */
  async validateCompliesWith(
    resource: any,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): Promise<ValidationIssue[]> {
    if (resource?.resourceType !== 'StructureDefinition') return [];
    return this.compliesWithValidator.validate(resource, fhirVersion);
  }
}
