import { ProfileCache } from '../cache/profile-cache';
import { BestPracticeValidator } from '../validators/best-practice-validator';
import { AnomalyDetector } from '../validators/anomaly-detector';
import { ConstraintValidator } from '../validators/constraint-validator';
import { ElementRulesValidator } from '../validators/element-rules-validator';
import { ExtensionValidator } from '../validators/extension-validator';
import { SlicingValidator } from '../validators/slicing-validator';
import { TypeValidator } from '../validators/type-validator';
import { ValueSetValidator } from '../validators/valueset-validator';
import { StructureDefinitionLoader } from './structure-definition-loader';
import { SnapshotGenerator } from './snapshot-generator';
import {
  CustomRuleExecutor,
  InvariantExecutor,
  MetadataExecutor,
  ProfileExecutor,
  ReferenceExecutor,
  StructuralExecutor,
  TerminologyExecutor,
} from './executors';
import { QuestionnaireContextRegistry } from './questionnaire-context-registry';
import type { RecordsValidatorConfig } from './validator-engine-config';

export interface RecordsValidatorComponents {
  profileCache: ProfileCache;
  sdLoader: StructureDefinitionLoader;
  typeValidator: TypeValidator;
  extensionValidator: ExtensionValidator;
  slicingValidator: SlicingValidator;
  constraintValidator: ConstraintValidator;
  valuesetValidator: ValueSetValidator;
  elementRulesValidator: ElementRulesValidator;
  snapshotGenerator: SnapshotGenerator;
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

export function createRecordsValidatorComponents(config: RecordsValidatorConfig): RecordsValidatorComponents {
  const profileCache = new ProfileCache(config.enableCaching);
  const sdLoader = new StructureDefinitionLoader(
    config.packageCachePath || process.env.HOME + '/.fhir/packages',
    config.bundledProfilesPath,
    {
      autoDownload: config.autoDownload,
      allowedPackages: config.allowedPackages,
      packageVersionPins: config.packageVersionPins
    }
  );
  const typeValidator = new TypeValidator();
  const valuesetValidator = new ValueSetValidator();
  const elementRulesValidator = new ElementRulesValidator();
  const extensionValidator = new ExtensionValidator(
    sdLoader,
    typeValidator,
    valuesetValidator,
    elementRulesValidator
  );
  const slicingValidator = new SlicingValidator();
  slicingValidator.setTypeProfileResolver((url: string) => sdLoader.loadProfile(url));
  const constraintValidator = new ConstraintValidator();
  const snapshotGenerator = new SnapshotGenerator(sdLoader);

  return {
    profileCache,
    sdLoader,
    typeValidator,
    extensionValidator,
    slicingValidator,
    constraintValidator,
    valuesetValidator,
    elementRulesValidator,
    snapshotGenerator,
    structuralExecutor: new StructuralExecutor(sdLoader),
    profileExecutor: new ProfileExecutor(extensionValidator, slicingValidator, constraintValidator),
    terminologyExecutor: new TerminologyExecutor(),
    referenceExecutor: new ReferenceExecutor(),
    invariantExecutor: new InvariantExecutor(),
    customRuleExecutor: new CustomRuleExecutor(),
    metadataExecutor: new MetadataExecutor(),
    bestPracticeValidator: new BestPracticeValidator(),
    anomalyDetector: new AnomalyDetector(),
    questionnaireRegistry: new QuestionnaireContextRegistry(),
  };
}
