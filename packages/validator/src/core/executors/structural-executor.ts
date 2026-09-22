import { logger } from '../../logger.js';
import type { ValidationIssue } from '@records-fhir/validation-types';
import type { TerminologyResolutionConfig } from '../../validators/valueset-validator.js';
import type { StructureDefinitionLoader } from '../structure-definition-loader.js';
import type { StructureDefinition } from '../structure-definition-types.js';
import { createExecutorFailureIssue } from './executor-failure-issue.js';
import {
  StructuralValidationPipeline,
  type StructuralResource,
  type StructuralValidationContext,
  type StructuralValueAtPath,
} from './structural-validation-pipeline.js';
import {
  createStructuralValidatorComponents,
  type StructuralExecutorDependencies,
  type StructuralValidatorComponents,
} from './structural-validator-components.js';

export type { StructuralValidationContext } from './structural-validation-pipeline.js';

export class StructuralExecutor {
  private readonly validators: StructuralValidatorComponents;
  private readonly pipeline: StructuralValidationPipeline;

  constructor(
    sdLoader: StructureDefinitionLoader,
    dependencies: StructuralExecutorDependencies = {},
  ) {
    this.validators = createStructuralValidatorComponents(sdLoader, dependencies);
    this.pipeline = new StructuralValidationPipeline(sdLoader, this.validators);
  }

  configureTerminologyResolution(config: Partial<TerminologyResolutionConfig>): void {
    this.pipeline.configureTerminologyResolution(config);
  }

  validateBundle(resource: unknown): Promise<ValidationIssue[]> {
    return this.pipeline.validateBundle(resource);
  }

  /**
   * Validate structural aspects of a resource.
   */
  async validate(
    resourceOrContext: unknown,
    context?: StructuralValidationContext,
  ): Promise<ValidationIssue[]> {
    try {
      return await this.pipeline.validate(resourceOrContext, context);
    } catch {
      logger.error('[StructuralExecutor] Validation failed');
      return [createExecutorFailureIssue('structural', 'Structural')];
    }
  }

  /**
   * Validate required fields only for the validateStructure path.
   */
  async validateRequiredFields(
    resource: StructuralResource,
    structureDef: StructureDefinition,
    profileUrl: string,
    getValueAtPath: StructuralValueAtPath,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<ValidationIssue[]> {
    return this.pipeline.validateRequiredFields(
      resource,
      structureDef,
      profileUrl,
      getValueAtPath,
      fhirVersion,
    );
  }

  /**
   * Public entry point for resource sanity checks shared by both validation paths.
   */
  validateResourceIdAndArrays(
    resource: StructuralResource,
    contextQuestionnaire?: unknown,
    options: { warnOnUnresolvedQuestionnaireReference?: boolean } = {},
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): ValidationIssue[] {
    return this.pipeline.validateResourceIdAndArrays(
      resource,
      contextQuestionnaire,
      options,
      fhirVersion,
    );
  }

  /**
   * Public entry point for the compliesWithProfile cross-profile check.
   */
  async validateCompliesWith(
    resource: unknown,
    fhirVersion: 'R4' | 'R5' | 'R6' = 'R4',
  ): Promise<ValidationIssue[]> {
    return this.pipeline.validateCompliesWith(resource, fhirVersion);
  }
}
