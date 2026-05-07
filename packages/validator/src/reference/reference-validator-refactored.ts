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

import type { ValidationIssue } from '../types';
import type { ValidationResult, ValidationSettings } from '@records-fhir/validation-types';
import type { IReferenceValidator, ValidationContext } from '../types';
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
import { applyStrictnessSeverity as _applyStrictnessSeverity } from '../strictness';
import { initializeReferenceFields, getReferenceFields as _getReferenceFields } from './reference-field-definitions';
import { validateReferenceFormat, extractReferences } from './reference-format-validator';
import { createReferenceValidationIssue, getFieldValue as _getFieldValue } from './reference-utils';
import { logger } from '../logger';

// ============================================================================
// Reference Validator (Refactored)
// ============================================================================

export class ReferenceValidator implements IReferenceValidator {
  private referenceFields: Map<string, Array<{ path: string, type: string, required?: boolean, targetTypes?: string[] }>>;
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
    this.referenceFields = initializeReferenceFields();
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
  // eslint-disable-next-line max-lines-per-function
  async validateInternal(
    resource: any,
    resourceType: string,
    fhirClientOrVersion?: any, // Can be FhirClient or FHIR version string
    fhirVersionOrSettings?: 'R4' | 'R5' | 'R6' | ValidationSettings,
    settings?: ValidationSettings
  ): Promise<ValidationIssue[]> {
    // Determine actual parameters
    let fhirVersion: 'R4' | 'R5' | 'R6' = 'R4';
    let actualSettings: ValidationSettings | undefined = settings;

    // Handle different parameter combinations
    if (typeof fhirVersionOrSettings === 'string') {
      fhirVersion = fhirVersionOrSettings as 'R4' | 'R5' | 'R6';
    } else if (fhirVersionOrSettings && typeof fhirVersionOrSettings === 'object') {
      actualSettings = fhirVersionOrSettings as ValidationSettings;
    }

    if (typeof fhirClientOrVersion === 'string') {
      fhirVersion = fhirClientOrVersion as 'R4' | 'R5' | 'R6';
    }
    // FhirClient parameter is ignored for now (not used in this implementation)
    let issues: ValidationIssue[] = [];
    const startTime = Date.now();

    // Handle null/undefined resource
    if (!resource) {
      logger.warn(`[ReferenceValidator] Null resource provided`);
      return issues;
    }

    // Handle missing resourceType
    if (!resourceType) {
      resourceType = resource.resourceType || 'Unknown';
    }

    logger.debug(`[ReferenceValidator] Validating ${resourceType} references...`);

    try {
      // Note: Records validator delegation is handled at the executor layer
      // (reference-executor.ts), so we don't need to check here to avoid circular dependencies

      // Add R6 warning if needed
      if (fhirVersion === 'R6') {
        issues = addR6WarningIfNeeded(issues, fhirVersion, 'reference');
      }

      // Extract all references from the resource
      const extractedRefs = extractReferences(resource, resourceType);

      if (extractedRefs.length === 0) {
        logger.debug(`[ReferenceValidator] No references found in ${resourceType}`);
        return issues;
      }

      logger.debug(`[ReferenceValidator] Found ${extractedRefs.length} references to validate`);

      // Validate each reference
      for (const { path, reference } of extractedRefs) {
        // Validate format
        const formatResult = validateReferenceFormat(reference);
        issues.push(...formatResult.issues);

        if (!formatResult.isValid) {
          continue;
        }

        // Type constraint validation
        if (formatResult.resourceType && formatResult.resourceId) {
          // Normalize the path for type constraint lookup
          // e.g., "Observation.subject[0]" -> "subject"
          const pathParts = path.split('.');
          const fieldName = pathParts.length > 1
            ? pathParts[pathParts.length - 1].replace(/\[\d+\]$/, '') // Remove array index
            : path;

          // Validate type constraint using the existing validator
          const constraintResult = this.constraintValidator.validateReferenceType(
            reference,
            resourceType,
            fieldName
          );

          // Only add issues for actual errors or warnings (not info messages about no constraints)
          if (!constraintResult.isValid && (constraintResult.severity === 'error' || constraintResult.severity === 'warning')) {
            issues.push(createReferenceValidationIssue({
              code: constraintResult.code || 'reference-type-mismatch',
              severity: constraintResult.severity,
              message: constraintResult.message,
              humanReadable: `Reference at ${path} points to ${constraintResult.actualType || 'unknown'} but expected ${constraintResult.expectedTypes?.join(' or ') || 'different type'}`,
              path,
              details: {
                reference,
                actualType: constraintResult.actualType,
                expectedTypes: constraintResult.expectedTypes,
                fieldPath: fieldName
              },
              resourceType
            }));
          }
        }
      }

      // Validate contained references: #id refs must resolve to a contained resource.
      // This runs even without a contained[] array — a #-ref without contained
      // is a ref-1 violation.
      const containedIssues = await this.validateContainedReferences(resource, resourceType);
      issues.push(...containedIssues);

      // Recursive reference validation (opt-in via settings)
      const recursiveConfig = this.getRecursiveValidationConfig(actualSettings);
      if (recursiveConfig.enabled) {
        logger.info(`[ReferenceValidator] Recursive validation enabled (maxDepth: ${recursiveConfig.maxDepth})`);
        try {
          const recursiveResult = await this.recursiveValidator.validateRecursively(
            resource,
            recursiveConfig
          );

          // Convert circular references to validation issues
          for (const chain of recursiveResult.circularReferences) {
            issues.push(createReferenceValidationIssue({
              code: 'reference-circular',
              severity: 'warning',
              message: `Circular reference chain detected: ${chain.join(' → ')}`,
              humanReadable: `Circular reference detected in chain: ${chain.join(' → ')}`,
              path: '',
              details: { chain, resourceType },
              resourceType
            }));
          }

          // Convert unresolved references to validation issues
          for (const ref of recursiveResult.unresolvedReferences) {
            issues.push(createReferenceValidationIssue({
              code: 'reference-unresolved',
              severity: 'info',
              message: `Referenced resource could not be resolved: ${ref}`,
              humanReadable: `Could not resolve reference: ${ref}`,
              path: '',
              details: { reference: ref, resourceType },
              resourceType
            }));
          }

          if (recursiveResult.timedOut) {
            issues.push(createReferenceValidationIssue({
              code: 'reference-recursive-timeout',
              severity: 'warning',
              message: `Recursive reference validation timed out after ${recursiveResult.validationTimeMs}ms`,
              humanReadable: `Recursive validation timed out (limit: ${recursiveConfig.timeoutMs}ms)`,
              path: '',
              details: { timeoutMs: recursiveConfig.timeoutMs, resourceType },
              resourceType
            }));
          }

          logger.info(
            `[ReferenceValidator] Recursive validation: ${recursiveResult.totalResourcesValidated} resources, ` +
            `depth ${recursiveResult.maxDepthReached}, ${recursiveResult.referencesFollowed} refs followed` +
            (recursiveResult.timedOut ? ' (TIMED OUT)' : '')
          );
        } catch (recursiveError) {
          logger.error('[ReferenceValidator] Recursive validation error:', recursiveError);
          // Non-fatal — recursive is opt-in, don't fail the entire validation
        }
      }

      const validationTime = Date.now() - startTime;
      // Strictness moved to ValidationEnginePerAspect
      const adjustedIssues = issues;
      logger.info(
        `[ReferenceValidator] Validated ${resourceType} references in ${validationTime}ms ` +
        `(${adjustedIssues.length} issues)`
      );

      return adjustedIssues;

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

  /**
   * Validate contained references
   */
  private async validateContainedReferences(resource: any, resourceType: string): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Build set of contained ids (empty if no contained array — #-refs are
    // still validated so we catch "ref-1 violated" even when contained is absent)
    const containedIds = new Set(
      (Array.isArray(resource.contained) ? resource.contained : [])
        .filter((r: any) => r.id)
        .map((r: any) => r.id)
    );

    // Find all contained references (#id). Skip refs that live inside a
    // contained resource — those resolve in the parent's contained scope
    // and are checked from there (see sync variant for rationale).
    // Also skip refs that live inside a Bundle entry's resource: those
    // resolve against the entry resource's own contained[], not the
    // Bundle's. The entry resource is validated separately (full
    // validate() pipeline recurses into Bundle.entry[].resource), so
    // nesting check fires at the right scope there.
    // Parameters.parameter[].resource is the same scoping pattern: the
    // embedded resource owns its contained[] namespace.
    const refs = extractReferences(resource, resourceType);
    const containedRefs = refs.filter(
      r =>
        r.reference.startsWith('#')
        && !/(?:^|\.)contained\[/.test(r.path)
        && !/(?:^|\.)entry\[\d+\]\.resource\./.test(r.path)
        && !/(?:^|\.)parameter\[\d+\]\.resource\./.test(r.path),
    );

    for (const { path, reference } of containedRefs) {
      const containedId = reference.substring(1);

      // Bare `#` self-reference to the host resource is valid FHIR.
      if (containedId === '') continue;

      if (!containedIds.has(containedId)) {
        issues.push(createReferenceValidationIssue({
          code: 'reference-contained-unresolved',
          severity: 'error',
          message: `Unable to resolve resource with reference '${reference}'`,
          humanReadable: `The referenced contained resource '${containedId}' does not exist in the resource`,
          path,
          details: { reference, containedId, availableIds: Array.from(containedIds) },
          resourceType
        }));
        issues.push(createReferenceValidationIssue({
          code: 'reference-ref1-invariant',
          severity: 'error',
          message: `Constraint failed: ref-1: 'SHALL have a contained resource if a local reference is provided' (url: ${containedId})`,
          humanReadable: `ref-1: contained resource '${containedId}' not found`,
          path,
          details: { reference, containedId, constraint: 'ref-1' },
          resourceType
        }));
      }
    }

    return issues;
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
    const issues: ValidationIssue[] = [];

    if (!resource) {
      return [];
    }

    // This method validates that all contained references (#id) point to valid contained resources.
    // Even if there is no contained[] array, any #-reference is still invalid
    // (ref-1: SHALL have a contained resource if a local reference is provided).
    const containedIds = new Set(
      (Array.isArray(resource.contained) ? resource.contained : [])
        .filter((r: any) => r.id)
        .map((r: any) => r.id)
    );

    // Find all contained references (#id). References that live INSIDE a
    // contained resource (path matches `…contained[N].…`) are addressed by
    // the FHIR self-reference + sibling-resolution rules and validated
    // when the parent resource is processed — checking them again here
    // produces false positives because the contained child has no
    // contained[] array of its own (see bundle-with-contained baseline,
    // where `#usagent` and bare `#` are emitted as siblings/self-refs).
    // Also skip refs that live inside Bundle.entry[].resource — those
    // resolve against the entry resource's own contained[], and the
    // entry resource is validated separately by the engine recursion.
    // Parameters.parameter[].resource has the same resource-local contained
    // scope and must not be checked against Parameters.contained.
    const refs = extractReferences(resource, resource.resourceType || 'Unknown');
    const containedRefs = refs.filter(
      r =>
        r.reference.startsWith('#')
        && !/(?:^|\.)contained\[/.test(r.path)
        && !/(?:^|\.)entry\[\d+\]\.resource\./.test(r.path)
        && !/(?:^|\.)parameter\[\d+\]\.resource\./.test(r.path),
    );

    for (const { path, reference } of containedRefs) {
      const containedId = reference.substring(1);

      // Bare `#` is a self-reference to the host resource (FHIR spec). It is
      // not a contained-id lookup, so don't flag it as ref-1.
      if (containedId === '') continue;

      if (!containedIds.has(containedId)) {
        // Emit two issues matching Java's behavior:
        // 1) "Unable to resolve resource with reference #..." → HL7 code=structure
        issues.push(createReferenceValidationIssue({
          code: 'reference-contained-unresolved',
          severity: 'error',
          message: `Unable to resolve resource with reference '${reference}'`,
          humanReadable: `The referenced contained resource '${containedId}' does not exist`,
          path,
          details: { reference, containedId, availableIds: Array.from(containedIds) },
          resourceType: resource.resourceType || 'Unknown'
        }));
        // 2) ref-1 invariant failure → HL7 code=invariant
        issues.push(createReferenceValidationIssue({
          code: 'reference-ref1-invariant',
          severity: 'error',
          message: `Constraint failed: ref-1: 'SHALL have a contained resource if a local reference is provided' (url: ${containedId})`,
          humanReadable: `ref-1: contained resource '${containedId}' not found`,
          path,
          details: { reference, containedId, constraint: 'ref-1' },
          resourceType: resource.resourceType || 'Unknown'
        }));
      }
    }

    return issues;
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
    const cfg = settings?.recursiveReferenceValidation;
    return {
      enabled: cfg?.enabled ?? false,
      maxDepth: cfg?.maxDepth ?? 1,
      validateExternal: cfg?.validateExternal ?? false,
      validateContained: cfg?.validateContained ?? true,
      validateBundleEntries: cfg?.validateBundleEntries ?? true,
      excludeResourceTypes: cfg?.excludeResourceTypes,
      maxReferencesPerResource: cfg?.maxReferencesPerResource ?? 10,
      timeoutMs: cfg?.timeoutMs ?? 30000,
    };
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
