import type { ValidationIssue } from '@records-fhir/validation-types';
import { createValidationIssue } from '../issues/index.js';
import { resourceTypeOf } from '../core/fhir-resource.js';
import type { StructureDefinition } from '../core/structure-definition-types.js';
import type { StructureDefinitionLoader } from '../core/structure-definition-loader.js';
import { logger } from '../logger.js';
import type { TypeValidator } from './type-validator.js';
import type { ValueSetValidator } from './valueset-validator.js';
import type { ElementRulesValidator } from './element-rules-validator.js';
import type { ExtensionValidationContext } from './extension-types.js';
import {
  createSafeValidationFailureMessage,
  validationFailureMetadata,
} from '../utils/validation-execution-failure.js';
import { SDFHIRPathExecutor } from './sd-fhirpath-executor.js';
import { ExtensionValidationRuntime } from './extension-validation-runtime.js';

export type { ExtensionDefinition, ExtensionValidationContext } from './extension-types.js';

export class ExtensionValidator {
  private readonly runtime: ExtensionValidationRuntime;

  constructor(
    sdLoader: StructureDefinitionLoader,
    typeValidator: TypeValidator,
    valueSetValidator: ValueSetValidator,
    elementRulesValidator: ElementRulesValidator,
    sdFHIRPathExecutor: SDFHIRPathExecutor = new SDFHIRPathExecutor(),
  ) {
    this.runtime = new ExtensionValidationRuntime({
      sdLoader,
      typeValidator,
      valueSetValidator,
      elementRulesValidator,
      sdFHIRPathExecutor,
    });
  }

  async validateExtensions(
    resource: unknown,
    profileSD: StructureDefinition,
    context: ExtensionValidationContext
  ): Promise<ValidationIssue[]> {
    const result = await this.runtime.validate(resource, profileSD, context);
    if (result.status === 'completed') return result.issues;

    logger.error(
      '[ExtensionValidator] Extension validation failed',
      validationFailureMetadata(result.error),
    );
    result.issues.push(createValidationIssue({
      code: 'profile-extension-validation-error',
      path: 'extension',
      resourceType: resourceTypeOf(resource, 'Unknown'),
      customMessage: createSafeValidationFailureMessage('Extension validation'),
    }));
    return result.issues;
  }
}
