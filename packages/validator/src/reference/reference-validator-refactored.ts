/**
 * Reference Validator (Refactored)
 * 
 * Main orchestrator for reference validation.
 * Coordinates all reference validation sub-components.
 * 
 * Refactored from single 1,083-line file into modular structure following global.mdc guidelines.
 * 
 * REFACTORED STRUCTURE:
 * - reference-validator-refactored.ts (orchestrator, ~400 lines)
 * - reference-types.ts (shared types)
 * - reference-field-definitions.ts (field definitions)
 * - reference-format-validator.ts (format validation)
 * - reference-utils.ts (utility functions)
 * 
 * EXISTING UTILITIES (already modular):
 * - reference-type-extractor.ts
 * - reference-type-constraint-validator.ts
 * - contained-reference-resolver.ts
 * - bundle-reference-resolver.ts
 * - circular-reference-detector.ts
 * - recursive-reference-validator.ts
 * - version-specific-reference-validator.ts
 * - canonical-reference-validator.ts
 * - batched-reference-checker.ts
 */

import type { ValidationResult, ValidationSettings } from '@records-fhir/validation-types';
import type { IReferenceValidator, ValidationContext, ValidationIssue } from '../types';
import { addR6WarningIfNeeded } from '../utils/r6-support-warnings';
import { ReferenceTypeExtractor } from './reference-type-extractor';
import { getReferenceTypeConstraintValidator } from './reference-type-constraint-validator';
import { getContainedReferenceResolver } from './contained-reference-resolver';
import { getBundleReferenceResolver } from './bundle-reference-resolver';
import { getCircularReferenceDetector } from './circular-reference-detector';
import { getRecursiveReferenceValidator } from './recursive-reference-validator';
import { getVersionSpecificReferenceValidator } from './version-specific-reference-validator';
import { getCanonicalReferenceValidator } from './canonical-reference-validator';
import { getBatchedReferenceChecker } from './batched-reference-checker';
import { extractReferences } from './reference-format-validator';
import { parseReference } from './reference-type-extractor';
import { validateContainedReferenceIssues } from './reference-contained-validation';
import { validateExtractedReferences } from './reference-extracted-validation';
import {
  buildRecursiveReferenceIssues,
  buildReferencePathsByValue,
} from './reference-recursive-issues';
import {
  getRecursiveValidationConfig,
  normalizeReferenceValidationArgs,
} from './reference-validation-args';
import { createReferenceValidationIssue } from './reference-utils';
import { logger } from '../logger';

// ============================================================================
// Reference Validator (Refactored)
// ============================================================================

export class ReferenceValidator implements IReferenceValidator {
  private referenceTypeExtractor: ReferenceTypeExtractor;
  private constraintValidator = getReferenceTypeConstraintValidator();
  private containedResolver = getContainedReferenceResolver();
  private bundleResolver = getBundleReferenceResolver();
  private circularDetector = getCircularReferenceDetector(10);
  private recursiveValidator = getRecursiveReferenceValidator();
  private versionValidator = getVersionSpecificReferenceValidator();
  private canonicalValidator = getCanonicalReferenceValidator();
  private batchedChecker = getBatchedReferenceChecker();

  constructor() {
    this.referenceTypeExtractor = new ReferenceTypeExtractor({
      allowContained: true,
      allowCanonical: true,
      extractVersion: true,
      validateResourceType: true
    });
  }

  /**
   * Validate references - interface compliant method
   */
  async validate(
    resource: any,
    context: ValidationContext
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    const version = context.fhirVersion || 'R4';

    const issues = await this.validateInternal(
      resource,
      context.resourceType,
      version,
      context.settings
    );

    const validationTime = Date.now() - startTime;
    const isValid = issues.length === 0 || !issues.some(i => i.severity === 'error');

    return {
      resourceId: context.resourceId || resource.id || 'unknown',
      resourceType: context.resourceType,
      isValid,
      issues,
      aspects: [{
        aspect: 'reference',
        isValid,
        issues,
        validationTime,
        status: 'completed'
      }],
      validatedAt: new Date(),
      validationTime,
      fhirVersion: version
    };
  }

  /**
   * Internal validation method (supports multiple signatures for backward compatibility)
   */
  async validateInternal(
    resource: any,
    resourceType: string,
    fhirClientOrVersion?: any, // Can be FhirClient or FHIR version string
    fhirVersionOrSettings?: 'R4' | 'R5' | 'R6' | ValidationSettings,
    settings?: ValidationSettings
  ): Promise<ValidationIssue[]> {
    let issues: ValidationIssue[] = [];
    const startTime = Date.now();

    if (!resource) {
      logger.warn(`[ReferenceValidator] Null resource provided`);
      return issues;
    }

    const { fhirVersion, actualSettings } = normalizeReferenceValidationArgs(
      fhirClientOrVersion,
      fhirVersionOrSettings,
      settings,
    );
    resourceType = resourceType || resource.resourceType || 'Unknown';

    logger.debug(`[ReferenceValidator] Validating ${resourceType} references...`);

    try {
      if (fhirVersion === 'R6') {
        issues = addR6WarningIfNeeded(issues, fhirVersion, 'reference');
      }

      const extractedRefs = extractReferences(resource, resourceType);
      if (extractedRefs.length === 0) {
        logger.debug(`[ReferenceValidator] No references found in ${resourceType}`);
        return issues;
      }

      logger.debug(`[ReferenceValidator] Found ${extractedRefs.length} references to validate`);
      const referencePathsByValue = buildReferencePathsByValue(extractedRefs);
      issues.push(...validateExtractedReferences(extractedRefs, resourceType, this.constraintValidator));
      issues.push(...await this.validateContainedReferences(resource, resourceType));
      issues.push(...await this.validateRecursiveReferences(
        resource,
        resourceType,
        actualSettings,
        referencePathsByValue,
        createResourceFetcher(fhirClientOrVersion),
      ));

      const validationTime = Date.now() - startTime;
      const logReferenceResult = validationTime > 100 ? logger.info.bind(logger) : logger.debug.bind(logger);
      logReferenceResult(
        `[ReferenceValidator] Validated ${resourceType} references in ${validationTime}ms ` +
        `(${issues.length} issues)`
      );

      return issues;

    } catch (error) {
      logger.error('[ReferenceValidator] Error validating references:', error);

      issues.push(createReferenceValidationIssue({
        code: 'reference-validation-error',
        severity: 'error',
        message: `Reference validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        humanReadable: 'Reference validation encountered an error',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          resourceType
        },
        resourceType
      }));

      return issues;
    }
  }

  private async validateRecursiveReferences(
    resource: any,
    resourceType: string,
    settings: ValidationSettings | undefined,
    referencePathsByValue: Map<string, string[]>,
    resourceFetcher?: (reference: string) => Promise<any>,
  ): Promise<ValidationIssue[]> {
    const recursiveConfig = getRecursiveValidationConfig(settings);
    if (!recursiveConfig.enabled) return [];

    logger.debug(`[ReferenceValidator] Recursive validation enabled (maxDepth: ${recursiveConfig.maxDepth})`);
    try {
      const recursiveResult = await this.recursiveValidator.validateRecursively(resource, recursiveConfig, resourceFetcher);
      const issues = buildRecursiveReferenceIssues(recursiveResult, recursiveConfig.timeoutMs, resourceType, referencePathsByValue);

      logger.debug(
        `[ReferenceValidator] Recursive validation: ${recursiveResult.totalResourcesValidated} resources, ` +
        `depth ${recursiveResult.maxDepthReached}, ${recursiveResult.referencesFollowed} refs followed` +
        (recursiveResult.timedOut ? ' (TIMED OUT)' : '')
      );
      return issues;
    } catch (recursiveError) {
      logger.error('[ReferenceValidator] Recursive validation error:', recursiveError);
      return [];
    }
  }

  /**
   * Validate contained references
   */
  private async validateContainedReferences(resource: any, resourceType: string): Promise<ValidationIssue[]> {
    return validateContainedReferenceIssues(resource, resourceType);
  }

  /**
   * Extract resource type from reference (public API)
   */
  public extractResourceType(reference: string): string | null {
    return this.referenceTypeExtractor.extractResourceType(reference);
  }

  // ============================================================================
  // Delegation Methods - Expose utility functionality
  // ============================================================================

  /**
   * Parse reference (delegates to ReferenceTypeExtractor)
   */
  public parseReference(reference: string) {
    return this.referenceTypeExtractor.parseReference(reference);
  }

  /**
   * Validate reference type constraint (delegates to constraint validator)
   */
  public validateReferenceTypeConstraint(reference: string, resourceType: string, fieldPath: string) {
    return this.constraintValidator.validateReferenceType(reference, resourceType, fieldPath);
  }

  /**
   * Check if field has type constraints
   */
  public hasTypeConstraints(resourceType: string, fieldPath: string) {
    return this.constraintValidator.hasConstraints(resourceType, fieldPath);
  }

  /**
   * Get field constraints
   */
  public getFieldConstraints(resourceType: string, fieldPath: string) {
    return this.constraintValidator.getConstraintsForField(resourceType, fieldPath);
  }

  /**
   * Resolve contained reference (delegates to contained resolver)
   */
  public resolveContainedReference(reference: string, parentResource: any, expectedType?: string) {
    return this.containedResolver.resolveContainedReference(reference, parentResource, expectedType);
  }

  /**
   * Get contained resources
   */
  public getContainedResources(resource: any) {
    return this.containedResolver.extractContainedResources(resource);
  }

  /**
   * Validate contained references in resource synchronously (public method for tests)
   */
  public validateContainedReferencesSync(resource: any) {
    return validateContainedReferenceIssues(resource);
  }

  /**
   * Resolve bundle reference (delegates to bundle resolver)
   */
  public resolveBundleReference(reference: string, bundle: any) {
    return this.bundleResolver.resolveBundleReference(reference, bundle);
  }

  /**
   * Validate bundle references
   */
  public validateBundleReferences(bundle: any) {
    const result = this.bundleResolver.validateBundleReferences(bundle);
    // Return issues array for backward compatibility
    return result.issues || [];
  }

  /**
   * Detect circular references (delegates to circular detector)
   */
  public detectCircularReferences(resource: any, startingReferences?: string[]) {
    return this.circularDetector.detectCircularReferences(resource, startingReferences);
  }

  /**
   * Check if adding reference would create cycle
   */
  public wouldCreateCircularReference(currentPath: string[], newReference: string) {
    return this.circularDetector.wouldCreateCircularReference(currentPath, newReference);
  }

  /**
   * Get recursive validation config from settings or defaults
   */
  public getRecursiveValidationConfig(settings?: ValidationSettings) {
    return getRecursiveValidationConfig(settings);
  }

  /**
   * Estimate recursive validation cost
   */
  public estimateRecursiveValidationCost(..._args: any[]) {
    // Return default cost estimate
    return {
      estimatedResources: 0,
      estimatedReferences: 0,
      estimatedTimeMs: 0,
      maxDepth: 0,
      feasible: true
    };
  }

  /**
   * Validate recursively
   */
  public validateRecursively(resource: any, config?: any, resourceFetcher?: (ref: string) => Promise<any>) {
    return this.recursiveValidator.validateRecursively(resource, config, resourceFetcher);
  }

  /**
   * Parse versioned reference
   */
  public parseVersionedReference(reference: string) {
    return this.versionValidator.parseVersionedReference(reference);
  }

  /**
   * Validate versioned reference
   */
  public validateVersionedReference(reference: string) {
    return this.versionValidator.validateVersionedReference(reference);
  }

  /**
   * Check version consistency
   */
  public checkVersionConsistency(references: string[]) {
    return this.versionValidator.checkVersionConsistency(references);
  }

  /**
   * Extract versioned references from resource
   */
  public extractVersionedReferences(resource: any) {
    return this.versionValidator.extractVersionedReferences(resource);
  }

  /**
   * Validate bundle version integrity
   */
  public validateBundleVersionIntegrity(bundle: any) {
    return this.versionValidator.validateBundleVersionIntegrity(bundle);
  }

  /**
   * Parse canonical URL
   */
  public parseCanonicalUrl(canonical: string) {
    return this.canonicalValidator.parseCanonicalUrl(canonical);
  }

  /**
   * Validate canonical URL
   */
  public validateCanonicalUrl(canonical: string) {
    return this.canonicalValidator.validateCanonicalUrl(canonical);
  }

  /**
   * Validate profile canonical
   */
  public validateProfileCanonical(canonical: string) {
    return this.canonicalValidator.validateProfileCanonical(canonical);
  }

  /**
   * Validate value set canonical
   */
  public validateValueSetCanonical(canonical: string) {
    return this.canonicalValidator.validateValueSetCanonical(canonical);
  }

  /**
   * Extract canonical URLs from resource
   */
  public extractCanonicalUrls(resource: any) {
    return this.canonicalValidator.extractCanonicalUrls(resource);
  }

  /**
   * Validate resource canonicals
   */
  public validateResourceCanonicals(resource: any) {
    return this.canonicalValidator.validateResourceCanonicals(resource);
  }

  /**
   * Validate bundle canonicals
   */
  public validateBundleCanonicals(bundle: any) {
    return this.canonicalValidator.validateBundleCanonicals(bundle);
  }

  /**
   * Check batch references (delegates to batched checker)
   */
  public async checkBatchReferences(references: any[], config?: any) {
    return this.batchedChecker.checkBatch(references, config);
  }

  /**
   * Check resource references
   */
  public async checkResourceReferences(resource: any, config?: any) {
    return this.batchedChecker.checkResourceReferences(resource, config);
  }

  /**
   * Check bundle reference existence
   */
  public checkBundleReferenceExistence(bundle: any, config?: any) {
    return this.batchedChecker.checkBundleReferences(bundle, config);
  }

  /**
   * Filter existing references
   */
  public filterExistingReferences(references: string[], config?: any) {
    return this.batchedChecker.filterExistingReferences(references, config);
  }
}

function createResourceFetcher(fhirClientOrVersion: any): ((reference: string) => Promise<any>) | undefined {
  if (!fhirClientOrVersion || typeof fhirClientOrVersion !== 'object') return undefined;
  if (typeof fhirClientOrVersion.getResource !== 'function') return undefined;

  return async (reference: string) => {
    const parsed = parseReference(reference);
    if (!parsed.isValid || !parsed.resourceType || !parsed.resourceId) return null;
    return fhirClientOrVersion.getResource(parsed.resourceType, parsed.resourceId);
  };
}
