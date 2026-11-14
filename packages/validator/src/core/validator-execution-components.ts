import { AnomalyDetector } from '../validators/anomaly-detector.js';
import { BestPracticeValidator } from '../validators/best-practice-validator.js';
import {
  CustomRuleExecutor,
  InvariantExecutor,
  MetadataExecutor,
  ProfileExecutor,
  ReferenceExecutor,
  StructuralExecutor,
  TerminologyExecutor,
} from './executors/index.js';
import { QuestionnaireContextRegistry } from './questionnaire-context-registry.js';
import type { ValidatorCoreRuntime } from './validator-core-components.js';
import type { RecordsValidatorConfig } from './validator-engine-config.js';
import { ProfileDatePolicyValidator } from '../validators/profile-date-policy.js';

export interface ValidatorExecutionComponents {
  structuralExecutor: StructuralExecutor;
  profileExecutor: ProfileExecutor;
  terminologyExecutor: TerminologyExecutor;
  referenceExecutor: ReferenceExecutor;
  invariantExecutor: InvariantExecutor;
  customRuleExecutor: CustomRuleExecutor;
  metadataExecutor: MetadataExecutor;
  bestPracticeValidator: BestPracticeValidator;
  anomalyDetector: AnomalyDetector;
  questionnaireRegistry: QuestionnaireContextRegistry;
}

export function createValidatorExecutionComponents(
  coreRuntime: ValidatorCoreRuntime,
  config: RecordsValidatorConfig = {},
): ValidatorExecutionComponents {
  const core = coreRuntime.components;
  const structuralExecutor = new StructuralExecutor(core.sdLoader, {
    elementRulesValidator: core.elementRulesValidator,
    typeValidator: core.typeValidator,
    valueSetValidator: core.valuesetValidator,
    valueSetCache: coreRuntime.terminologyCache,
  });
  const terminologyExecutor = new TerminologyExecutor(
    core.valuesetValidator,
    coreRuntime.terminologyCache,
    (url, fhirVersion) => core.sdLoader.loadProfile(url, fhirVersion),
  );

  return {
    structuralExecutor,
    profileExecutor: new ProfileExecutor(
      core.extensionValidator,
      core.slicingValidator,
      core.constraintValidator,
      config.profileDatePolicy ? new ProfileDatePolicyValidator(config.profileDatePolicy, config.packageVersionPins) : undefined,
      core.sdLoader,
    ),
    terminologyExecutor,
    referenceExecutor: new ReferenceExecutor(),
    invariantExecutor: new InvariantExecutor(),
    customRuleExecutor: new CustomRuleExecutor(),
    metadataExecutor: new MetadataExecutor(),
    bestPracticeValidator: new BestPracticeValidator(),
    anomalyDetector: new AnomalyDetector(),
    questionnaireRegistry: new QuestionnaireContextRegistry(),
  };
}
