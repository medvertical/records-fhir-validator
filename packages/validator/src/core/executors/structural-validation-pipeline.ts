import { BoundedLruCache } from '../../cache/bounded-lru-cache.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import { validateChoiceTypeProperties } from '../../validators/choice-type-property-validator.js';
import type { TerminologyResolutionConfig } from '../../validators/valueset-validator.js';
import { ContentReferenceElementsCache } from '../content-reference-elements.js';
import type { StructureDefinitionLoader } from '../structure-definition-loader.js';
import type { StructureDefinition } from '../structure-definition-types.js';
import { getValueAtPath as getValueAtPathUtil } from '../validation-utils.js';
import { validateResourceSanity } from './structural-resource-sanity.js';
import { validateRequiredSnapshotFields } from './structural-required-fields.js';
import { validateStructuralSnapshot } from './structural-snapshot-validation.js';
import type { StructuralValidatorComponents } from './structural-validator-components.js';
import {
  buildSnapshotIndex,
  detectUnknownProperties,
  makeWalkerDeps,
  type SnapshotIndex,
} from './unknown-property-walker.js';
import { createProfileUnreadable } from '../../issues/profile-completeness-issues.js';

export type StructuralResource = Record<string, unknown>;
export type StructuralValueAtPath = (
  resource: StructuralResource,
  path: string,
) => unknown;

export interface StructuralValidationContext {
  resource: StructuralResource;
  resourceType: string;
  profileUrl?: string;
  profiles?: string[];
  fhirVersion: 'R4' | 'R5' | 'R6';
  structureDef?: StructureDefinition | null;
  getValueAtPath?: StructuralValueAtPath;
  contextQuestionnaire?: unknown;
  settings?: unknown;
  referenceResolver?: ((reference: string) => unknown) | null;
}

export class StructuralValidationPipeline {
  private readonly walkerTypeIndexCaches = new Map<
    'R4' | 'R5' | 'R6',
    BoundedLruCache<string, SnapshotIndex | null>
  >();
  private readonly walkerSnapshotIndexCaches = new Map<
    'R4' | 'R5' | 'R6',
    WeakMap<StructureDefinition, SnapshotIndex>
  >();
  private readonly contentReferenceElementsCache = new ContentReferenceElementsCache();

  constructor(
    private readonly sdLoader: StructureDefinitionLoader,
    private readonly validators: StructuralValidatorComponents,
  ) {}

  configureTerminologyResolution(config: Partial<TerminologyResolutionConfig>): void {
    this.validators.complexType.configureTerminologyResolution(config);
  }

  validateBundle(resource: unknown): Promise<ValidationIssue[]> {
    return this.validators.bundle.validateBundle(resource);
  }

  async validate(
    resourceOrContext: unknown,
    context?: StructuralValidationContext,
  ): Promise<ValidationIssue[]> {
    const { resource, ctx } = this.normalizeValidationInput(resourceOrContext, context);
    let { structureDef, profiles, getValueAtPath, settings, fhirVersion } = ctx;
    const profileUrl = ctx.profileUrl || profiles?.[0];

    this.configureMustSupportSeverity(settings);
    if (typeof resource.resourceType !== 'string' || resource.resourceType.length === 0) {
      throw new Error(
        `Invalid resource in validation context. Context keys: ${Object.keys(ctx).join(', ')}`,
      );
    }

    let profileLoadFailure: ValidationIssue | undefined;
    if (!structureDef) {
      const loaded = await this.loadStructureDefinition(
        resource,
        profileUrl,
        fhirVersion || 'R4',
      );
      structureDef = loaded.structureDef;
      profileLoadFailure = loaded.loadFailure;
    }

    if (!getValueAtPath) {
      getValueAtPath = getValueAtPathUtil;
    }

    const effectiveProfileUrl = profileUrl || structureDef?.url;
    const issues: ValidationIssue[] = [];
    if (profileLoadFailure) issues.push(profileLoadFailure);

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

    // Resource sanity checks do not depend on the profile snapshot.
    issues.push(...this.validateResourceIdAndArrays(
      resource,
      ctx.contextQuestionnaire,
      { warnOnUnresolvedQuestionnaireReference: true },
      fhirVersion || 'R4',
    ));

    if (structureDef) {
      issues.push(...validateChoiceTypeProperties(resource, structureDef));
    }

    issues.push(...await this.validateCompliesWith(resource, fhirVersion || 'R4'));
    return issues;
  }

  async validateRequiredFields(
    resource: StructuralResource,
    structureDef: StructureDefinition,
    profileUrl: string,
    getValueAtPath: StructuralValueAtPath,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<ValidationIssue[]> {
    return validateRequiredSnapshotFields({
      resource,
      structureDef,
      profileUrl,
      getValueAtPath,
      fhirVersion,
      complexTypeValidator: this.validators.complexType,
    });
  }

  validateResourceIdAndArrays(
    resource: StructuralResource,
    contextQuestionnaire?: unknown,
    options: { warnOnUnresolvedQuestionnaireReference?: boolean } = {},
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): ValidationIssue[] {
    return validateResourceSanity(
      resource,
      {
        attachment: this.validators.attachment,
        canonicalResourceInvariant: this.validators.canonicalResourceInvariant,
        structureDefinition: this.validators.structureDefinition,
        stringSecurity: this.validators.stringSecurity,
        narrative: this.validators.narrative,
        questionnaire: this.validators.questionnaire,
      },
      contextQuestionnaire,
      options,
      fhirVersion,
    );
  }

  async validateCompliesWith(
    resource: unknown,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<ValidationIssue[]> {
    if (!isObjectRecord(resource) || resource.resourceType !== 'StructureDefinition') return [];
    return this.validators.compliesWith.validate(resource, fhirVersion);
  }

  private normalizeValidationInput(
    resourceOrContext: unknown,
    context?: StructuralValidationContext,
  ): { resource: StructuralResource; ctx: StructuralValidationContext } {
    let resource: unknown = resourceOrContext;
    let ctx = context;

    if (!ctx && isStructuralValidationContext(resourceOrContext)) {
      ctx = resourceOrContext;
      resource = resourceOrContext.resource;
    }

    if (!isObjectRecord(resource)) throw new Error('Resource not provided or not an object');
    if (!ctx) throw new Error('Validation context not provided');

    return { resource, ctx };
  }

  private configureMustSupportSeverity(settings: unknown): void {
    const severity = isObjectRecord(settings) && settings.validationStrictness === 'strict'
      ? 'warning'
      : 'information';
    this.validators.cardinality.setMustSupportSeverity(severity);
    this.validators.mustSupport.setMustSupportSeverity(severity);
  }

  /**
   * The loader answers `null` for a profile that is not there, so a throw means
   * something else failed. Both used to collapse into "no profile", which skips
   * every snapshot-based check below without a trace.
   */
  private async loadStructureDefinition(
    resource: StructuralResource,
    profileUrl: string | undefined,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): Promise<{ structureDef: StructureDefinition | null; loadFailure?: ValidationIssue }> {
    const profileUrlToUse = profileUrl
      || `http://hl7.org/fhir/StructureDefinition/${String(resource.resourceType)}`;
    try {
      return { structureDef: await this.sdLoader.loadProfile(profileUrlToUse, fhirVersion) };
    } catch (error: unknown) {
      return {
        structureDef: null,
        loadFailure: createProfileUnreadable({
          profileUrl: profileUrlToUse,
          resourceType: String(resource.resourceType ?? 'Resource'),
          reason: 'structural-profile',
          error,
        }),
      };
    }
  }

  private createSnapshotValidationDeps() {
    return {
      cardinalityValidator: this.validators.cardinality,
      typeValidator: this.validators.type,
      elementRulesValidator: this.validators.elementRules,
      complexTypeValidator: this.validators.complexType,
      mustSupportValidator: this.validators.mustSupport,
      referenceFormatValidator: this.validators.referenceFormat,
      referenceTargetValidator: this.validators.referenceTarget,
      bundleValidator: this.validators.bundle,
      questionnaireValidator: this.validators.questionnaire,
      contentReferenceElementsCache: this.contentReferenceElementsCache,
      detectUnknownElements: (
        target: StructuralResource,
        definition: StructureDefinition,
        resourceType: string,
        version: 'R4' | 'R5' | 'R6',
      ) => this.detectUnknownElements(target, definition, resourceType, version),
    };
  }

  private async detectUnknownElements(
    resource: StructuralResource,
    structureDef: StructureDefinition,
    resourceType: string,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<ValidationIssue[]> {
    const index = this.getWalkerSnapshotIndex(structureDef, fhirVersion);
    let typeIndexCache = this.walkerTypeIndexCaches.get(fhirVersion);
    if (!typeIndexCache) {
      typeIndexCache = new BoundedLruCache(128);
      this.walkerTypeIndexCaches.set(fhirVersion, typeIndexCache);
    }
    const deps = makeWalkerDeps(this.sdLoader, fhirVersion, typeIndexCache);
    return detectUnknownProperties(resource, index, resourceType, structureDef.url, deps);
  }

  private getWalkerSnapshotIndex(
    structureDef: StructureDefinition,
    fhirVersion: 'R4' | 'R5' | 'R6',
  ): SnapshotIndex {
    let cache = this.walkerSnapshotIndexCaches.get(fhirVersion);
    if (!cache) {
      cache = new WeakMap();
      this.walkerSnapshotIndexCaches.set(fhirVersion, cache);
    }

    const cached = cache.get(structureDef);
    if (cached) return cached;

    const index = buildSnapshotIndex(structureDef);
    cache.set(structureDef, index);
    return index;
  }
}

function isStructuralValidationContext(value: unknown): value is StructuralValidationContext {
  if (!isObjectRecord(value) || !isObjectRecord(value.resource)) return false;
  if (typeof value.resourceType !== 'string' || !isFhirVersion(value.fhirVersion)) return false;
  if (value.profileUrl !== undefined && typeof value.profileUrl !== 'string') return false;
  if (value.profiles !== undefined && (
    !Array.isArray(value.profiles) || value.profiles.some(profile => typeof profile !== 'string')
  )) return false;
  if (value.getValueAtPath !== undefined && typeof value.getValueAtPath !== 'function') return false;
  if (value.referenceResolver !== undefined && value.referenceResolver !== null
    && typeof value.referenceResolver !== 'function') return false;
  return value.structureDef === undefined || value.structureDef === null
    || isStructureDefinitionLike(value.structureDef);
}

function isFhirVersion(value: unknown): value is StructuralValidationContext['fhirVersion'] {
  return value === 'R4' || value === 'R5' || value === 'R6';
}

function isStructureDefinitionLike(value: unknown): value is StructureDefinition {
  if (!isObjectRecord(value)) return false;
  if (typeof value.url !== 'string' || typeof value.type !== 'string') return false;
  return (value.snapshot === undefined || isObjectRecord(value.snapshot))
    && (value.differential === undefined || isObjectRecord(value.differential));
}

function isObjectRecord(value: unknown): value is StructuralResource {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
