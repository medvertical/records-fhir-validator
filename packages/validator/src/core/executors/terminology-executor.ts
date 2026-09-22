/**
 * Public facade for terminology resolution configuration and validation execution.
 *
 * Supplemental terminology-aspect validators are wired here rather than at a
 * fan-out call site, so every fan-out path inherits the same rule set.
 */

import type { ValidationIssue } from '@records-fhir/validation-types';
import type { ProfileSourceContext } from '../../persistence/index.js';
import { deepBindingValidator } from '../../validators/deep-binding-validator.js';
import { resourceTypeOf } from '../fhir-resource.js';
import type { FHIRPathTerminologyResolver } from '../../validators/fhirpath-async-terminology.js';
import { ValueSetCache } from '../../validators/valueset-cache.js';
import { ValueSetValidator, type TerminologyResolutionConfig } from '../../validators/valueset-validator.js';
import { logger } from '../../logger.js';
import type { TerminologyValidationPort } from './terminology-validation-port.js';
import {
  TerminologyValidationPipeline,
  type TerminologyValidationContext,
} from './terminology-validation-pipeline.js';

export type { TerminologyValidationContext } from './terminology-validation-pipeline.js';

export class TerminologyExecutor {
  private readonly valuesetValidator: TerminologyValidationPort;
  private readonly validationPipeline: TerminologyValidationPipeline;

  constructor(
    valuesetValidator?: TerminologyValidationPort,
    valueSetCache: ValueSetCache = new ValueSetCache(),
  ) {
    this.valuesetValidator = valuesetValidator ?? new ValueSetValidator(valueSetCache);
    this.validationPipeline = new TerminologyValidationPipeline(
      this.valuesetValidator,
      valueSetCache,
    );
  }

  configureResolution(config: Partial<TerminologyResolutionConfig>): void {
    this.valuesetValidator.setResolutionConfig(config);
    logger.debug(`[TerminologyExecutor] Resolution configured: strategy=${config.strategy}`);
  }

  getResolutionConfig(): TerminologyResolutionConfig {
    return this.valuesetValidator.getResolutionConfig();
  }

  /**
   * The ValueSet validator is shared with the structural and profile
   * executors, so the tenant scope is bound once before any aspect runs.
   */
  setSourceContext(context: ProfileSourceContext | undefined): void {
    this.valuesetValidator.setSourceContext?.(context);
  }

  getFHIRPathTerminologyResolver(): FHIRPathTerminologyResolver {
    return this.valuesetValidator;
  }

  clearCache(): void {
    this.valuesetValidator.clearCache();
    this.validationPipeline.clearCache();
    logger.info('[TerminologyExecutor] Cache cleared');
  }

  async validate(context: TerminologyValidationContext): Promise<ValidationIssue[]> {
    const pipelineIssues = await this.validationPipeline.validate(context);
    return [
      ...pipelineIssues,
      ...deepBindingValidator.validate({
        resource: context.resource,
        resourceType: resourceTypeOf(context.resource, context.resourceType),
        structureDef: context.structureDef,
      }),
    ];
  }
}
