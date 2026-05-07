/* eslint-disable max-lines */
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
import { validateChoiceTypeProperties } from '../../validators/choice-type-property-validator';
import { extractFixedValue, extractPatternValue, matchesPattern, valuesMatch } from '../../validators/slice-utils';
import { getValidationTargets, shouldValidateRequired } from '../../business-rules';
import { getValueAtPath as getValueAtPathUtil } from '../validation-utils';
import { createValidationIssue } from '../../issues';
import { logger } from '../../logger';
import {
  isPrimitiveType as _isPrimitiveType,
  getDirectValue,
  getNestedValue as _getNestedValue,
  isValueEmpty,
  mergeElementConstraints as _mergeElementConstraints
} from './structural-executor-helpers';
import { buildSnapshotIndex, detectUnknownProperties, makeWalkerDeps } from './unknown-property-walker';

// ============================================================================
// Types
// ============================================================================

export interface StructuralValidationContext {
  resource: any;
  resourceType: string;
  profileUrl?: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  structureDef: StructureDefinition;
  getValueAtPath: (resource: any, path: string) => any;
  settings?: any; // ValidationSettings - using any to avoid circular deps or heavy imports
}

function elementRuleMatchesValue(elementDef: any, value: any): boolean {
  const fixed = extractFixedValue(elementDef);
  if (fixed !== undefined && !valuesMatch(value, fixed)) return false;

  const pattern = extractPatternValue(elementDef);
  if (pattern !== undefined && !matchesPattern(value, pattern)) return false;

  return fixed !== undefined || pattern !== undefined;
}

function shouldSkipRulesForSiblingSliceTarget(
  elementDef: any,
  value: any,
  structureDef: StructureDefinition,
): boolean {
  if (!elementDef.id?.includes(':')) return false;
  if (elementRuleMatchesValue(elementDef, value)) return false;

  const siblingRuleElements = structureDef.snapshot?.element.filter(candidate =>
    candidate !== elementDef &&
    candidate.path === elementDef.path &&
    candidate.id?.includes(':') &&
    (extractFixedValue(candidate) !== undefined || extractPatternValue(candidate) !== undefined),
  ) ?? [];

  return siblingRuleElements.some(candidate => elementRuleMatchesValue(candidate, value));
}

function hasElementDefinitionRules(elementDef: Record<string, unknown>): boolean {
  return Object.keys(elementDef).some((key) =>
    key.startsWith('fixed') ||
    key.startsWith('pattern') ||
    key.startsWith('minValue') ||
    key.startsWith('maxValue') ||
    key === 'minLength' ||
    key === 'maxLength'
  );
}

// ============================================================================
// Structural Executor
// ============================================================================

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

  /**
   * Validate structural aspects of a resource
   */
  // eslint-disable-next-line max-lines-per-function
  async validate(
    resourceOrContext: any,
    context?: StructuralValidationContext | any
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      let resource = resourceOrContext;
      let ctx = context;

      // Handle overloading: validate(context)
      // Check if the first argument looks like a context (has resource and resourceType) and second arg is undefined
      if (resourceOrContext && resourceOrContext.resource && resourceOrContext.resourceType && !ctx) {
        ctx = resourceOrContext;
        resource = ctx.resource;
      }

      if (!resource) {
        throw new Error('Resource not provided');
      }

      if (!ctx) {
        throw new Error('Validation context not provided');
      }

      // Extract properties from context
      let { structureDef, profiles, getValueAtPath, settings, fhirVersion } = ctx;
      const profileUrl = profiles?.[0];

      // MustSupport is a capability declaration, not a hard data
      // requirement. Keep it informational unless strict mode is requested.
      const strictness = settings?.validationStrictness || 'standard';
      let severity: 'error' | 'warning' | 'information' = 'warning';

      if (strictness !== 'strict') {
        severity = 'information';
      }

      // Apply to validators
      this.cardinalityValidator.setMustSupportSeverity(severity);
      this.mustSupportValidator.setMustSupportSeverity(severity);

      if (!resource || !resource.resourceType) {
        throw new Error(`Invalid resource in validation context. Context keys: ${Object.keys(ctx).join(', ')}`);
      }

      // Handle different context types
      if (!structureDef) {
        // Multi-aspect batch validator context - need to load StructureDefinition
        // Try the provided profileUrl first (for profile validation), then fall back to base type
        let profileUrlToUse = profileUrl;
        if (!profileUrlToUse) {
          // For structural validation without profile, use base FHIR type
          profileUrlToUse = `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;
        }

        try {
          structureDef = await this.sdLoader.loadProfile(profileUrlToUse, fhirVersion || 'R4');
        } catch {
          // StructureDefinition not available, skip recursive validation
          structureDef = null;
        }
      }

      if (!getValueAtPath) {
        // Use the proper getValueAtPath from validation-utils which correctly handles resource type prefixes
        getValueAtPath = getValueAtPathUtil;
      }


      // Use provided profileUrl or fallback to StructureDefinition URL
      let effectiveProfileUrl = profileUrl;
      if (!effectiveProfileUrl && structureDef?.url) {
        effectiveProfileUrl = structureDef.url;
      }

      // Validate using snapshot elements with array-aware validation
      if (structureDef?.snapshot?.element) {
        // First pass: Validate all elements (cardinality, type, required sub-elements)
        for (const elementDef of structureDef.snapshot.element) {
          const path = elementDef.path;

          // Skip root element
          if (path === resource.resourceType) {
            continue;
          }

          // Skip named slice instances – their type/cardinality constraints apply only to
          // values matching that specific slice discriminator, not to all values at the path.
          // Slice validation is handled by the slicing-validator.
          if (elementDef.sliceName) {
            continue;
          }

          // Skip elements that belong to a slice section via their `id` path
          // (e.g. `Observation.referenceRange:Slice1.type` has no sliceName of
          // its own, but its id encodes the parent slice). The slicing-validator
          // is responsible for those — applying them through the base path
          // produces false positives like "referenceRange.type min=1" being
          // enforced against every array element regardless of which slice it
          // matches.
          if (typeof elementDef.id === 'string' && elementDef.id.includes(':')) {
            continue;
          }

          // Skip deep validation into StructureDefinition snapshot/differential element
          // children. These contain element *definitions* (type constraints, bindings, etc.),
          // not FHIR data that should be validated against the meta-SD's element rules.
          // Without this guard, Records produces hundreds of false positives per SD resource.
          if (resource.resourceType === 'StructureDefinition') {
            const sdDefinitionPaths = [
              'StructureDefinition.snapshot.element.',
              'StructureDefinition.differential.element.',
            ];
            if (sdDefinitionPaths.some(prefix => path.startsWith(prefix))) {
              continue;
            }
          }

          // Skip deep validation into Bundle entry resource children.
          // Bundle.entry.resource is typed as "Resource" — the structural executor should
          // not validate entry resource sub-elements via the Bundle SD. Entry resources
          // need independent validation with their own resource type SD (Phase 5).
          if (resource.resourceType === 'Bundle' && path.match(/^Bundle\.entry\.resource\./)) {
            continue;
          }

          // Same guard for Parameters.parameter.resource (including nested
          // Parameters.parameter.part[.part]*.resource) — the "resource" slot in
          // Parameters.parameter is typed as Resource (polymorphic), and sub-
          // elements must be validated against the inner resource's own SD, not
          // via Parameters' snapshot. Without this guard, validating a Parameters
          // containing a nested resource produces dozens of false-positive
          // required-element errors.
          if (resource.resourceType === 'Parameters' && /^Parameters\.parameter(\.part)*\.resource\./.test(path)) {
            continue;
          }

          // Get validation targets - expands arrays into individual targets
          const validationTargets = getValidationTargets(resource, path);

          if (path.includes('name')) {
            logger.debug(`[StructuralExecutor] Processing ${path}, targets: ${validationTargets.length}`);
            validationTargets.forEach(target => {
              logger.debug(`[StructuralExecutor]   Target: ${target.fullPath}, value exists: ${target.value !== undefined && target.value !== null}`);
            });
          }

          // If no targets, validate with fallback logic using getValueAtPath
          // This ensures that even if getValidationTargets returns empty (e.g. mocked in tests), we still validate
          if (validationTargets.length === 0) {
            const value = getValueAtPath(resource, path);

            // Check if parent element exists before validating child elements
            const shouldValidate = shouldValidateRequired(resource, path);
            if (!shouldValidate) {
              // Skip silently - parent element missing
              continue;
            }

            // Validate cardinality (includes mustSupport check)
            const cardinalityIssues = this.cardinalityValidator.validate(
              value,
              elementDef,
              path,
              effectiveProfileUrl,
              resource
            );
            issues.push(...cardinalityIssues);

            // Validate type (if value exists)
            if (value !== undefined && value !== null) {
              const typeIssues = await this.typeValidator.validate(
                value,
                elementDef.type || [],
                path,
                effectiveProfileUrl
              );
              issues.push(...typeIssues);

              const ruleIssues = this.elementRulesValidator.validate(
                value,
                elementDef,
                path,
                effectiveProfileUrl
              );
              issues.push(...ruleIssues);

              // Recursively validate required sub-elements of complex types
              const complexTypeIssues = await this.complexTypeValidator.validateComplexTypeSubElements(
                value,
                elementDef,
                path,
                effectiveProfileUrl,
                structureDef,
                fhirVersion || 'R4'
              );
              issues.push(...complexTypeIssues);
            } else {
              // Element is missing - check if it's mustSupport
              // But first verify it truly doesn't exist using multiple methods
              if (elementDef.mustSupport === true && shouldValidate) {
                // Use getValidationTargets first (handles arrays correctly)
                const validationTargets = getValidationTargets(resource, path);
                let elementActuallyExists = false;

                if (validationTargets.length > 0) {
                  // Check if any target has a non-empty value
                  const hasNonEmptyValue = validationTargets.some(target => !isValueEmpty(target.value));
                  elementActuallyExists = hasNonEmptyValue;
                }

                // Fallback: Check direct value access
                if (!elementActuallyExists) {
                  const directValue = getDirectValue(resource, path);
                  if (!isValueEmpty(directValue)) {
                    elementActuallyExists = true;
                  }
                }

                // Additional fallback: Use getValueAtPath if available
                if (!elementActuallyExists && getValueAtPath) {
                  try {
                    const pathValue = getValueAtPath(resource, path);
                    if (!isValueEmpty(pathValue)) {
                      elementActuallyExists = true;
                    }
                  } catch {
                    // getValueAtPath might throw for invalid paths, ignore
                  }
                }

                // Only report mustSupport violation if element truly doesn't exist
                if (!elementActuallyExists) {
                  const mustSupportIssues = this.mustSupportValidator.validateMustSupportElement(
                    path,
                    effectiveProfileUrl
                  );
                  issues.push(...mustSupportIssues);
                }
              }
            }
          } else {
            // Cardinality applies to the element's occurrence count *within
            // its parent context*, not to each individual target nor to a
            // flattened total across parent contexts. Group targets by
            // `contextPath` and run the cardinality check once per group:
            //   - `Observation.referenceRange` (min=3, 3 array items, all in
            //     the resource root) → one group, count=3, min=3 passes
            //   - `Observation.referenceRange.high` (max=1, 3 targets across
            //     3 different refs) → three groups with count=1 each, max=1
            //     passes
            // Running it once per target produced spurious
            // "expected at least N, found 1" errors on sliced arrays; running
            // it once on the flat value at the path produced spurious
            // "expected at most 1, found 3" errors on nested leaves.
            const targetsByContext = new Map<string, typeof validationTargets>();
            for (const t of validationTargets) {
              const key = t.contextPath || '';
              const arr = targetsByContext.get(key) || [];
              arr.push(t);
              targetsByContext.set(key, arr);
            }
            for (const [, group] of targetsByContext) {
              const first = group[0];
              const shouldValidateCard = shouldValidateRequired(resource, first.contextPath || first.fullPath);
              if (!shouldValidateCard) continue;
              const count = group.filter(t => t.value !== undefined && t.value !== null).length;
              // Wrap as a length-bearing value so cardinalityValidator's
              // getCount sees the right count without needing a synthetic
              // Array allocation per target.
              const syntheticArray = new Array(count).fill(null);
              const cardinalityIssues = this.cardinalityValidator.validate(
                syntheticArray,
                elementDef,
                path,
                effectiveProfileUrl,
                resource
              );
              issues.push(...cardinalityIssues);
            }

            // Validate each target (array elements)
            for (const target of validationTargets) {
              const targetHasValue = target.value !== undefined && target.value !== null;
              const shouldValidate = shouldValidateRequired(resource, target.fullPath);
              const shouldApplyChoiceElementRules =
                !shouldValidate &&
                targetHasValue &&
                target.fullPath.includes('[x]') &&
                hasElementDefinitionRules(elementDef);

              if (shouldApplyChoiceElementRules) {
                if (!shouldSkipRulesForSiblingSliceTarget(elementDef, target.value, structureDef)) {
                  const ruleIssues = this.elementRulesValidator.validate(
                    target.value,
                    elementDef,
                    target.fullPath,
                    effectiveProfileUrl
                  );
                  issues.push(...ruleIssues);
                }
                continue;
              }

              if (!shouldValidate) {
                // Skip silently - parent element missing
                continue;
              }

              // Validate type (if value exists)
              if (targetHasValue) {
                if (target.fullPath.includes('coding') && target.fullPath.includes('system')) {
                  logger.debug(`[StructuralExecutor Debug] Validating type for ${target.fullPath}, value: ${target.value}`);
                }
                const typeIssues = await this.typeValidator.validate(
                  target.value,
                  elementDef.type || [],
                  target.fullPath,
                  effectiveProfileUrl
                );
                issues.push(...typeIssues);

                if (!shouldSkipRulesForSiblingSliceTarget(elementDef, target.value, structureDef)) {
                  const ruleIssues = this.elementRulesValidator.validate(
                    target.value,
                    elementDef,
                    target.fullPath,
                    effectiveProfileUrl
                  );
                  issues.push(...ruleIssues);
                }

                // Recursively validate required sub-elements of complex types
                const complexTypeIssues = await this.complexTypeValidator.validateComplexTypeSubElements(
                  target.value,
                  elementDef,
                  target.fullPath,
                  effectiveProfileUrl,
                  structureDef,
                  fhirVersion || 'R4'
                );
                issues.push(...complexTypeIssues);
              }
            }

            // If no targets exist but element is mustSupport, validate it
            // THIS BLOCK IS UNLIKELY TO BE HIT if length > 0, but logical to keep
            if (validationTargets.length === 0 && elementDef.mustSupport === true) {
              // ... logic is covered by the else block above (if validationTargets.length === 0)
              // ValidationTargets.length > 0 here, so we skip this
            }
          }
        }

        // Second pass: Explicitly validate all mustSupport elements that might have been missed
        // Track which paths we've already checked to avoid duplicates
        const checkedPaths = new Set<string>();
        for (const issue of issues) {
          if (issue.code === 'mustsupport-missing' && issue.path) {
            checkedPaths.add(issue.path);
          }
        }

        const mustSupportIssues = await this.mustSupportValidator.validateAllMustSupportElements(
          resource,
          structureDef,
          effectiveProfileUrl || '',
          getValueAtPath,
          checkedPaths
        );
        issues.push(...mustSupportIssues);

        // Third pass: Detect unknown elements (properties not in StructureDefinition)
        const unknownElementIssues = await this.detectUnknownElements(
          resource,
          structureDef,
          resource.resourceType,
          fhirVersion,
        );
        issues.push(...unknownElementIssues);

        // Fourth pass: Validate reference format strings
        const referenceFormatIssues = this.referenceFormatValidator.validateAllReferences(
          resource,
          resource.resourceType
        );
        issues.push(...referenceFormatIssues);

        // Fourth-and-a-half pass: Validate reference *target types* against
        // ElementDefinition.type[].targetProfile. The format validator
        // above only checks reference strings syntactically; this one
        // enforces the profile's semantic constraint that e.g.
        // `Encounter.subject` must point at a Patient or Group.
        const referenceTargetIssues = this.referenceTargetValidator.validate(
          resource,
          structureDef
        );
        issues.push(...referenceTargetIssues);

        // Sixth pass: Validate Bundle-specific rules (for Bundle resources only)
        if (resource.resourceType === 'Bundle') {
          const bundleIssues = await this.bundleValidator.validateBundle(resource);
          issues.push(...bundleIssues);
        }

        // Seventh pass: Questionnaire / QuestionnaireResponse validation
        if (resource.resourceType === 'Questionnaire') {
          issues.push(...this.questionnaireValidator.validateQuestionnaire(resource));
        } else if (resource.resourceType === 'QuestionnaireResponse') {
          issues.push(...this.questionnaireValidator.validateQuestionnaireResponse(resource));
        }
      }

      // Seventh pass: Resource id format + empty array checks + attachment
      // size/data consistency (post-SD sanity checks that don't depend on the
      // profile snapshot)
      issues.push(...this.validateResourceIdAndArrays(resource));

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

  /**
   * Validate required fields only (for validateStructure method)
   */
  // eslint-disable-next-line max-lines-per-function
  async validateRequiredFields(
    resource: any,
    structureDef: StructureDefinition,
    profileUrl: string,
    getValueAtPath: (resource: any, path: string) => any,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4'
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      if (structureDef.snapshot?.element) {
        // Validate required fields (min > 0) with array-aware validation
        for (const elementDef of structureDef.snapshot.element) {
          // Skip named slice instances – handled by slicing validator
          if (elementDef.sliceName) continue;

          // Skip slice-scoped sub-elements (id like `Foo.bar:Slice1.baz`).
          // Same rationale as in validate(): these constraints apply to a
          // specific slice and must not be run against the base path.
          if (typeof elementDef.id === 'string' && elementDef.id.includes(':')) continue;

          // Skip SD definition children (same guard as main validate)
          if (resource.resourceType === 'StructureDefinition') {
            if (elementDef.path.startsWith('StructureDefinition.snapshot.element.') ||
                elementDef.path.startsWith('StructureDefinition.differential.element.')) {
              continue;
            }
          }

          // Skip Bundle entry resource children (same guard as main validate)
          if (resource.resourceType === 'Bundle' && elementDef.path.match(/^Bundle\.entry\.resource\./)) {
            continue;
          }

          // Skip Parameters.parameter.resource children (same guard as main validate)
          if (resource.resourceType === 'Parameters' && /^Parameters\.parameter(\.part)*\.resource\./.test(elementDef.path)) {
            continue;
          }

          if (elementDef.min && elementDef.min > 0) {
            const path = elementDef.path;

            // Get validation targets - expands arrays into individual targets
            const validationTargets = getValidationTargets(resource, path);

            // If no targets found, check if this path should be validated at all
            if (validationTargets.length === 0) {
              // No targets means the path doesn't exist according to getValidationTargets
              // Fallback to getValueAtPath for simple properties
              const value = getValueAtPath(resource, path);

              // Java flags a required (min >= 1) element whose value is an
              // empty array `[]` as "minimum required = N, but only found 0".
              // getValidationTargets returns zero targets for an empty array
              // (the fork loop runs 0 times), and getValueAtPath never
              // descends into `[]`, so both paths miss this case without
              // an explicit check on the direct property.
              const directValue = getDirectValue(resource, path);
              const isEmptyArray = Array.isArray(directValue) && directValue.length === 0;

              if (value === undefined || value === null || isEmptyArray) {
                // Check if parent exists to determine if this is required
                if (shouldValidateRequired(resource, path)) {
                  issues.push({
                    id: `records-required-${path}-${Date.now()}`,
                    aspect: 'structural',
                    severity: 'error',
                    code: 'required-element-missing',
                    message: `Required element '${path}' is missing`,
                    path,
                    timestamp: new Date(),
                    profile: profileUrl
                  });
                }
              } else {
                // Value exists, so we should check sub-elements if complex
                const complexTypeIssues = await this.complexTypeValidator.validateComplexTypeSubElements(
                  value,
                  elementDef,
                  path,
                  profileUrl, // validateRequiredFields has its own profileUrl arg
                  structureDef,
                  fhirVersion
                );
                issues.push(...complexTypeIssues);
              }
            } else {
              // Validate each target (e.g., each array element)
              for (const target of validationTargets) {
                if (target.value === undefined || target.value === null) {
                  // Check if parent exists for this specific target
                  if (shouldValidateRequired(resource, target.contextPath)) {
                    issues.push({
                      id: `records-required-${target.fullPath}-${Date.now()}`,
                      aspect: 'structural',
                      severity: 'error',
                      code: 'required-element-missing',
                      message: `Required element '${target.fullPath}' is missing`,
                      path: target.fullPath,
                      timestamp: new Date(),
                      profile: profileUrl
                    });
                  }
                } else {
                  // If target exists, check if it's a complex type that needs recursive validation
                  const complexTypeIssues = await this.complexTypeValidator.validateComplexTypeSubElements(
                    target.value,
                    elementDef,
                    target.fullPath,
                    profileUrl,
                    structureDef,
                    fhirVersion
                  );
                  issues.push(...complexTypeIssues);
                }
              }
            }
          }
        }
      }

      return issues;

    } catch (error) {
      logger.error('[StructuralExecutor] Required fields validation error:', error);
      return [{
        id: `structural-required-error-${Date.now()}`,
        aspect: 'structural',
        severity: 'error',
        code: 'validation-error',
        message: `Required fields validation failed: ${error instanceof Error ? error.message : String(error)}`,
        path: '',
        timestamp: new Date()
      }];
    }
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
    const deps = makeWalkerDeps(this.sdLoader, fhirVersion);
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
    const rt = resource?.resourceType || 'Resource';
    const out = [
      ...this.validateResourceId(resource, rt),
      ...this.validateContainedResourceIdsPresent(resource, rt),
      ...this.validateUniqueContainedResourceIds(resource, rt),
      ...this.validateUniqueElementIds(resource, rt),
      ...this.validateNoEmptyArrays(resource, rt),
      ...this.validateContainedResourcesReferenced(resource, rt),
      ...this.attachmentValidator.validate(resource),
      // Name-as-identifier invariant (mea-0 / cnl-0 / csd-0 / vsd-0 / …)
      // applies uniformly across canonical / knowledge-artifact resources.
      ...this.canonicalResourceInvariantValidator.validate(resource),
      // StructureDefinition-specific business rules (WG consistency,
      // status/standards-status, root slicing, element names, etc.)
      ...this.structureDefinitionValidator.validate(resource),
      // HTML-in-string detection for security (Narrative.div is exempted).
      ...this.stringSecurityValidator.validate(resource),
      // Narrative XHTML validation (namespace, well-formedness, allowed
      // elements/attributes). Runs in both full-validate and
      // validateStructure paths so lightweight structural checks still
      // catch XHTML errors.
      ...this.narrativeValidator.validateNarrative(resource, rt),
      // Whitespace-only primitive check (matches Java validator)
      ...this.validateWhitespaceOnlyPrimitives(resource, rt),
      // Orphan primitive-extension sidecars: `_value: {...}` with no
      // companion `value: ...` at the same level. FHIR allows the
      // sidecar-only form only when it carries a data-absent-reason
      // extension; otherwise the resource is malformed.
      ...this.validateOrphanPrimitiveSidecars(resource, rt),
    ];
    // Questionnaire invariants (que-0 … que-12) run on Questionnaire and on
    // any contained Questionnaire inside a QuestionnaireResponse. These
    // invariants are independent of the profile snapshot so they belong
    // alongside the other "post-SD sanity" checks.
    if (rt === 'Questionnaire' || rt === 'QuestionnaireResponse') {
      out.push(...this.questionnaireValidator.validateAnyResource(resource, contextQuestionnaire));
    }
    return out;
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

  /**
   * Walk all string primitives in a resource and warn when a value
   * consists entirely of whitespace. Matches Java validator behaviour
   * ("Primitive types should not only be whitespace").
   */
  private validateWhitespaceOnlyPrimitives(
    resource: any,
    resourceType: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    // Unicode-aware whitespace pattern matching Java's check
    const wsOnly = /^\s+$/;

    const walk = (obj: any, path: string) => {
      if (obj == null || typeof obj !== 'object') return;
      for (const [key, val] of Object.entries(obj)) {
        // Skip meta-properties and narrative (div is XHTML, not a primitive)
        if (key === 'resourceType' || key === 'div' || key.startsWith('_')) continue;
        const childPath = path ? `${path}.${key}` : key;
        if (typeof val === 'string' && val.length > 0 && wsOnly.test(val)) {
          issues.push(createValidationIssue({
            code: 'invalid',
            path: childPath,
            resourceType,
            customMessage: 'Primitive types should not only be whitespace',
            severityOverride: 'warning',
          }));
        } else if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            const item = val[i];
            if (typeof item === 'string' && item.length > 0 && wsOnly.test(item)) {
              issues.push(createValidationIssue({
                code: 'invalid',
                path: `${childPath}[${i}]`,
                resourceType,
                customMessage: 'Primitive types should not only be whitespace',
                severityOverride: 'warning',
              }));
            } else if (item && typeof item === 'object') {
              walk(item, `${childPath}[${i}]`);
            }
          }
        } else if (typeof val === 'object') {
          walk(val, childPath);
        }
      }
    };

    walk(resource, resourceType);
    return issues;
  }

  /**
   * Detect orphaned primitive-extension sidecars. FHIR lets a primitive
   * element carry additional extensions via an underscore-prefixed twin
   * (`status` + `_status: { extension: [...] }`). When the twin exists
   * WITHOUT the primitive AND also without a `data-absent-reason`
   * extension on the sidecar, the instance is malformed — the sidecar is
   * orphaned. Java's reference validator flags this as
   * "The property 'X' is invalid" (see Observation-ex-pain fixture where
   * `_valueInteger: {value: 0}` appears with no `valueInteger`).
   *
   * Scope: top-level resource keys only. Nested sidecars (e.g. inside
   * arrays) are rare and covered by the wider structural walker.
   */
  private validateOrphanPrimitiveSidecars(
    resource: any,
    resourceType: string,
  ): ValidationIssue[] {
    if (!resource || typeof resource !== 'object') return [];
    const issues: ValidationIssue[] = [];

    const DATA_ABSENT = 'http://hl7.org/fhir/StructureDefinition/data-absent-reason';

    for (const key of Object.keys(resource)) {
      if (!key.startsWith('_') || key.length < 2) continue;
      // Keys like `_valueInteger`, `_status`, `_birthDate`.
      const primitiveKey = key.slice(1);
      if (primitiveKey in resource) continue; // twin present — valid pair.

      const sidecar = resource[key];
      // A legitimate sidecar-only form carries data-absent-reason (or
      // another extension that conveys WHY the primitive is absent).
      const extensions = Array.isArray(sidecar?.extension) ? sidecar.extension : [];
      const hasDataAbsent = extensions.some(
        (ext: any) => typeof ext?.url === 'string' && ext.url === DATA_ABSENT,
      );
      if (hasDataAbsent) continue;

      issues.push(createValidationIssue({
        code: 'structural-orphan-primitive-extension',
        path: `${resourceType}.${primitiveKey}`,
        resourceType,
        customMessage:
          `The property '${primitiveKey}' is invalid: primitive-extension sidecar '${key}' is present without a matching '${primitiveKey}' value. ` +
          `Sidecar-only form is valid only when it carries a data-absent-reason extension.`,
        severityOverride: 'error',
        details: { orphanKey: key, expectedKey: primitiveKey },
      }));
    }

    return issues;
  }

  /**
   * Validate resource id format per FHIR R4 spec.
   * FHIR id regex: [A-Za-z0-9\-\.]{1,64}
   */
  private validateResourceId(resource: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const ID_REGEX = /^[A-Za-z0-9\-.]{1,64}$/;

    // Validate root resource id
    if (resource.id !== undefined && resource.id !== null) {
      const id = String(resource.id);
      if (!ID_REGEX.test(id)) {
        const reason = id.length > 64
          ? `Too long (${id.length} chars)`
          : `Invalid Characters ('${id}')`;
        issues.push(createValidationIssue({
          code: 'structural-invalid-id',
          path: `${resourceType}.id`,
          resourceType,
          customMessage: `Invalid Resource id: ${reason}`,
          severityOverride: 'error',
        }));
      }
    }

    // Validate contained resource ids
    if (Array.isArray(resource.contained)) {
      for (let i = 0; i < resource.contained.length; i++) {
        const contained = resource.contained[i];
        if (contained?.id !== undefined && contained?.id !== null) {
          const id = String(contained.id);
          if (!ID_REGEX.test(id)) {
            const reason = id.length > 64
              ? `Too long (${id.length} chars)`
              : `Invalid Characters ('${id}')`;
            const cType = contained.resourceType || 'Resource';
            issues.push(createValidationIssue({
              code: 'structural-invalid-id',
              path: `${resourceType}.contained[${i}]/*${cType}/${id}*/.id`,
              resourceType,
              customMessage: `Invalid Resource id: ${reason}`,
              severityOverride: 'error',
            }));
          }
        }
      }
    }

    return issues;
  }

  private validateUniqueContainedResourceIds(resource: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!Array.isArray(resource.contained)) return issues;

    const firstIndexById = new Map<string, number>();
    for (let i = 0; i < resource.contained.length; i++) {
      const contained = resource.contained[i];
      if (contained?.id === undefined || contained?.id === null) continue;

      const id = String(contained.id);
      const firstIndex = firstIndexById.get(id);
      if (firstIndex !== undefined) {
        issues.push(createValidationIssue({
          code: 'duplicate',
          path: `${resourceType}.contained[${i}]/*${contained.resourceType || 'Resource'}/${id}*/`,
          resourceType,
          customMessage: `Duplicate ID for contained resource: ${id}`,
          severityOverride: 'error',
        }));
        continue;
      }

      firstIndexById.set(id, i);
    }

    return issues;
  }

  /**
   * FHIR rule (per Element.id): backbone-element ids are unique within
   * their containing Resource. Java emits "Duplicate id value 'X'" on the
   * second-and-later occurrence (see mni-patientOverview-bundle-example1b
   * baseline, where Bundle.entry[0].id = Bundle.entry[2].id = '1a' and
   * Patient.identifier[].id = Patient.name[].id = '2').
   *
   * Scope: this resource only. Each contained resource and each
   * `Bundle.entry[].resource` (or any other "Resource"-typed sub-tree)
   * starts its own id namespace and is validated separately. The
   * resource's own top-level Resource.id is excluded (it's the logical
   * id, not an element id).
   *
   * Skipped on StructureDefinition because `snapshot.element[].id` and
   * `differential.element[].id` legitimately share values (both refer to
   * the same logical element-path) and Java doesn't flag them.
   */
  private validateUniqueElementIds(resource: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!resource || typeof resource !== 'object') return issues;
    if (resourceType === 'StructureDefinition') return issues;

    const seen = new Map<string, string>(); // id value → first path (currently unused for path)

    const walk = (node: any, path: string, isResourceRoot: boolean): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          walk(node[i], `${path}[${i}]`, false);
        }
        return;
      }

      // A nested object that carries `resourceType` is a sub-Resource —
      // it has its own id namespace and is excluded from the parent's
      // duplicate-id scan. (`contained[]` and `Bundle.entry[].resource`
      // are the common cases.)
      if (typeof node.resourceType === 'string' && !isResourceRoot) return;

      for (const key of Object.keys(node)) {
        if (key === 'contained') continue;
        if (key === 'id' && typeof node.id === 'string' && !isResourceRoot) {
          const value = node.id;
          if (seen.has(value)) {
            issues.push(createValidationIssue({
              code: 'structural-duplicate-element-id',
              path,
              resourceType,
              customMessage: `Duplicate id value '${value}'`,
              severityOverride: 'error',
            }));
          } else {
            seen.set(value, path);
          }
          continue;
        }
        walk(node[key], path ? `${path}.${key}` : key, false);
      }
    };

    walk(resource, resourceType, /* isResourceRoot */ true);
    return issues;
  }

  private validateContainedResourceIdsPresent(resource: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!Array.isArray(resource.contained)) return issues;

    for (let i = 0; i < resource.contained.length; i++) {
      const contained = resource.contained[i];
      if (contained?.id !== undefined && contained?.id !== null && contained.id !== '') continue;

      issues.push(createValidationIssue({
        code: 'invalid',
        path: `${resourceType}.contained[${i}]/*${contained?.resourceType || 'Resource'}/null*/`,
        resourceType,
        customMessage: 'Resource requires an id, but none is present',
        severityOverride: 'error',
      }));
    }

    return issues;
  }

  /**
   * FHIR rule: every contained resource MUST be referenced from somewhere
   * in the parent resource. A contained resource that is not referenced
   * is a "dangling" contained resource and the Java validator flags it as
   * an error.
   */
  private validateContainedResourcesReferenced(resource: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!Array.isArray(resource.contained) || resource.contained.length === 0) return issues;

    // Collect all contained ids
    const containedIds = new Map<string, number>();
    for (let i = 0; i < resource.contained.length; i++) {
      const c = resource.contained[i];
      containedIds.set(c?.id ? String(c.id) : 'null', i);
    }
    if (containedIds.size === 0) return issues;

    // Collect all #id references in the full resource tree. References inside
    // contained resources can legitimately point at sibling contained resources
    // (for example a contained Questionnaire answerValueSet="#vs").
    // A contained resource can be referenced from Reference.reference ("#id"),
    // canonical fields like answerValueSet ("#id"), or any other string-valued
    // property that starts with "#". We therefore scan ALL string values.
    const referencedIds = new Set<string>();
    const collectRefs = (obj: any, skipContained: boolean): void => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (typeof item === 'string' && item.startsWith('#') && item.length > 1) {
            referencedIds.add(item.substring(1));
          } else {
            collectRefs(item, false);
          }
        }
        return;
      }
      for (const key of Object.keys(obj)) {
        if (skipContained && key === 'contained') continue;
        const val = obj[key];
        if (typeof val === 'string' && val.startsWith('#') && val.length > 1) {
          referencedIds.add(val.substring(1));
        } else {
          collectRefs(val, false);
        }
      }
    };
    collectRefs(resource, false);

    // Flag any contained resource whose id is not referenced
    for (const [id, idx] of containedIds) {
      if (!referencedIds.has(id)) {
        issues.push(createValidationIssue({
          code: 'invalid',
          path: `${resourceType}.contained[${idx}]`,
          resourceType,
          customMessage: `The contained resource '${id}' is not referenced to from elsewhere in the containing resource nor does it refer to the containing resource`,
          severityOverride: 'error',
        }));
      }
    }

    return issues;
  }

  /**
   * Detect empty arrays in the resource JSON.
   * FHIR JSON representation does not allow empty arrays — they must be omitted.
   */
  private validateNoEmptyArrays(resource: any, resourceType: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    this.findEmptyArrays(resource, resourceType, issues);
    return issues;
  }

  private findEmptyArrays(obj: any, path: string, issues: ValidationIssue[]): void {
    if (!obj || typeof obj !== 'object') return;

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const currentPath = `${path}.${key}`;

      if (Array.isArray(value)) {
        if (value.length === 0) {
          issues.push(createValidationIssue({
            code: 'structural-empty-array',
            path: currentPath,
            resourceType: path.split('.')[0],
            customMessage: `Array cannot be empty - omit the property instead`,
            severityOverride: 'error',
          }));
        } else {
          // Check array elements for empty objects and nested empty arrays.
          // Java rejects `{}` inside a backbone array (e.g. `entry: [{}]`)
          // with "Object must have some content" — the element exists but
          // carries no fields, so no invariants or required sub-elements
          // can be satisfied.
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              if (Object.keys(item).length === 0) {
                issues.push(createValidationIssue({
                  code: 'structural-empty-object',
                  path: `${currentPath}[${i}]`,
                  resourceType: path.split('.')[0],
                  customMessage: 'Element must have some content',
                  severityOverride: 'error',
                }));
              } else {
                this.findEmptyArrays(item, `${currentPath}[${i}]`, issues);
              }
            }
          }
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.findEmptyArrays(value, currentPath, issues);
      }
    }
  }
}
