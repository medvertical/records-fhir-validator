import type { ValidationIssue, ValidationSettings } from '../types';
import type { ProfileCache } from '../cache/profile-cache';
import type { BestPracticeValidator } from '../validators/best-practice-validator';
import { logger } from '../logger';
import type { StructureDefinitionLoader } from './structure-definition-loader';
import type { SnapshotGenerator } from './snapshot-generator';
import {
  createProfileFallbackIssue,
  loadProfileOrBase,
  type FhirClientLike,
} from './profile-loader-utils';
import {
  CustomRuleExecutor,
  InvariantExecutor,
  MetadataExecutor,
  ProfileExecutor,
  ReferenceExecutor,
  StructuralExecutor,
  TerminologyExecutor,
} from './executors';
import { createValidationErrorIssue } from './validation-utils';
import { collectSingleResourceValidationIssues } from './single-resource-validation';

interface RecordsSingleResourceValidationInput {
  resource: any;
  profileUrl?: string;
  fhirVersion: 'R4' | 'R5' | 'R6';
  settings?: ValidationSettings;
  fhirClient?: FhirClientLike;
}

interface RecordsSingleResourceValidationContext {
  sdLoader: StructureDefinitionLoader;
  profileCache: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  structuralExecutor: StructuralExecutor;
  profileExecutor: ProfileExecutor;
  terminologyExecutor: TerminologyExecutor;
  invariantExecutor: InvariantExecutor;
  customRuleExecutor: CustomRuleExecutor;
  metadataExecutor: MetadataExecutor;
  referenceExecutor: ReferenceExecutor;
  bestPracticeValidator: BestPracticeValidator;
  strictMode: boolean;
  validateBundleEntriesIfNeeded(resource: any, fhirVersion: 'R4' | 'R5' | 'R6'): Promise<ValidationIssue[]>;
}

export async function validateRecordsResource(
  input: RecordsSingleResourceValidationInput,
  context: RecordsSingleResourceValidationContext,
): Promise<ValidationIssue[]> {
  const { resource, profileUrl, fhirVersion, settings, fhirClient } = input;
  const startTime = Date.now();

  try {
    const declaredProfileUrl =
      profileUrl ??
      resource.meta?.profile?.[0] ??
      `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;

    logger.info(`[RecordsValidator] Validating ${resource.resourceType} against ${declaredProfileUrl}`);

    const loadResult = await loadProfileOrBase(
      context.sdLoader,
      context.snapshotGenerator,
      declaredProfileUrl,
      resource.resourceType,
      fhirVersion,
      context.profileCache,
      fhirClient,
    );
    const structureDef = loadResult.structureDef;

    if (!structureDef) {
      return [createValidationErrorIssue(
        'profile',
        'profile-not-found',
        `Profile ${declaredProfileUrl} not found and base StructureDefinition for ${resource.resourceType} could not be loaded`,
        { profile: declaredProfileUrl },
        'meta.profile',
      )];
    }

    const profileFallbackIssue: ValidationIssue | null = loadResult.usedBaseFallback
      ? createProfileFallbackIssue(declaredProfileUrl, resource.resourceType)
      : null;

    const issues = await collectSingleResourceValidationIssues(
      {
        resource,
        profileUrl: declaredProfileUrl,
        fhirVersion,
        structureDef,
        strictMode: context.strictMode,
        settings,
        profileFallbackIssue,
      },
      {
        structuralExecutor: context.structuralExecutor,
        profileExecutor: context.profileExecutor,
        terminologyExecutor: context.terminologyExecutor,
        invariantExecutor: context.invariantExecutor,
        customRuleExecutor: context.customRuleExecutor,
        metadataExecutor: context.metadataExecutor,
        referenceExecutor: context.referenceExecutor,
        bestPracticeValidator: context.bestPracticeValidator,
        validateBundleEntriesIfNeeded: context.validateBundleEntriesIfNeeded,
      },
    );

    const validationTime = Date.now() - startTime;
    logger.info(
      `[RecordsValidator] Validated ${resource.resourceType} in ${validationTime}ms ` +
      `(${issues.length} issues - extensions, slicing, bindings, constraints checked)`,
    );

    return issues;
  } catch (error) {
    logger.error('[RecordsValidator] Validation error:', error);
    return [createValidationErrorIssue(
      'profile',
      'validation-error',
      `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
    )];
  }
}
