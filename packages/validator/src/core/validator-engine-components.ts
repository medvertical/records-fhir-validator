import {
  createValidatorAdministrationComponents,
  type ValidatorAdministrationComponents,
} from './validator-administration-components.js';
import {
  createValidatorCoreRuntime,
  type ValidatorCoreComponents,
} from './validator-core-components.js';
import {
  createValidatorExecutionComponents,
  type ValidatorExecutionComponents,
} from './validator-execution-components.js';
import type { RecordsValidatorConfig } from './validator-engine-config.js';

export interface RecordsValidatorComponents extends
  ValidatorCoreComponents,
  ValidatorExecutionComponents,
  ValidatorAdministrationComponents {}

export function createRecordsValidatorComponents(
  config: RecordsValidatorConfig,
): RecordsValidatorComponents {
  const coreRuntime = createValidatorCoreRuntime(config);
  const core = coreRuntime.components;
  const execution = createValidatorExecutionComponents(coreRuntime);
  const administration = createValidatorAdministrationComponents(core, execution);

  return {
    profileCache: core.profileCache,
    sdLoader: core.sdLoader,
    typeValidator: core.typeValidator,
    extensionValidator: core.extensionValidator,
    slicingValidator: core.slicingValidator,
    constraintValidator: core.constraintValidator,
    valuesetValidator: core.valuesetValidator,
    elementRulesValidator: core.elementRulesValidator,
    snapshotGenerator: core.snapshotGenerator,
    structuralExecutor: execution.structuralExecutor,
    profileExecutor: execution.profileExecutor,
    terminologyExecutor: execution.terminologyExecutor,
    referenceExecutor: execution.referenceExecutor,
    invariantExecutor: execution.invariantExecutor,
    customRuleExecutor: execution.customRuleExecutor,
    metadataExecutor: execution.metadataExecutor,
    bestPracticeValidator: execution.bestPracticeValidator,
    anomalyDetector: execution.anomalyDetector,
    questionnaireRegistry: execution.questionnaireRegistry,
    sdFHIRPathExecutor: core.sdFHIRPathExecutor,
    terminologyResourceValidator: core.terminologyResourceValidator,
    profileAdministration: administration.profileAdministration,
    directAspectValidation: administration.directAspectValidation,
    terminologyAdministration: administration.terminologyAdministration,
  };
}
