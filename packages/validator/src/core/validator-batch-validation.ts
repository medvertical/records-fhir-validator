import type { ValidationIssue, ValidationSettings } from '../types';
import type { ProfileCache } from '../cache/profile-cache';
import type { BestPracticeValidator } from '../validators/best-practice-validator';
import type { StructureDefinitionLoader } from './structure-definition-loader';
import type { SnapshotGenerator } from './snapshot-generator';
import type { FhirClientLike } from './profile-loader-utils';
import type {
  CustomRuleExecutor,
  InvariantExecutor,
  MetadataExecutor,
  ProfileExecutor,
  ReferenceExecutor,
  StructuralExecutor,
  TerminologyExecutor,
} from './executors';
import { logger } from '../logger';
import { executeBatchValidation, type BatchValidationOptions } from './batch-validator';
import { buildMultiAspectValidateCallback } from './multi-aspect-validate-callback';
import type { MultiAspectValidateResult } from './multi-aspect-types';

interface RecordsBatchValidationContext {
  sdLoader: StructureDefinitionLoader;
  profileCache: ProfileCache;
  snapshotGenerator: SnapshotGenerator;
  structuralExecutor: StructuralExecutor;
  profileExecutor: ProfileExecutor;
  terminologyExecutor: TerminologyExecutor;
  referenceExecutor: ReferenceExecutor;
  invariantExecutor: InvariantExecutor;
  customRuleExecutor: CustomRuleExecutor;
  metadataExecutor: MetadataExecutor;
  bestPracticeValidator: BestPracticeValidator;
  strictMode: boolean;
  validateSingleResource: (
    resource: any,
    profileUrl: string,
    fhirVersion: 'R4' | 'R5' | 'R6',
    settings?: ValidationSettings,
    fhirClient?: FhirClientLike,
  ) => Promise<ValidationIssue[]>;
}

export async function validateRecordsBatch(
  resources: any[],
  options: BatchValidationOptions,
  context: RecordsBatchValidationContext,
): Promise<Map<any, ValidationIssue[]> | Map<any, MultiAspectValidateResult>> {
  if (options.aspects && options.aspects.length > 0 && options.settings) {
    logger.info(`[RecordsValidator] ⚡ Starting MULTI-ASPECT batch validation for ${resources.length} resources`);
    logger.info(`[RecordsValidator] 📋 Aspects: ${options.aspects.join(', ')}`);

    return executeBatchValidation<MultiAspectValidateResult>(resources, options, {
      sdLoader: context.sdLoader,
      profileCache: context.profileCache,
      snapshotGenerator: context.snapshotGenerator,
      validateResource: buildMultiAspectValidateCallback(
        {
          sdLoader: context.sdLoader,
          snapshotGenerator: context.snapshotGenerator,
          profileCache: context.profileCache,
          fhirClient: options.fhirClient,
          structuralExecutor: context.structuralExecutor,
          profileExecutor: context.profileExecutor,
          terminologyExecutor: context.terminologyExecutor,
          referenceExecutor: context.referenceExecutor,
          invariantExecutor: context.invariantExecutor,
          customRuleExecutor: context.customRuleExecutor,
          metadataExecutor: context.metadataExecutor,
          bestPracticeValidator: context.bestPracticeValidator,
          strictMode: context.strictMode,
        },
        options.aspects,
        options.settings,
      ),
    });
  }

  return executeBatchValidation(resources, options, {
    sdLoader: context.sdLoader,
    profileCache: context.profileCache,
    snapshotGenerator: context.snapshotGenerator,
    validateResource: (resource, profileUrl, fhirVersion) => context.validateSingleResource(
      resource,
      profileUrl,
      fhirVersion,
      options.settings,
      options.fhirClient,
    ),
  });
}
