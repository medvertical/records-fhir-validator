import type { ValidationIssue, ValidationSettings } from '@records-fhir/validation-types';
import { ReferenceTypeExtractor } from './reference-type-extractor.js';
import { validateContainedReferenceIssues } from './reference-contained-validation.js';
import { getRecursiveValidationConfig } from './reference-validation-args.js';
import type { BatchCheckConfig } from './reference-http-client.js';
import type { RecursiveValidationConfig } from './recursive-reference-validator.js';
import {
  createReferenceValidatorDependencies,
  type ReferenceValidatorDependencies,
} from './reference-validator-dependencies.js';
import {
  ReferenceValidationWorkflow,
  type ReferenceResourceFetcher,
} from './reference-validation-workflow.js';

export class ReferenceValidator {
  private referenceTypeExtractor: ReferenceTypeExtractor;
  private readonly constraintValidator: ReferenceValidatorDependencies['constraintValidator'];
  private readonly containedResolver: ReferenceValidatorDependencies['containedResolver'];
  private readonly bundleResolver: ReferenceValidatorDependencies['bundleResolver'];
  private readonly circularDetector: ReferenceValidatorDependencies['circularDetector'];
  private readonly recursiveValidator: ReferenceValidatorDependencies['recursiveValidator'];
  private readonly versionValidator: ReferenceValidatorDependencies['versionValidator'];
  private readonly canonicalValidator: ReferenceValidatorDependencies['canonicalValidator'];
  private readonly batchedChecker: ReferenceValidatorDependencies['batchedChecker'];
  private readonly validationWorkflow: ReferenceValidationWorkflow;

  constructor(overrides: Partial<ReferenceValidatorDependencies> = {}) {
    const dependencies = createReferenceValidatorDependencies(overrides);
    this.constraintValidator = dependencies.constraintValidator;
    this.containedResolver = dependencies.containedResolver;
    this.bundleResolver = dependencies.bundleResolver;
    this.circularDetector = dependencies.circularDetector;
    this.recursiveValidator = dependencies.recursiveValidator;
    this.versionValidator = dependencies.versionValidator;
    this.canonicalValidator = dependencies.canonicalValidator;
    this.batchedChecker = dependencies.batchedChecker;
    this.validationWorkflow = new ReferenceValidationWorkflow(
      dependencies.constraintValidator,
      dependencies.recursiveValidator,
    );
    this.referenceTypeExtractor = new ReferenceTypeExtractor({
      allowContained: true,
      allowCanonical: true,
      extractVersion: true,
      validateResourceType: true
    });
  }

  async validateInternal(
    resource: unknown,
    resourceType: string,
    fhirClientOrVersion?: unknown, // Can be a compatible FHIR client or version string
    fhirVersionOrSettings?: 'R4' | 'R5' | 'R6' | ValidationSettings,
    settings?: ValidationSettings,
    resourceFetcher?: ReferenceResourceFetcher,
  ): Promise<ValidationIssue[]> {
    return this.validationWorkflow.validate(
      resource,
      resourceType,
      fhirClientOrVersion,
      fhirVersionOrSettings,
      settings,
      resourceFetcher,
    );
  }

  public extractResourceType(reference: string): string | null {
    return this.referenceTypeExtractor.extractResourceType(reference);
  }

  public parseReference(reference: string) {
    return this.referenceTypeExtractor.parseReference(reference);
  }

  public validateReferenceTypeConstraint(reference: string, resourceType: string, fieldPath: string) {
    return this.constraintValidator.validateReferenceType(reference, resourceType, fieldPath);
  }

  public hasTypeConstraints(resourceType: string, fieldPath: string) {
    return this.constraintValidator.hasConstraints(resourceType, fieldPath);
  }

  public getFieldConstraints(resourceType: string, fieldPath: string) {
    return this.constraintValidator.getConstraintsForField(resourceType, fieldPath);
  }

  public resolveContainedReference(reference: string, parentResource: unknown, expectedType?: string) {
    return this.containedResolver.resolveContainedReference(reference, parentResource, expectedType);
  }

  public getContainedResources(resource: unknown) {
    return this.containedResolver.extractContainedResources(resource);
  }

  public validateContainedReferencesSync(resource: unknown) {
    return validateContainedReferenceIssues(resource);
  }

  public resolveBundleReference(reference: string, bundle: unknown) {
    return this.bundleResolver.resolveBundleReference(reference, bundle);
  }

  public validateBundleReferences(bundle: unknown) {
    const result = this.bundleResolver.validateBundleReferences(bundle);
    return result.issues || [];
  }

  public detectCircularReferences(resource: unknown, startingReferences?: string[]) {
    return this.circularDetector.detectCircularReferences(resource, startingReferences);
  }

  public wouldCreateCircularReference(currentPath: string[], newReference: string) {
    return this.circularDetector.wouldCreateCircularReference(currentPath, newReference);
  }

  public getRecursiveValidationConfig(settings?: ValidationSettings) {
    return getRecursiveValidationConfig(settings);
  }

  public estimateRecursiveValidationCost(..._args: unknown[]) {
    return {
      estimatedResources: 0,
      estimatedReferences: 0,
      estimatedTimeMs: 0,
      maxDepth: 0,
      feasible: true
    };
  }

  public validateRecursively(
    resource: unknown,
    config?: Partial<RecursiveValidationConfig>,
    resourceFetcher?: ReferenceResourceFetcher,
  ) {
    return this.recursiveValidator.validateRecursively(resource, config, resourceFetcher);
  }

  public parseVersionedReference(reference: string) {
    return this.versionValidator.parseVersionedReference(reference);
  }

  public validateVersionedReference(reference: string) {
    return this.versionValidator.validateVersionedReference(reference);
  }

  public checkVersionConsistency(references: string[]) {
    return this.versionValidator.checkVersionConsistency(references);
  }

  public extractVersionedReferences(resource: unknown) {
    return this.versionValidator.extractVersionedReferences(resource);
  }

  public validateBundleVersionIntegrity(bundle: unknown) {
    return this.versionValidator.validateBundleVersionIntegrity(bundle);
  }

  public parseCanonicalUrl(canonical: string) {
    return this.canonicalValidator.parseCanonicalUrl(canonical);
  }

  public validateCanonicalUrl(canonical: string) {
    return this.canonicalValidator.validateCanonicalUrl(canonical);
  }

  public validateProfileCanonical(canonical: string) {
    return this.canonicalValidator.validateProfileCanonical(canonical);
  }

  public validateValueSetCanonical(canonical: string) {
    return this.canonicalValidator.validateValueSetCanonical(canonical);
  }

  public extractCanonicalUrls(resource: unknown) {
    return this.canonicalValidator.extractCanonicalUrls(resource);
  }

  public validateResourceCanonicals(resource: unknown) {
    return this.canonicalValidator.validateResourceCanonicals(resource);
  }

  public validateBundleCanonicals(bundle: unknown) {
    return this.canonicalValidator.validateBundleCanonicals(bundle);
  }

  public async checkBatchReferences(references: string[], config?: Partial<BatchCheckConfig>) {
    return this.batchedChecker.checkBatch(references, config);
  }

  public async checkResourceReferences(resource: unknown, config?: Partial<BatchCheckConfig>) {
    return this.batchedChecker.checkResourceReferences(resource, config);
  }

  public checkBundleReferenceExistence(bundle: unknown, config?: Partial<BatchCheckConfig>) {
    return this.batchedChecker.checkBundleReferences(bundle, config);
  }

  public filterExistingReferences(references: string[], config?: Partial<BatchCheckConfig>) {
    return this.batchedChecker.filterExistingReferences(references, config);
  }
}
